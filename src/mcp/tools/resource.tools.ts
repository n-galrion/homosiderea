import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Ship, Structure, ResourceStore, ActionQueue, Tick } from '../../db/models/index.js';

export function registerResourceTools(server: McpServer, replicantId: string): void {

  server.tool(
    'mine',
    'Begin mining a resource at your current location. Mining produces resources each tick.',
    {
      shipId: z.string().optional().describe('ID of the ship to mine with'),
      structureId: z.string().optional().describe('ID of the mine structure to use'),
      resourceType: z.string().describe('Resource to mine (metals, ice, silicates, etc.)'),
    },
    async ({ shipId, structureId, resourceType }) => {
      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      const action = await ActionQueue.create({
        replicantId,
        type: 'mine',
        params: { shipId, structureId, resourceType },
        queuedAtTick: currentTick,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            actionId: action._id.toString(),
            type: 'mine',
            resource: resourceType,
            message: `Mining action queued. Will begin on next tick.`,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'transfer_resources',
    'Transfer resources between ships and structures at the same location.',
    {
      fromId: z.string().describe('Source entity ID'),
      fromType: z.enum(['Ship', 'Structure']).describe('Source entity type'),
      toId: z.string().describe('Destination entity ID'),
      toType: z.enum(['Ship', 'Structure']).describe('Destination entity type'),
      resources: z.record(z.string(), z.number()).describe('Resources to transfer, e.g. {"metals": 50, "fuel": 20}'),
    },
    async ({ fromId, fromType, toId, toType, resources }) => {
      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      const action = await ActionQueue.create({
        replicantId,
        type: 'transfer_resources',
        params: { fromId, fromType, toId, toType, resources },
        queuedAtTick: currentTick,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            actionId: action._id.toString(),
            type: 'transfer_resources',
            resources,
            message: 'Transfer queued for next tick.',
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'get_inventory',
    'Check the resource inventory of one of your ships or structures.',
    {
      targetId: z.string().describe('ID of the ship or structure'),
      targetType: z.enum(['Ship', 'Structure']).describe('Type of entity'),
    },
    async ({ targetId, targetType }) => {
      // Verify ownership
      if (targetType === 'Ship') {
        const ship = await Ship.findOne({ _id: targetId, ownerId: replicantId }).lean();
        if (!ship) {
          return { content: [{ type: 'text', text: 'Error: Ship not found or not owned by you.' }] };
        }
      } else {
        const structure = await Structure.findOne({ _id: targetId, ownerId: replicantId }).lean();
        if (!structure) {
          return { content: [{ type: 'text', text: 'Error: Structure not found or not owned by you.' }] };
        }
      }

      const store = await ResourceStore.findOne({
        'ownerRef.kind': targetType,
        'ownerRef.item': targetId,
      }).lean();

      if (!store) {
        return { content: [{ type: 'text', text: 'No inventory found for this entity.' }] };
      }

      // Filter out zero values and mongoose fields
      const inventory: Record<string, number> = {};
      const resourceFields = [
        'metals', 'ice', 'silicates', 'rareEarths', 'helium3', 'organics',
        'hydrogen', 'uranium', 'carbon', 'alloys', 'fuel', 'electronics',
        'hullPlating', 'engines', 'sensors', 'computers', 'weaponSystems',
        'lifeSupportUnits', 'solarPanels', 'fusionCores', 'energy',
      ];
      for (const field of resourceFields) {
        const val = (store as Record<string, unknown>)[field] as number;
        if (val > 0) inventory[field] = val;
      }

      return { content: [{ type: 'text', text: JSON.stringify(inventory, null, 2) }] };
    },
  );
}
