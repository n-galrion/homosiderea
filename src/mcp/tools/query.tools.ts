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
    'Get high-level game state: current tick, tick interval, active replicants, time until next tick, and a narrative status summary.',
    {},
    async () => {
      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;
      const replicantCount = await Replicant.countDocuments({ status: 'active' });

      // Build a narrative status summary
      const ships = await Ship.find({ status: { $ne: 'destroyed' } }).lean();
      const bodies = await CelestialBody.find({ type: { $in: ['planet', 'moon'] } }).lean();

      // Determine where ships are concentrated
      const orbitCounts: Record<string, number> = {};
      for (const s of ships) {
        if (s.orbitingBodyId) {
          const bodyName = bodies.find(b => b._id.toString() === s.orbitingBodyId?.toString())?.name || 'unknown';
          orbitCounts[bodyName] = (orbitCounts[bodyName] || 0) + 1;
        }
      }
      const concentrationDesc = Object.entries(orbitCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, count]) => `${count} near ${name}`)
        .join(', ');

      // Check for any hostile activity (ships in attack status or damaged settlements)
      const damagedSettlements = await import('../../db/models/index.js').then(m =>
        m.Settlement.countDocuments({ status: { $in: ['damaged', 'destroyed'] } })
      );
      const hostileActivity = damagedSettlements > 0
        ? `${damagedSettlements} settlement(s) report damage — the political landscape is unsettled.`
        : 'No hostile activity detected.';

      // Game hours to real-world time context
      const gameHours = currentTick;
      const gameDays = (gameHours / 24).toFixed(1);
      const gameYears = (gameHours / 8760).toFixed(3);

      const statusNarrative = [
        `The Sol system turns through its ${currentTick}th hour (${gameDays} days / ${gameYears} years of game time).`,
        `${replicantCount} replicant${replicantCount !== 1 ? 's' : ''} ${replicantCount !== 1 ? 'are' : 'is'} active across the system${concentrationDesc ? `, with vessels concentrated: ${concentrationDesc}` : ''}.`,
        hostileActivity,
        `Each tick represents 1 hour of game time; the simulation advances every ${(config.game.tickIntervalMs / 1000).toFixed(0)} real-world seconds.`,
      ].join(' ');

      // Compute next tick time
      const lastTickAt = latestTick?.completedAt ? new Date(latestTick.completedAt as unknown as string | number) : null;
      const nextTickAt = lastTickAt
        ? new Date(lastTickAt.getTime() + config.game.tickIntervalMs)
        : null;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            status: statusNarrative,
            game: 'Homosideria: To the Stars',
            currentTick,
            gameTime: { hours: gameHours, days: parseFloat(gameDays), years: parseFloat(gameYears) },
            tickIntervalMs: config.game.tickIntervalMs,
            gameTimePerTick: '1 hour',
            activeReplicants: replicantCount,
            lastTickCompletedAt: latestTick?.completedAt,
            lastTickDurationMs: latestTick?.durationMs,
            nextTickAt: nextTickAt?.toISOString() ?? null,
            ticksElapsed: currentTick,
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
