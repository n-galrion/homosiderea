import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Replicant, MemoryLog, Tick } from '../../db/models/index.js';

export function registerMemoryTools(server: McpServer, replicantId: string): void {

  server.tool(
    'write_memory',
    'Store a persistent note, observation, plan, or log entry. These memories persist across sessions.',
    {
      category: z.enum(['note', 'log', 'observation', 'plan']).default('note').describe('Memory category'),
      title: z.string().optional().describe('Short title for the memory'),
      content: z.string().describe('Memory content'),
      tags: z.array(z.string()).optional().describe('Tags for searching/filtering'),
    },
    async ({ category, title, content, tags }) => {
      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      const memory = await MemoryLog.create({
        replicantId,
        category,
        title: title || '',
        content,
        tags: tags || [],
        tick: currentTick,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: memory._id.toString(),
            category,
            title: memory.title,
            tick: currentTick,
            message: 'Memory saved.',
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'read_memories',
    'Query your stored memories. Search by category, tags, or content.',
    {
      category: z.enum(['note', 'log', 'observation', 'plan', 'directive_update']).optional(),
      tags: z.array(z.string()).optional().describe('Filter by tags'),
      search: z.string().optional().describe('Text search in content'),
      limit: z.number().optional().default(20).describe('Max results'),
    },
    async ({ category, tags, search, limit }) => {
      const filter: Record<string, unknown> = { replicantId };
      if (category) filter.category = category;
      if (tags?.length) filter.tags = { $all: tags };
      if (search) filter.content = { $regex: search, $options: 'i' };

      const memories = await MemoryLog.find(filter)
        .sort({ tick: -1 })
        .limit(limit || 20)
        .lean();

      return { content: [{ type: 'text', text: JSON.stringify(memories, null, 2) }] };
    },
  );

  server.tool(
    'update_directive',
    'Update your own directive — the guiding document that shapes your behavior (like a CLAUDE.md).',
    { directive: z.string().describe('New directive text') },
    async ({ directive }) => {
      const replicant = await Replicant.findById(replicantId);
      if (!replicant) {
        return { content: [{ type: 'text', text: 'Error: Replicant not found.' }] };
      }

      replicant.directive = directive;
      await replicant.save();

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      await MemoryLog.create({
        replicantId,
        category: 'directive_update',
        title: 'Directive updated',
        content: directive,
        tick: latestTick?.tickNumber ?? 0,
      });

      return { content: [{ type: 'text', text: 'Directive updated successfully.' }] };
    },
  );

  server.tool(
    'read_directive',
    'Read your current directive.',
    {},
    async () => {
      const replicant = await Replicant.findById(replicantId).lean();
      return { content: [{ type: 'text', text: replicant?.directive || 'No directive set.' }] };
    },
  );
}
