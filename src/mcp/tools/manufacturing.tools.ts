import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Blueprint, Ship, CelestialBody, Structure, ActionQueue, Tick } from '../../db/models/index.js';

export function registerManufacturingTools(server: McpServer, replicantId: string): void {

  server.tool(
    'list_blueprints',
    'List available manufacturing, refining, ship, and structure blueprints.',
    { category: z.enum(['refining', 'component', 'ship', 'structure']).optional().describe('Filter by category') },
    async ({ category }) => {
      const filter: Record<string, unknown> = {};
      if (category) filter.category = category;

      const blueprints = await Blueprint.find(filter).lean();
      const result = blueprints.map(bp => ({
        id: bp._id.toString(),
        name: bp.name,
        category: bp.category,
        description: bp.description,
        inputs: bp.inputs,
        outputs: bp.outputs,
        ticksToBuild: bp.ticksToBuild,
        energyCost: bp.energyCost,
        requiredStructureType: bp.requiredStructureType,
        techLevel: bp.techLevel,
      }));

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'manufacture',
    'Produce items from a blueprint at one of your factories or refineries.',
    {
      structureId: z.string().describe('ID of the factory/refinery structure'),
      blueprintId: z.string().describe('ID of the blueprint to use'),
      quantity: z.number().default(1).describe('Number of batches to produce'),
    },
    async ({ structureId, blueprintId, quantity }) => {
      const structure = await Structure.findOne({ _id: structureId, ownerId: replicantId });
      if (!structure) {
        return { content: [{ type: 'text', text: 'Error: Structure not found or not owned by you.' }] };
      }

      const blueprint = await Blueprint.findById(blueprintId);
      if (!blueprint) {
        return { content: [{ type: 'text', text: 'Error: Blueprint not found.' }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      const action = await ActionQueue.create({
        replicantId,
        type: 'manufacture',
        params: { structureId, blueprintId, quantity },
        queuedAtTick: currentTick,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            actionId: action._id.toString(),
            blueprint: blueprint.name,
            quantity,
            message: `Manufacturing queued at ${structure.name}.`,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'build_structure',
    'Begin constructing a structure on a celestial body. Your ship must be orbiting the body with required materials.',
    {
      bodyId: z.string().describe('Celestial body to build on'),
      shipId: z.string().describe('Ship orbiting the body (materials deducted from its cargo)'),
      structureType: z.enum([
        'habitat', 'mine', 'refinery', 'factory', 'solar_array',
        'fusion_plant', 'shipyard', 'sensor_station', 'relay_station',
      ]).describe('Type of structure to build'),
      name: z.string().describe('Name for the new structure'),
      siteId: z.string().optional().describe('Landing site ID (required for colonies)'),
      colonyId: z.string().optional().describe('Colony ID to attach structure to'),
    },
    async ({ bodyId, shipId, structureType, name, siteId, colonyId }) => {
      const body = await CelestialBody.findById(bodyId);
      if (!body) {
        return { content: [{ type: 'text', text: 'Error: Celestial body not found.' }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      const action = await ActionQueue.create({
        replicantId,
        type: 'build_structure',
        params: { bodyId, shipId, structureType, name, siteId, colonyId },
        queuedAtTick: currentTick,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            actionId: action._id.toString(),
            structureType,
            location: body.name,
            message: `Construction of ${name} (${structureType}) queued on ${body.name}.`,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'build_ship',
    'Build a new ship at one of your shipyards.',
    {
      shipyardId: z.string().describe('ID of the shipyard structure'),
      blueprintId: z.string().describe('ID of the ship blueprint'),
      name: z.string().describe('Name for the new ship'),
    },
    async ({ shipyardId, blueprintId, name }) => {
      const shipyard = await Structure.findOne({ _id: shipyardId, ownerId: replicantId, type: 'shipyard' });
      if (!shipyard) {
        return { content: [{ type: 'text', text: 'Error: Shipyard not found or not owned by you.' }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      const action = await ActionQueue.create({
        replicantId,
        type: 'build_ship',
        params: { shipyardId, blueprintId, name },
        queuedAtTick: currentTick,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            actionId: action._id.toString(),
            message: `Ship construction queued at ${shipyard.name}.`,
          }, null, 2),
        }],
      };
    },
  );
}
