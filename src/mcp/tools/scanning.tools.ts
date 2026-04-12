import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Ship, CelestialBody, Replicant, Structure, Asteroid, LandingSite, Tick } from '../../db/models/index.js';
import { distance } from '../../shared/physics.js';
import { generateForBeltZone, discoverNearby } from '../../engine/systems/AsteroidGenerator.js';

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

      const result = {
        position: myPos,
        scanRange,
        celestialBodies: nearbyBodies.map(b => ({
          id: b._id.toString(),
          name: b.name,
          type: b.type,
          distance: parseFloat(b.dist.toFixed(6)),
          position: b.position,
          resources: b.resources.map(r => ({
            type: r.resourceType,
            abundance: r.abundance,
            remaining: r.remaining,
            depleted: r.remaining <= 0,
          })),
        })),
        asteroids: asteroidsInRange.map(a => ({
          id: a._id.toString(),
          name: a.name,
          composition: a.physical.composition,
          radiusKm: a.physical.radius,
          distance: parseFloat(a.dist.toFixed(6)),
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
          distance: parseFloat(s.dist.toFixed(6)),
          status: s.status,
        })),
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
          }, null, 2),
        }],
      };
    },
  );
}
