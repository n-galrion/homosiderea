import { Ship, Settlement, CelestialBody, ResourceStore } from '../../db/models/index.js';
import { distance } from '../../shared/physics.js';
import { nanoid } from 'nanoid';

const NPC_OWNER_ID = '000000000000000000000000'; // sentinel for NPC-owned ships

/**
 * Resource keys on the ResourceStore model.
 */
const RESOURCE_KEYS: ReadonlySet<string> = new Set([
  'metals', 'ice', 'silicates', 'rareEarths', 'helium3', 'organics',
  'hydrogen', 'uranium', 'carbon', 'alloys', 'fuel', 'electronics',
  'hullPlating', 'engines', 'sensors', 'computers', 'weaponSystems',
  'lifeSupportUnits', 'solarPanels', 'fusionCores', 'energy',
]);

/** Minimum ticks of supply before a resource is considered deficit. */
const DEFICIT_THRESHOLD = 20;

/** Max cargo a dispatch freighter carries per trip. */
const DISPATCH_CARGO = 200;

/**
 * Parse a freighter's mission from its name.
 * Format: [HomeName] NPC Freighter-XXXX {mission:resource:targetSettlementId}
 */
function parseMission(shipName: string): {
  home: string | null;
  mission: 'fetch' | 'deliver' | null;
  resource: string | null;
  targetId: string | null;
} {
  const homeMatch = shipName.match(/^\[([^\]]+)\]/);
  const missionMatch = shipName.match(/\{(fetch|deliver):(\w+):(\w+)\}$/);
  return {
    home: homeMatch?.[1] ?? null,
    mission: (missionMatch?.[1] as 'fetch' | 'deliver') ?? null,
    resource: missionMatch?.[2] ?? null,
    targetId: missionMatch?.[3] ?? null,
  };
}

/**
 * Encode a mission into the ship name suffix.
 */
function encodeMission(baseName: string, mission: string, resource: string, targetId: string): string {
  // Strip any existing mission suffix
  const stripped = baseName.replace(/\s*\{[^}]+\}$/, '');
  return `${stripped} {${mission}:${resource}:${targetId}}`;
}

/**
 * Goal-driven NPC dispatch system.
 * Runs every 5 ticks. Detects deficits in settlement stockpiles and
 * dispatches freighters to fetch needed resources from surplus settlements.
 */
export async function processNPCDispatch(tick: number): Promise<number> {
  // Only run every 5 ticks to reduce load
  if (tick % 5 !== 0) return 0;

  let dispatched = 0;

  // Process freighter arrivals first (unload/load cargo)
  dispatched += await processFreighterArrivals(tick);

  // Then dispatch new freighters for deficit resources
  dispatched += await dispatchForDeficits(tick);

  return dispatched;
}

/**
 * Handle freighters that have arrived at their destination.
 * - Fetch mission arrived at source: load cargo, set return trip
 * - Deliver mission arrived at home: unload cargo into stockpile
 */
