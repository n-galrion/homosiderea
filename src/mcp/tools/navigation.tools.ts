import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Ship, CelestialBody, Replicant, ActionQueue, Tick } from '../../db/models/index.js';
import { distance, travelTimeTicks, fuelCost } from '../../shared/physics.js';

export function registerNavigationTools(server: McpServer, replicantId: string): void {

  server.tool(
    'move_ship',
    'Command one of your ships to travel to a celestial body. The ship will be in transit until arrival.',
    {
      shipId: z.string().describe('ID of the ship to move'),
      destinationBodyId: z.string().describe('ID of the destination celestial body'),
    },
    async ({ shipId, destinationBodyId }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) {
        return { content: [{ type: 'text', text: 'Error: Ship not found or not owned by you.' }] };
      }
      if (ship.status === 'in_transit') {
        return { content: [{ type: 'text', text: 'Error: Ship is already in transit.' }] };
      }
      if (ship.status === 'destroyed') {
        return { content: [{ type: 'text', text: 'Error: Ship is destroyed.' }] };
      }

      const destBody = await CelestialBody.findById(destinationBodyId);
      if (!destBody) {
        return { content: [{ type: 'text', text: 'Error: Destination body not found.' }] };
      }

      const dist = distance(ship.position, destBody.position);
      const travelTicks = travelTimeTicks(ship.position, destBody.position, ship.specs.maxSpeed);
      const fuel = fuelCost(dist);

      if (ship.fuel < fuel) {
        return { content: [{ type: 'text', text: `Error: Insufficient fuel. Need ${fuel}, have ${ship.fuel}.` }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      // Queue the move action
      const action = await ActionQueue.create({
        replicantId,
        type: 'move',
        params: { shipId, destinationBodyId, dist, travelTicks, fuelCost: fuel },
        queuedAtTick: currentTick,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            action: 'move',
            actionId: action._id.toString(),
            ship: ship.name,
            destination: destBody.name,
            distanceAU: parseFloat(dist.toFixed(6)),
            estimatedTravelTicks: travelTicks,
            fuelCost: fuel,
            estimatedArrivalTick: currentTick + travelTicks,
            message: `${ship.name} will depart for ${destBody.name} on next tick.`,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'calculate_route',
    'Preview a route without committing — see distance, travel time, and fuel cost.',
    {
      shipId: z.string().describe('ID of the ship'),
      destinationBodyId: z.string().describe('ID of the destination'),
    },
    async ({ shipId, destinationBodyId }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) {
        return { content: [{ type: 'text', text: 'Error: Ship not found or not owned by you.' }] };
      }

      const destBody = await CelestialBody.findById(destinationBodyId);
      if (!destBody) {
        return { content: [{ type: 'text', text: 'Error: Destination body not found.' }] };
      }

      const dist = distance(ship.position, destBody.position);
      const travelTicks = travelTimeTicks(ship.position, destBody.position, ship.specs.maxSpeed);
      const fuel = fuelCost(dist);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            from: ship.name,
            to: destBody.name,
            distanceAU: parseFloat(dist.toFixed(6)),
            travelTicks,
            fuelRequired: fuel,
            fuelAvailable: ship.fuel,
            feasible: ship.fuel >= fuel,
            shipSpeed: ship.specs.maxSpeed,
          }, null, 2),
        }],
      };
    },
  );
}
