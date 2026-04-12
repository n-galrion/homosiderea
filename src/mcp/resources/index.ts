import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Replicant, CelestialBody, Tick } from '../../db/models/index.js';

export function registerResources(server: McpServer, replicantId: string): void {
  server.resource(
    'directive',
    'homosideria://directive',
    { description: 'Your current directive document' },
    async () => {
      const replicant = await Replicant.findById(replicantId).lean();
      return {
        contents: [{
          uri: 'homosideria://directive',
          mimeType: 'text/markdown',
          text: replicant?.directive || 'No directive set.',
        }],
      };
    },
  );

  server.resource(
    'world-state',
    'homosideria://world/tick',
    { description: 'Current game tick information' },
    async () => {
      const tick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      return {
        contents: [{
          uri: 'homosideria://world/tick',
          mimeType: 'application/json',
          text: JSON.stringify(tick || { tickNumber: 0, message: 'No ticks yet' }),
        }],
      };
    },
  );

  server.resource(
    'solar-system',
    'homosideria://world/bodies',
    { description: 'All celestial bodies with current positions' },
    async () => {
      const bodies = await CelestialBody.find()
        .select('name type position solarEnergyFactor resources')
        .lean();
      return {
        contents: [{
          uri: 'homosideria://world/bodies',
          mimeType: 'application/json',
          text: JSON.stringify(bodies),
        }],
      };
    },
  );
}
