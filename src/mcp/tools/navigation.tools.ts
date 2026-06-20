import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Ship, CelestialBody, Replicant, ActionQueue, Tick, Asteroid, Salvage } from '../../db/models/index.js';
import { distance, travelTimeTicks, fuelCost } from '../../shared/physics.js';

export const MAX_NAV_RADIUS_AU = 60;

type Vec = { x: number; y: number; z: number };
function isValidPos(p: Vec | undefined | null): p is Vec {
  if (!p) return false;
  const { x, y, z } = p;
  if (![x, y, z].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  return Math.sqrt(x * x + y * y + z * z) <= MAX_NAV_RADIUS_AU;
}

interface DestinationInput {
  destinationBodyId?: string;
  asteroidId?: string;
  salvageId?: string;
  destinationPos?: Vec;
}

/**
 * Resolve one of {destinationBodyId, asteroidId, salvageId, destinationPos} to a
 * target position (+ the body/asteroid id when applicable). Enforces exactly-one
 * input and validates the resulting position (finite, within MAX_NAV_RADIUS_AU).
 */
export async function resolveDestination(
  input: DestinationInput,
): Promise<{ ok: true; pos: Vec; bodyId?: string; asteroidId?: string; label: string } | { ok: false; error: string }> {
  const provided = [input.destinationBodyId, input.asteroidId, input.salvageId, input.destinationPos].filter((v) => v != null);
  if (provided.length === 0) {
    return { ok: false, error: 'Provide a destination: destinationBodyId, asteroidId, salvageId, or destinationPos {x,y,z}.' };
  }
  if (provided.length > 1) {
    return { ok: false, error: 'Provide exactly one destination input (body, asteroid, salvage, or coordinates).' };
  }

  let pos: Vec | undefined;
  let bodyId: string | undefined;
  let asteroidId: string | undefined;
  let label: string;

  if (input.destinationBodyId) {
    const body = await CelestialBody.findById(input.destinationBodyId).lean();
    if (!body) return { ok: false, error: 'Destination body not found.' };
    pos = body.position; bodyId = body._id.toString(); label = body.name;
  } else if (input.asteroidId) {
    const ast = await Asteroid.findById(input.asteroidId).lean();
    if (!ast) return { ok: false, error: 'Asteroid not found.' };
    pos = ast.position; asteroidId = ast._id.toString(); label = ast.name;
  } else if (input.salvageId) {
    const sal = await Salvage.findById(input.salvageId).lean();
    if (!sal) return { ok: false, error: 'Salvage not found.' };
    pos = sal.position; label = sal.name;
  } else {
    pos = input.destinationPos; label = `(${pos!.x}, ${pos!.y}, ${pos!.z})`;
  }

  if (!isValidPos(pos)) {
    return { ok: false, error: `Invalid destination position: coordinates must be finite and within ${MAX_NAV_RADIUS_AU} AU of origin.` };
  }
  return { ok: true, pos, bodyId, asteroidId, label };
}

export function registerNavigationTools(server: McpServer, replicantId: string): void {

  server.tool(
    'move_ship',
    'Command one of your ships to travel to a destination. Provide exactly one of: destinationBodyId (a registered body), asteroidId, salvageId, or destinationPos {x,y,z} for raw coordinates (beacons, anomalies, derelicts). The ship will be in transit until arrival.',
    {
      shipId: z.string().describe('ID of the ship to move'),
      destinationBodyId: z.string().optional().describe('A registered celestial body'),
      asteroidId: z.string().optional().describe('An asteroid to fly to (enables mining on arrival)'),
      salvageId: z.string().optional().describe('A salvage field to fly to'),
      destinationPos: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional().describe('Raw coordinates {x,y,z} in AU'),
    },
    async ({ shipId, destinationBodyId, asteroidId, salvageId, destinationPos }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) return { content: [{ type: 'text', text: 'Error: Ship not found or not owned by you.' }] };
      if (ship.status === 'in_transit') return { content: [{ type: 'text', text: 'Error: Ship is already in transit.' }] };
      if (ship.status === 'destroyed') return { content: [{ type: 'text', text: 'Error: Ship is destroyed.' }] };

      const dest = await resolveDestination({ destinationBodyId, asteroidId, salvageId, destinationPos });
      if (!dest.ok) return { content: [{ type: 'text', text: `Error: ${dest.error}` }] };

      const dist = distance(ship.position, dest.pos);
      const travelTicks = travelTimeTicks(ship.position, dest.pos, ship.specs.maxSpeed);
      const fuel = fuelCost(dist);
      if (ship.fuel < fuel) {
        return { content: [{ type: 'text', text: `Error: Insufficient fuel. Need ${fuel}, have ${ship.fuel}.` }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      const action = await ActionQueue.create({
        replicantId,
        type: 'move',
        params: {
          shipId,
          destinationPos: dest.pos,
          ...(dest.bodyId ? { destinationBodyId: dest.bodyId } : {}),
          ...(dest.asteroidId ? { destinationAsteroidId: dest.asteroidId } : {}),
          dist, travelTicks, fuelCost: fuel,
        },
        queuedAtTick: currentTick,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            action: 'move',
            actionId: action._id.toString(),
            ship: ship.name,
            destination: dest.label,
            distanceAU: parseFloat(dist.toFixed(6)),
            estimatedTravelTicks: travelTicks,
            fuelCost: fuel,
            estimatedArrivalTick: currentTick + travelTicks,
            message: `${ship.name} will depart for ${dest.label} on next tick.`,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'calculate_route',
    'Preview a trip: distance, fuel, and travel time to a destination. Provide exactly one of destinationBodyId, asteroidId, salvageId, or destinationPos {x,y,z}.',
    {
      shipId: z.string().describe('ID of the ship'),
      destinationBodyId: z.string().optional(),
      asteroidId: z.string().optional(),
      salvageId: z.string().optional(),
      destinationPos: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
    },
    async ({ shipId, destinationBodyId, asteroidId, salvageId, destinationPos }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) return { content: [{ type: 'text', text: 'Error: Ship not found or not owned by you.' }] };

      const dest = await resolveDestination({ destinationBodyId, asteroidId, salvageId, destinationPos });
      if (!dest.ok) return { content: [{ type: 'text', text: `Error: ${dest.error}` }] };

      const dist = distance(ship.position, dest.pos);
      const travelTicks = travelTimeTicks(ship.position, dest.pos, ship.specs.maxSpeed);
      const fuel = fuelCost(dist);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            from: ship.name,
            to: dest.label,
            distanceAU: parseFloat(dist.toFixed(6)),
            travelTicks,
            fuelRequired: fuel,
            fuelAvailable: ship.fuel,
            feasible: ship.fuel >= fuel,
            shipSpeed: ship.specs.maxSpeed,
            hint: ship.fuel >= fuel
              ? 'Feasible — commit the trip with move_ship to this destination.'
              : 'Not enough fuel — refuel with transfer_fuel or pick a closer destination.',
          }, null, 2),
        }],
      };
    },
  );
}
