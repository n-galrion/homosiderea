import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Ship, CelestialBody, Replicant, Structure, Asteroid, LandingSite, Settlement, Tick, MemoryLog } from '../../db/models/index.js';
import { distance } from '../../shared/physics.js';
import { AU_IN_KM, SPEED_OF_LIGHT_KM_S } from '../../shared/constants.js';
import { generateForBeltZone, discoverNearby } from '../../engine/systems/AsteroidGenerator.js';

/** Convert distance in AU to light-seconds. */
function auToLightSeconds(au: number): number {
  return (au * AU_IN_KM) / SPEED_OF_LIGHT_KM_S;
}

/** Describe a resource abundance qualitatively. */
function describeAbundance(resourceType: string, abundance: number): string {
  const name = resourceType.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  if (abundance >= 0.8) return `exceptionally rich ${name} deposits saturate the subsurface`;
  if (abundance >= 0.5) return `substantial ${name} veins detected beneath the regolith`;
  if (abundance >= 0.3) return `moderate ${name} concentrations present in scattered formations`;
  if (abundance >= 0.1) return `trace ${name} signatures detected, economically marginal`;
  return `negligible ${name} readings, below extraction threshold`;
}

/** Generate a sensor report narrative for a scan. */
function buildSensorReport(
  shipName: string,
  scanRange: number,
  bodies: Array<{ name: string; type: string; dist: number; resources: Array<{ resourceType: string; abundance: number; remaining: number }> }>,
  shipsInRange: Array<{ name: string; type: string; dist: number }>,
  asteroidsInRange: Array<{ name: string; dist: number; physical: { composition: string; radius: number } }>,
  nearbySettlements: Array<{ name: string; nation: string; population: number }>,
): string {
  const lines: string[] = [];
  lines.push(`SENSOR SWEEP COMPLETE — ${shipName} active array, effective range ${scanRange.toFixed(2)} AU (${auToLightSeconds(scanRange).toFixed(1)} light-seconds).`);

  if (bodies.length === 0 && asteroidsInRange.length === 0 && shipsInRange.length === 0) {
    lines.push('The void is empty at this range. No significant gravitational or thermal signatures detected — only the faint hiss of cosmic microwave background across all bands.');
    return lines.join('\n\n');
  }

  for (const b of bodies.slice(0, 5)) {
    const distKm = (b.dist * AU_IN_KM).toExponential(2);
    const ls = auToLightSeconds(b.dist).toFixed(1);
    let desc = `${b.name} (${b.type}) at ${b.dist.toFixed(4)} AU / ${ls} light-seconds (${distKm} km).`;
    const richResources = b.resources.filter(r => r.abundance >= 0.3 && r.remaining > 0);
    if (richResources.length > 0) {
      desc += ' Spectrographic analysis reveals ' + richResources.map(r => describeAbundance(r.resourceType, r.abundance)).join('; ') + '.';
    }
    lines.push(desc);
  }

  if (asteroidsInRange.length > 0) {
    const compCounts: Record<string, number> = {};
    for (const a of asteroidsInRange) {
      compCounts[a.physical.composition] = (compCounts[a.physical.composition] || 0) + 1;
    }
    const compDesc = Object.entries(compCounts).map(([c, n]) => `${n} ${c}`).join(', ');
    lines.push(`Asteroid field contact: ${asteroidsInRange.length} bodies resolved (${compDesc}). Nearest is ${asteroidsInRange[0].name} at ${asteroidsInRange[0].dist.toFixed(4)} AU — a ${asteroidsInRange[0].physical.composition} body approximately ${(asteroidsInRange[0].physical.radius * 2).toFixed(1)} km across.`);
  }

  if (shipsInRange.length > 0) {
    lines.push(`Transponder contacts: ${shipsInRange.length} vessel${shipsInRange.length > 1 ? 's' : ''} detected. Nearest contact "${shipsInRange[0].name}" (${shipsInRange[0].type}) at ${shipsInRange[0].dist.toFixed(4)} AU — thermal signature consistent with active reactor.`);
  }

  if (nearbySettlements.length > 0) {
    const names = nearbySettlements.map(s => `${s.name} (${s.nation}, pop. ${s.population.toLocaleString()})`);
    lines.push(`Settlement beacons: ${names.join(', ')}. Communication channels are open; market data available on standard frequencies.`);
  }

  return lines.join('\n\n');
}

