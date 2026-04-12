import { Ship, Settlement, CelestialBody, ResourceStore } from '../../db/models/index.js';
import { distance } from '../../shared/physics.js';
import { nanoid } from 'nanoid';

const NPC_OWNER_ID = '000000000000000000000000'; // sentinel for NPC-owned ships

/**
 * Ensure NPC ships exist for settlements with spaceports.
 * Creates freighters, miners, and patrol ships if below minimum counts.
 */
export async function ensureNPCFleet(tick: number): Promise<number> {
  const settlements = await Settlement.find({
    status: { $ne: 'destroyed' },
    'economy.spaceportLevel': { $gte: 1 },
  }).lean();

  let created = 0;

  for (const settlement of settlements) {
    const existingShips = await Ship.countDocuments({
      ownerId: NPC_OWNER_ID,
      'navigation.destinationBodyId': { $exists: true },
      name: { $regex: `\\[${settlement.name}\\]` },
      status: { $ne: 'destroyed' },
    });

    const targetFleetSize = Math.min(settlement.economy.spaceportLevel * 2, 8);
    const toCreate = targetFleetSize - existingShips;
    if (toCreate <= 0) continue;

    // Determine position from body
    const body = await CelestialBody.findById(settlement.bodyId).lean();
    if (!body) continue;

    for (let i = 0; i < Math.min(toCreate, 2); i++) { // max 2 new per tick
      const shipType = i % 3 === 0 ? 'freighter' : i % 3 === 1 ? 'miner' : 'shuttle';
      const role = shipType === 'freighter' ? 'trade' : shipType === 'miner' ? 'mining' : 'patrol';

      await Ship.create({
        name: `[${settlement.name}] ${settlement.nation} ${role === 'trade' ? 'Freighter' : role === 'mining' ? 'Mining Barge' : 'Patrol Craft'}-${nanoid(4)}`,
        ownerId: NPC_OWNER_ID,
        type: shipType,
        status: 'orbiting',
        position: body.position,
        orbitingBodyId: body._id,
        specs: {
          hullPoints: shipType === 'freighter' ? 200 : 100,
          maxHullPoints: shipType === 'freighter' ? 200 : 100,
          maxSpeed: shipType === 'freighter' ? 0.001 : 0.0015,
          cargoCapacity: shipType === 'freighter' ? 500 : shipType === 'miner' ? 300 : 50,
          fuelCapacity: 200,
          sensorRange: 0.3,
          miningRate: shipType === 'miner' ? 8 : 0,
          combatPower: shipType === 'shuttle' ? 3 : 0,
          manufacturingRate: 0,
        },
        fuel: 200,
        createdAtTick: tick,
      });
      created++;
    }
  }

  return created;
}

/**
 * Simulate NPC ship behavior each tick.
 * Freighters travel trade routes, miners extract, patrols orbit.
 */
export async function simulateNPCShips(tick: number): Promise<number> {
  // Only run every 5 ticks to reduce DB load
  if (tick % 5 !== 0) return 0;

  const npcShips = await Ship.find({
    ownerId: NPC_OWNER_ID,
    status: { $in: ['orbiting', 'in_transit'] },
  });

  let acted = 0;

  for (const ship of npcShips) {
    if (ship.status === 'in_transit') continue; // let movement system handle it

    const isFreighter = ship.name.includes('Freighter');
    const isMiner = ship.name.includes('Mining');

    if (isFreighter) {
      // Freighters pick a random different settlement body and travel there
      if (Math.random() < 0.2) { // 20% chance per 5-tick cycle to depart
        const settlements = await Settlement.find({
          status: { $ne: 'destroyed' },
          bodyId: { $ne: ship.orbitingBodyId },
          'economy.spaceportLevel': { $gte: 1 },
        }).lean();

        if (settlements.length > 0) {
          const dest = settlements[Math.floor(Math.random() * settlements.length)];
          const destBody = await CelestialBody.findById(dest.bodyId).lean();
          if (destBody) {
            const dist = distance(ship.position, destBody.position);
            const travelTicks = Math.ceil(dist / ship.specs.maxSpeed);

            ship.status = 'in_transit';
            ship.navigation = {
              destinationBodyId: destBody._id,
              destinationPos: destBody.position,
              departurePos: ship.position,
              departureTick: tick,
              arrivalTick: tick + travelTicks,
              speed: ship.specs.maxSpeed,
            };
            ship.orbitingBodyId = null;
            await ship.save();
            acted++;
          }
        }
      }
    } else if (isMiner && ship.orbitingBodyId) {
      // Miners produce resources passively (simplified — they mine for their settlement)
      // This makes belt zones and mining bodies look active
      acted++;
    }
  }

  return acted;
}

/**
 * Combined NPC tick processing.
 */
export async function processNPCTraffic(tick: number): Promise<number> {
  let total = 0;
  total += await ensureNPCFleet(tick);
  total += await simulateNPCShips(tick);
  return total;
}