async function processFreighterArrivals(tick: number): Promise<number> {
  const arrivedFreighters = await Ship.find({
    ownerId: NPC_OWNER_ID,
    status: 'orbiting',
    name: /\{(fetch|deliver):/,
  });

  let acted = 0;

  for (const ship of arrivedFreighters) {
    const { home, mission, resource, targetId } = parseMission(ship.name);
    if (!mission || !resource || !home) continue;

    if (mission === 'fetch' && ship.orbitingBodyId) {
      // We've arrived at the source settlement — load cargo
      const sourceSettlement = await Settlement.findOne({
        bodyId: ship.orbitingBodyId,
        status: { $ne: 'destroyed' },
      }).lean();

      if (!sourceSettlement) continue;

      const sourceStockpile = await ResourceStore.findOne({
        'ownerRef.kind': 'Settlement',
        'ownerRef.item': sourceSettlement._id,
      });

      if (!sourceStockpile || !RESOURCE_KEYS.has(resource)) continue;

      const storeAny = sourceStockpile as unknown as Record<string, number>;
      const available = storeAny[resource] ?? 0;
      const toLoad = Math.min(available, DISPATCH_CARGO);

      if (toLoad > 0) {
        storeAny[resource] = available - toLoad;
        sourceStockpile.markModified(resource);
        await sourceStockpile.save();
      }

      // Find home settlement's body for return trip
      const homeSettlement = await Settlement.findOne({ name: home }).lean();
      if (!homeSettlement) continue;

      const homeBody = await CelestialBody.findById(homeSettlement.bodyId).lean();
      if (!homeBody) continue;

      const dist = distance(ship.position, homeBody.position);
      const travelTicks = Math.max(1, Math.ceil(dist / ship.specs.maxSpeed));

      // Switch to deliver mission and navigate home
      ship.name = encodeMission(ship.name, 'deliver', resource, targetId ?? '');
      ship.status = 'in_transit';
      ship.navigation = {
        destinationBodyId: homeBody._id,
        destinationPos: homeBody.position,
        departurePos: ship.position,
        departureTick: tick,
        arrivalTick: tick + travelTicks,
        speed: ship.specs.maxSpeed,
      };
      ship.orbitingBodyId = null;
      await ship.save();
      acted++;

    } else if (mission === 'deliver' && ship.orbitingBodyId) {
      // We've arrived back home — unload cargo into home stockpile
      const homeSettlement = await Settlement.findOne({ name: home }).lean();
      if (!homeSettlement) continue;

      // Verify we're at the home body
      if (!ship.orbitingBodyId.equals(homeSettlement.bodyId)) continue;

      const homeStockpile = await ResourceStore.findOne({
        'ownerRef.kind': 'Settlement',
        'ownerRef.item': homeSettlement._id,
      });

      if (!homeStockpile || !RESOURCE_KEYS.has(resource)) continue;

      const storeAny = homeStockpile as unknown as Record<string, number>;
      // Unload the cargo
      storeAny[resource] = (storeAny[resource] ?? 0) + DISPATCH_CARGO;
      homeStockpile.markModified(resource);
      await homeStockpile.save();

      // Clear mission — ship is now idle, can be reused
      ship.name = ship.name.replace(/\s*\{[^}]+\}$/, '');
      await ship.save();
      acted++;
    }
  }

  return acted;
}

/**
 * For each settlement with a spaceport, detect deficits and dispatch freighters.
 */