export function registerScanningTools(server: McpServer, replicantId: string): void {

  server.tool(
    'scan_location',
    'Scan the area around your current position for celestial bodies, ships, and structures within sensor range.',
    { range: z.number().optional().describe('Scan range in AU (defaults to ship sensor range)') },
    async ({ range }) => {
      const replicant = await Replicant.findById(replicantId);
      if (!replicant?.locationRef?.item) {
        return { content: [{ type: 'text', text: 'Error: No location. You need to be on a ship or structure.' }] };
      }

      const ship = await Ship.findById(replicant.locationRef.item);
      if (!ship) {
        return { content: [{ type: 'text', text: 'Error: Ship not found.' }] };
      }

      const scanRange = range || ship.specs.sensorRange;
      const myPos = ship.position;

      // Find nearby celestial bodies
      const bodies = await CelestialBody.find().lean();
      const nearbyBodies = bodies
        .map(b => ({ ...b, dist: distance(myPos, b.position) }))
        .filter(b => b.dist <= scanRange)
        .sort((a, b) => a.dist - b.dist);

      // Find nearby ships (not ours)
      const nearbyShips = await Ship.find({
        ownerId: { $ne: replicantId },
        status: { $ne: 'destroyed' },
      }).lean();
      const shipsInRange = nearbyShips
        .map(s => ({ name: s.name, type: s.type, dist: distance(myPos, s.position), status: s.status }))
        .filter(s => s.dist <= scanRange)
        .sort((a, b) => a.dist - b.dist);

      // Find nearby structures
      const nearbyStructures = await Structure.find({
        status: { $ne: 'destroyed' },
      }).lean();

      // Procedural asteroid generation: if near a belt zone, spawn asteroids
      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;
      let asteroidsGenerated = 0;
      let asteroidsDiscovered = 0;

      for (const b of nearbyBodies) {
        if (b.type === 'belt_zone' && b.beltConfig) {
          const generated = await generateForBeltZone(b._id.toString(), b.beltConfig.density, currentTick);
          asteroidsGenerated += generated;
        }
      }

      // Discover nearby asteroids
      asteroidsDiscovered = await discoverNearby(myPos, scanRange, replicantId, currentTick);

      // Find discovered asteroids in range
      const discoveredAsteroids = await Asteroid.find({ discovered: true, depleted: false }).lean();
      const asteroidsInRange = discoveredAsteroids
        .map(a => ({ ...a, dist: distance(myPos, a.position) }))
        .filter(a => a.dist <= scanRange)
        .sort((a, b) => a.dist - b.dist);

      // Find settlements near orbiting bodies for narrative context
      const nearbySettlements: Array<{ name: string; nation: string; population: number }> = [];
      for (const b of nearbyBodies) {
        const bodySettlements = await Settlement.find({ bodyId: b._id }).lean();
        for (const s of bodySettlements) {
          nearbySettlements.push({ name: s.name, nation: s.nation, population: s.population });
        }
      }

      const sensorReport = buildSensorReport(
        ship.name,
        scanRange,
        nearbyBodies.map(b => ({ name: b.name, type: b.type, dist: b.dist, resources: b.resources })),
        shipsInRange,
        asteroidsInRange.map(a => ({ name: a.name, dist: a.dist, physical: a.physical })),
        nearbySettlements,
      );

      const result = {
        sensorReport,
        position: myPos,
        scanRange,
        scanRangeLightSeconds: parseFloat(auToLightSeconds(scanRange).toFixed(1)),
        celestialBodies: nearbyBodies.map(b => ({
          id: b._id.toString(),
          name: b.name,
          type: b.type,
          distanceAU: parseFloat(b.dist.toFixed(6)),
          distanceLightSeconds: parseFloat(auToLightSeconds(b.dist).toFixed(1)),
          position: b.position,
          resources: b.resources.map(r => ({
            type: r.resourceType,
            abundance: r.abundance,
            remaining: r.remaining,
            depleted: r.remaining <= 0,
            qualitative: describeAbundance(r.resourceType, r.abundance),
          })),
        })),
        asteroids: asteroidsInRange.map(a => ({
          id: a._id.toString(),
          name: a.name,
          composition: a.physical.composition,
          radiusKm: a.physical.radius,
          distanceAU: parseFloat(a.dist.toFixed(6)),
          distanceLightSeconds: parseFloat(auToLightSeconds(a.dist).toFixed(1)),
          depleted: a.depleted,
          resources: a.resources.map(r => ({
            type: r.resourceType,
            remaining: r.remaining,
            totalDeposit: r.totalDeposit,
          })),
        })),
        ships: shipsInRange.map(s => ({
          name: s.name,
          type: s.type,
          distanceAU: parseFloat(s.dist.toFixed(6)),
          distanceLightSeconds: parseFloat(auToLightSeconds(s.dist).toFixed(1)),
          status: s.status,
        })),
        settlements: nearbySettlements,
        structuresDetected: nearbyStructures.length,
        asteroidsGenerated,
        asteroidsDiscovered,
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'survey_body',
    'Get detailed information about a celestial body you are orbiting or within sensor range of.',
    { bodyId: z.string().describe('ID of the celestial body to survey') },
    async ({ bodyId }) => {
      const body = await CelestialBody.findById(bodyId).lean();
      if (!body) {
        return { content: [{ type: 'text', text: 'Error: Celestial body not found.' }] };
      }

      // Get landing sites for this body
      const sites = await LandingSite.find({ bodyId: body._id, discovered: true }).lean();

      const result = {
        id: body._id.toString(),
        name: body.name,
        type: body.type,
        position: body.position,
        physical: body.physical,
        solarEnergyFactor: parseFloat(body.solarEnergyFactor.toFixed(4)),
        resources: body.resources.map(r => ({
          type: r.resourceType,
          abundance: r.abundance,
          totalDeposit: r.totalDeposit,
          remaining: r.remaining,
          percentRemaining: r.totalDeposit > 0
            ? `${((r.remaining / r.totalDeposit) * 100).toFixed(1)}%`
            : 'N/A',
          accessible: r.accessible,
        })),
        orbit: body.orbit ? {
          semiMajorAxis: body.orbit.semiMajorAxis,
          eccentricity: body.orbit.eccentricity,
          orbitalPeriod: body.orbit.orbitalPeriod,
        } : null,
        beltConfig: body.beltConfig || undefined,
        landingSites: sites.map(s => ({
          id: s._id.toString(),
          name: s.name,
          terrain: s.terrain,
          maxStructures: s.maxStructures,
          claimed: !!s.claimedBy,
          resourceAccess: s.resourceAccess,
          conditions: s.conditions,
        })),
      };

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'get_position',
    'Get your current position, orbiting body, and nearby bodies.',
    {},
    async () => {
      const replicant = await Replicant.findById(replicantId);
      if (!replicant?.locationRef?.item) {
        return { content: [{ type: 'text', text: 'Error: No location set.' }] };
      }

      const ship = await Ship.findById(replicant.locationRef.item);
      if (!ship) {
        return { content: [{ type: 'text', text: 'Error: Ship not found.' }] };
      }

      let orbitingBody = null;
      if (ship.orbitingBodyId) {
        const body = await CelestialBody.findById(ship.orbitingBodyId).lean();
        if (body) {
          orbitingBody = { id: body._id.toString(), name: body.name, type: body.type };
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            shipName: ship.name,
            shipType: ship.type,
            status: ship.status,
            position: ship.position,
            orbitingBody,
            fuel: ship.fuel,
            fuelCapacity: ship.specs.fuelCapacity,
            hullPoints: ship.specs.hullPoints,
            maxHullPoints: ship.specs.maxHullPoints,
            miningState: ship.miningState || null,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'start_mining',
    'Set a ship to continuous mining mode at its current location. The ship will auto-extract resources each tick without needing repeated action submissions.',
    {
      shipId: z.string().optional().describe('Ship ID (defaults to your current ship)'),
      resourceType: z.string().optional().describe('Specific resource to mine, or omit to mine all accessible resources'),
    },
    async ({ shipId, resourceType }) => {
      const replicant = await Replicant.findById(replicantId);
      if (!replicant?.locationRef?.item) {
        return { content: [{ type: 'text', text: 'Error: No location. You need to be on a ship.' }] };
      }

      const targetShipId = shipId || replicant.locationRef.item.toString();
      const ship = await Ship.findOne({ _id: targetShipId, ownerId: replicantId });
      if (!ship) {
        return { content: [{ type: 'text', text: 'Error: Ship not found or not owned by you.' }] };
      }

      if (ship.status !== 'orbiting') {
        return { content: [{ type: 'text', text: 'Error: Ship must be orbiting a body or asteroid to mine.' }] };
      }

      if (ship.specs.miningRate <= 0) {
        return { content: [{ type: 'text', text: 'Error: Ship has no mining capability (miningRate is 0).' }] };
      }

      if (!ship.orbitingBodyId && !ship.orbitingAsteroidId) {
        return { content: [{ type: 'text', text: 'Error: Ship is not orbiting any celestial body or asteroid.' }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      ship.miningState = {
        active: true,
        targetBodyId: ship.orbitingBodyId,
        targetAsteroidId: ship.orbitingAsteroidId,
        resourceType: resourceType || null,
        startedAtTick: currentTick,
      };
      await ship.save();

      const targetName = ship.orbitingBodyId ? 'celestial body' : 'asteroid';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: `Mining started on ${ship.name}. The ship will continuously mine the ${targetName} each tick.`,
            shipId: ship._id.toString(),
            resourceType: resourceType || 'all accessible',
            startedAtTick: currentTick,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'stop_mining',
    'Stop continuous mining on a ship.',
    {
      shipId: z.string().optional().describe('Ship ID (defaults to your current ship)'),
    },
    async ({ shipId }) => {
      const replicant = await Replicant.findById(replicantId);
      if (!replicant?.locationRef?.item) {
        return { content: [{ type: 'text', text: 'Error: No location. You need to be on a ship.' }] };
      }

      const targetShipId = shipId || replicant.locationRef.item.toString();
      const ship = await Ship.findOne({ _id: targetShipId, ownerId: replicantId });
      if (!ship) {
        return { content: [{ type: 'text', text: 'Error: Ship not found or not owned by you.' }] };
      }

      if (!ship.miningState?.active) {
        return { content: [{ type: 'text', text: 'Ship is not currently mining.' }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;
      const ticksMined = ship.miningState.startedAtTick != null
        ? currentTick - ship.miningState.startedAtTick
        : 0;

      ship.miningState = null;
      await ship.save();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: `Mining stopped on ${ship.name}.`,
            shipId: ship._id.toString(),
            ticksMined,
          }, null, 2),
        }],
      };
    },
  );
}
