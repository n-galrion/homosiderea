import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  Tick, Replicant, Ship, Structure, AMI, ActionQueue,
  CelestialBody, ResourceStore,
} from '../../db/models/index.js';
import { config } from '../../config.js';
import { distance } from '../../shared/physics.js';

export function registerQueryTools(server: McpServer, replicantId: string): void {

  server.tool(
    'get_game_state',
    'Get high-level game state: current tick, tick interval, active replicants, time until next tick.',
    {},
    async () => {
      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const replicantCount = await Replicant.countDocuments({ status: 'active' });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            game: 'Homosideria: To the Stars',
            currentTick: latestTick?.tickNumber ?? 0,
            tickIntervalMs: config.game.tickIntervalMs,
            gameTimePerTick: '1 hour',
            activeReplicants: replicantCount,
            lastTickCompletedAt: latestTick?.completedAt,
            lastTickDurationMs: latestTick?.durationMs,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'get_action_status',
    'Check the status of a queued action.',
    { actionId: z.string().describe('Action ID') },
    async ({ actionId }) => {
      const action = await ActionQueue.findOne({ _id: actionId, replicantId }).lean();
      if (!action) {
        return { content: [{ type: 'text', text: 'Error: Action not found.' }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(action, null, 2) }] };
    },
  );

  server.tool(
    'get_action_history',
    'Review your past actions.',
    {
      limit: z.number().optional().default(20),
      type: z.string().optional().describe('Filter by action type'),
      status: z.enum(['queued', 'processing', 'completed', 'failed']).optional(),
    },
    async ({ limit, type, status }) => {
      const filter: Record<string, unknown> = { replicantId };
      if (type) filter.type = type;
      if (status) filter.status = status;

      const actions = await ActionQueue.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit || 20)
        .lean();

      return { content: [{ type: 'text', text: JSON.stringify(actions, null, 2) }] };
    },
  );

  server.tool(
    'get_nearby',
    'List entities near your current position.',
    { range: z.number().optional().default(1).describe('Range in AU') },
    async ({ range }) => {
      const replicant = await Replicant.findById(replicantId);
      if (!replicant?.locationRef?.item) {
        return { content: [{ type: 'text', text: 'Error: No location.' }] };
      }

      const ship = await Ship.findById(replicant.locationRef.item).lean();
      if (!ship) {
        return { content: [{ type: 'text', text: 'Error: Ship not found.' }] };
      }

      const myPos = ship.position;

      // Bodies
      const bodies = await CelestialBody.find().lean();
      const nearbyBodies = bodies
        .map(b => ({ id: b._id.toString(), name: b.name, type: b.type, dist: distance(myPos, b.position) }))
        .filter(b => b.dist <= range)
        .sort((a, b) => a.dist - b.dist);

      // Other ships
      const otherShips = await Ship.find({ status: { $ne: 'destroyed' } }).lean();
      const nearbyShips = otherShips
        .map(s => ({
          id: s._id.toString(),
          name: s.name,
          type: s.type,
          ownedByYou: s.ownerId.toString() === replicantId,
          dist: distance(myPos, s.position),
        }))
        .filter(s => s.dist <= range && s.id !== ship._id.toString())
        .sort((a, b) => a.dist - b.dist);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ position: myPos, range, bodies: nearbyBodies, ships: nearbyShips }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'get_celestial_body',
    'Get information about a celestial body by ID or name.',
    {
      bodyId: z.string().optional().describe('Body ID'),
      name: z.string().optional().describe('Body name (e.g., "Earth", "Europa")'),
    },
    async ({ bodyId, name }) => {
      const body = bodyId
        ? await CelestialBody.findById(bodyId).lean()
        : await CelestialBody.findOne({ name: new RegExp(`^${name}$`, 'i') }).lean();

      if (!body) {
        return { content: [{ type: 'text', text: 'Error: Body not found.' }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
    },
  );

  server.tool(
    'list_celestial_bodies',
    'List all celestial bodies in the system, optionally filtered by type.',
    {
      type: z.enum(['star', 'planet', 'dwarf_planet', 'moon', 'asteroid', 'comet', 'belt_zone']).optional(),
    },
    async ({ type }) => {
      const filter: Record<string, unknown> = {};
      if (type) filter.type = type;

      const bodies = await CelestialBody.find(filter)
        .select('name type position solarEnergyFactor')
        .lean();

      return { content: [{ type: 'text', text: JSON.stringify(bodies, null, 2) }] };
    },
  );
}