async function dispatchForDeficits(tick: number): Promise<number> {
  const settlements = await Settlement.find({
    status: { $ne: 'destroyed' },
    'economy.spaceportLevel': { $gte: 1 },
  }).lean();

  let dispatched = 0;

  for (const settlement of settlements) {
    const stockpile = await ResourceStore.findOne({
      'ownerRef.kind': 'Settlement',
      'ownerRef.item': settlement._id,
    }).lean();

    if (!stockpile) continue;

    const consumption = settlement.consumption as Record<string, number> || {};
    const storeAny = stockpile as unknown as Record<string, number>;

    // Find deficit resources
    const deficits: { resource: string; ticksOfSupply: number }[] = [];
    for (const [resource, rate] of Object.entries(consumption)) {
      if (!RESOURCE_KEYS.has(resource) || rate <= 0) continue;
      const stock = storeAny[resource] ?? 0;
      const ticksOfSupply = stock / rate;
      if (ticksOfSupply < DEFICIT_THRESHOLD) {
        deficits.push({ resource, ticksOfSupply });
      }
    }

    if (deficits.length === 0) continue;

    // Sort by urgency (lowest supply first)
    deficits.sort((a, b) => a.ticksOfSupply - b.ticksOfSupply);

    // Check which resources already have a freighter dispatched
    const activeFreighters = await Ship.find({
      ownerId: NPC_OWNER_ID,
      name: { $regex: `^\\[${settlement.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]` },
      status: { $in: ['orbiting', 'in_transit'] },
    }).lean();

    const resourcesInTransit = new Set<string>();
    for (const f of activeFreighters) {
      const parsed = parseMission(f.name);
      if (parsed.resource) resourcesInTransit.add(parsed.resource);
    }

    // Dispatch for unserved deficits (max 1 new dispatch per settlement per cycle)
    for (const deficit of deficits) {
      if (resourcesInTransit.has(deficit.resource)) continue;

      // Find a settlement that has surplus of this resource
      const sourceSettlement = await findSurplusSettlement(
        deficit.resource,
        settlement._id.toString(),
        settlement.bodyId,
      );

      if (!sourceSettlement) continue;

      // Look for an idle NPC freighter at this settlement (no active mission)
      const escapedName = settlement.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let freighter = await Ship.findOne({
        ownerId: NPC_OWNER_ID,
        name: { $regex: `^\\[${escapedName}\\].*Freighter`, $not: /\{(fetch|deliver):/ },
        status: 'orbiting',
        orbitingBodyId: settlement.bodyId,
      });

      if (!freighter) {
        // No idle freighter — check if we can create one (within spaceport capacity)
        const totalFreighters = activeFreighters.filter(f => f.name.includes('Freighter')).length;
        if (totalFreighters >= settlement.economy.spaceportLevel * 2) continue;

        // Create a new dispatch freighter
        const body = await CelestialBody.findById(settlement.bodyId).lean();
        if (!body) continue;

        freighter = await Ship.create({
          name: `[${settlement.name}] ${settlement.nation} Freighter-${nanoid(4)}`,
          ownerId: NPC_OWNER_ID,
          type: 'freighter',
          status: 'orbiting',
          position: body.position,
          orbitingBodyId: body._id,
          specs: {
            hullPoints: 200,
            maxHullPoints: 200,
            maxSpeed: 0.001,
            cargoCapacity: 500,
            fuelCapacity: 200,
            sensorRange: 0.3,
            miningRate: 0,
            combatPower: 0,
            manufacturingRate: 0,
          },
          fuel: 200,
          createdAtTick: tick,
        });
      }

      // Dispatch the freighter to the source settlement
      const sourceBody = await CelestialBody.findById(sourceSettlement.bodyId).lean();
      if (!sourceBody) continue;

      const dist = distance(freighter.position, sourceBody.position);
      const travelTicks = Math.max(1, Math.ceil(dist / freighter.specs.maxSpeed));

      freighter.name = encodeMission(
        freighter.name,
        'fetch',
        deficit.resource,
        sourceSettlement._id.toString(),
      );
      freighter.status = 'in_transit';
      freighter.navigation = {
        destinationBodyId: sourceBody._id,
        destinationPos: sourceBody.position,
        departurePos: freighter.position,
        departureTick: tick,
        arrivalTick: tick + travelTicks,
        speed: freighter.specs.maxSpeed,
      };
      freighter.orbitingBodyId = null;
      await freighter.save();

      dispatched++;
      break; // Max 1 dispatch per settlement per cycle
    }
  }

  return dispatched;
}

/**
 * Find the nearest settlement that has surplus of a given resource.
 */
async function findSurplusSettlement(
  resource: string,
  excludeSettlementId: string,
  homeBodyId: unknown,
): Promise<{ _id: { toString(): string }; bodyId: unknown; name: string } | null> {
  const candidates = await Settlement.find({
    status: { $ne: 'destroyed' },
    _id: { $ne: excludeSettlementId },
    'economy.spaceportLevel': { $gte: 1 },
  }).lean();

  // Filter to those that produce this resource
  const producers = candidates.filter(s => {
    const prod = s.production as Record<string, number> || {};
    return (prod[resource] ?? 0) > 0;
  });

  if (producers.length === 0) return null;

  // Find the one with the most surplus in stockpile
  let bestSettlement: typeof producers[0] | null = null;
  let bestSurplus = 0;

  for (const candidate of producers) {
    const stockpile = await ResourceStore.findOne({
      'ownerRef.kind': 'Settlement',
      'ownerRef.item': candidate._id,
    }).lean();

    if (!stockpile) continue;
    const storeAny = stockpile as unknown as Record<string, number>;
    const stock = storeAny[resource] ?? 0;
    const consumptionRate = (candidate.consumption as Record<string, number>)?.[resource] ?? 0;
    const surplus = consumptionRate > 0 ? stock / consumptionRate : stock;

    if (surplus > bestSurplus) {
      bestSurplus = surplus;
      bestSettlement = candidate;
    }
  }

  return bestSettlement ? { _id: bestSettlement._id, bodyId: bestSettlement.bodyId, name: bestSettlement.name } : null;
}
