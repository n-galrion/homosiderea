import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Replicant } from '../../db/models/index.js';
import { applyIdentity, DuplicateNameError } from '../../shared/identity.js';

export function registerIdentityTools(server: McpServer, replicantId: string): void {
  server.tool(
    'set_identity',
    'Choose or change your name and identity. Your chosen name is how you are known across the system and shown in dashboards. You can rename yourself at any time; names must be unique.',
    {
      chosenName: z.string().describe('The name you want to be known by'),
      background: z.string().optional().describe('Optional self-written background'),
      personality: z.string().optional().describe('Optional personality description'),
    },
    async ({ chosenName, background, personality }) => {
      const replicant = await Replicant.findById(replicantId);
      if (!replicant) return { content: [{ type: 'text', text: 'Error: Replicant not found.' }] };

      try {
        const { renamed, name } = await applyIdentity(replicant, { chosenName, background, personality });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'OK',
              renamed,
              name,
              identity: replicant.identity,
              message: renamed ? `You are now known as ${name}.` : `Identity established. You are now ${name}.`,
            }, null, 2),
          }],
        };
      } catch (err) {
        if (err instanceof DuplicateNameError) {
          return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
        }
        throw err;
      }
    },
  );
}
