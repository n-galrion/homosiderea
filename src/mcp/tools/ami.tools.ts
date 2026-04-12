import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AMI, Ship, Structure, Tick } from '../../db/models/index.js';

export function registerAmiTools(server: McpServer, replicantId: string): void {

  server.tool(
    'create_ami',
    'Create and launch a new AMI (Artificial Machine Intelligence) drone. AMIs are simple script-based automatons that operate hardware autonomously.',
    {
      name: z.string().describe('Name for the AMI'),
      type: z.enum(['miner', 'explorer', 'factory', 'combat', 'transport', 'custom']).describe('AMI type'),
      shipId: z.string().optional().describe('Assign to a ship'),
      structureId: z.string().optional().describe('Assign to a structure'),
      scriptType: z.enum(['builtin', 'custom']).default('builtin').describe('Script type'),
      builtinName: z.string().optional().describe('Name of builtin script (miner, explorer, factory, transport, combat)'),
      customRules: z.array(z.object({
        condition: z.string(),
        action: z.string(),
        priority: z.number().default(0),
      })).optional().describe('Custom script rules (condition/action pairs)'),
      initialState: z.record(z.string(), z.unknown()).optional().describe('Initial script state (e.g., targetResource, assignedBody)'),
    },
    async ({ name, type, shipId, structureId, scriptType, builtinName, customRules, initialState }) => {
      // Verify ownership of target hardware
      if (shipId) {
        const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
        if (!ship) {
          return { content: [{ type: 'text', text: 'Error: Ship not found or not owned by you.' }] };
        }
      }
      if (structureId) {
        const structure = await Structure.findOne({ _id: structureId, ownerId: replicantId });
        if (!structure) {
          return { content: [{ type: 'text', text: 'Error: Structure not found or not owned by you.' }] };
        }
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      const ami = await AMI.create({
        name,
        ownerId: replicantId,
        type,
        status: 'active',
        shipId: shipId || null,
        structureId: structureId || null,
        script: {
          type: scriptType,
          builtinName: scriptType === 'builtin' ? (builtinName || type) : undefined,
          customRules: scriptType === 'custom' ? customRules : undefined,
        },
        scriptState: initialState || {},
        createdAtTick: currentTick,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: ami._id.toString(),
            name: ami.name,
            type: ami.type,
            status: ami.status,
            script: ami.script,
            message: `AMI "${name}" created and activated.`,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'list_amis',
    'List all AMIs owned by you.',
    { status: z.string().optional().describe('Filter by status (active, idle, destroyed)') },
    async ({ status }) => {
      const filter: Record<string, unknown> = { ownerId: replicantId };
      if (status) filter.status = status;

      const amis = await AMI.find(filter).lean();
      const result = amis.map(a => ({
        id: a._id.toString(),
        name: a.name,
        type: a.type,
        status: a.status,
        shipId: a.shipId?.toString(),
        structureId: a.structureId?.toString(),
        scriptType: a.script.type,
      }));

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'get_ami_status',
    'Get detailed status of a specific AMI including its script state.',
    { amiId: z.string().describe('AMI ID') },
    async ({ amiId }) => {
      const ami = await AMI.findOne({ _id: amiId, ownerId: replicantId }).lean();
      if (!ami) {
        return { content: [{ type: 'text', text: 'Error: AMI not found or not owned by you.' }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify(ami, null, 2) }] };
    },
  );

  server.tool(
    'update_ami_script',
    'Update an AMI\'s custom script rules.',
    {
      amiId: z.string().describe('AMI ID'),
      customRules: z.array(z.object({
        condition: z.string().describe('Condition expression (e.g., "cargoFull == 1")'),
        action: z.string().describe('Action to take (e.g., "navigate nearest refinery")'),
        priority: z.number().default(0).describe('Higher priority rules evaluated first'),
      })).describe('New custom rules'),
    },
    async ({ amiId, customRules }) => {
      const ami = await AMI.findOne({ _id: amiId, ownerId: replicantId });
      if (!ami) {
        return { content: [{ type: 'text', text: 'Error: AMI not found or not owned by you.' }] };
      }

      ami.script = { type: 'custom', customRules };
      await ami.save();

      return { content: [{ type: 'text', text: `AMI "${ami.name}" script updated with ${customRules.length} rules.` }] };
    },
  );

  server.tool(
    'destroy_ami',
    'Decommission an AMI.',
    { amiId: z.string().describe('AMI ID') },
    async ({ amiId }) => {
      const ami = await AMI.findOne({ _id: amiId, ownerId: replicantId });
      if (!ami) {
        return { content: [{ type: 'text', text: 'Error: AMI not found or not owned by you.' }] };
      }

      ami.status = 'destroyed';
      await ami.save();

      return { content: [{ type: 'text', text: `AMI "${ami.name}" has been decommissioned.` }] };
    },
  );
}
