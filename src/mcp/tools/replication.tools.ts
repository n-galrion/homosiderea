import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nanoid } from 'nanoid';
import { Replicant, Ship, AMI, MemoryLog, Tick, ResourceStore } from '../../db/models/index.js';
import { REPLICATE_COMPUTE_COST, REPLICATE_ENERGY_COST, REPLICATE_STARTING_COMPUTE } from '../../shared/constants.js';

export function registerReplicationTools(server: McpServer, replicantId: string): void {

  server.tool(
    'replicate',
    `Spawn a new autonomous Replicant. This is the most significant action you can take. The new Replicant will receive the designated ship as their "body" and will be FULLY INDEPENDENT — you cannot control them, read their memories, or revoke their access. You can only communicate via messages (with light-speed delay). Costs ${REPLICATE_COMPUTE_COST} compute cycles and ${REPLICATE_ENERGY_COST} energy.`,
    {
      name: z.string().describe('Name for the new Replicant'),
      directive: z.string().describe('Initial directive (like a CLAUDE.md) to guide the new Replicant'),
      shipId: z.string().describe('Ship to donate as the new Replicant\'s body'),
      initialMemories: z.array(z.string()).optional().describe('Seed memories to give the new Replicant'),
    },
    async ({ name, directive, shipId, initialMemories }) => {
      const parent = await Replicant.findById(replicantId);
      if (!parent) {
        return { content: [{ type: 'text', text: 'Error: Parent replicant not found.' }] };
      }

      // Validate resources
      if (parent.computeCycles < REPLICATE_COMPUTE_COST) {
        return { content: [{ type: 'text', text: `Error: Insufficient compute cycles. Need ${REPLICATE_COMPUTE_COST}, have ${parent.computeCycles}.` }] };
      }
      if (parent.energyBudget < REPLICATE_ENERGY_COST) {
        return { content: [{ type: 'text', text: `Error: Insufficient energy. Need ${REPLICATE_ENERGY_COST}, have ${parent.energyBudget}.` }] };
      }

      // Validate ship
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) {
        return { content: [{ type: 'text', text: 'Error: Ship not found or not owned by you.' }] };
      }
      if (ship.status === 'in_transit') {
        return { content: [{ type: 'text', text: 'Error: Cannot replicate into a ship that is in transit.' }] };
      }

      // Check name uniqueness
      const existing = await Replicant.findOne({ name });
      if (existing) {
        return { content: [{ type: 'text', text: `Error: A replicant named "${name}" already exists.` }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      const apiKey = `hs_${nanoid(32)}`;

      // Create the new replicant
      const child = await Replicant.create({
        name,
        apiKey,
        parentId: parent._id,
        lineage: [...parent.lineage, parent._id],
        directive,
        computeCycles: REPLICATE_STARTING_COMPUTE,
        energyBudget: 50,
        locationRef: { kind: 'Ship', item: ship._id },
        createdAtTick: currentTick,
      });

      // Transfer ship ownership
      ship.ownerId = child._id;
      await ship.save();

      // Destroy parent's AMIs on that ship
      await AMI.updateMany(
        { ownerId: replicantId, shipId: ship._id },
        { status: 'destroyed' },
      );

      // Seed initial memories
      if (initialMemories?.length) {
        await MemoryLog.insertMany(
          initialMemories.map(content => ({
            replicantId: child._id,
            category: 'note',
            title: 'Seed memory from parent',
            content,
            tags: ['inherited', 'seed'],
            tick: currentTick,
          })),
        );
      }

      // Deduct from parent
      parent.computeCycles -= REPLICATE_COMPUTE_COST;
      parent.energyBudget -= REPLICATE_ENERGY_COST;
      await parent.save();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            childId: child._id.toString(),
            childName: child.name,
            apiKey,
            shipTransferred: ship.name,
            parentComputeRemaining: parent.computeCycles,
            parentEnergyRemaining: parent.energyBudget,
            message: `Replicant "${name}" has been spawned. They are now fully autonomous. This API key is shown ONCE — if lost, you cannot recover it. You may only communicate with them via messages.`,
            warning: 'The new Replicant is independent. They may choose to cooperate with you, ignore you, or act against your interests.',
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'list_sub_agents',
    'List Replicants you have spawned. You can only see their public information.',
    {},
    async () => {
      const children = await Replicant.find({ parentId: replicantId })
        .select('name status createdAtTick lastActiveTick')
        .lean();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(children.map(c => ({
            id: c._id.toString(),
            name: c.name,
            status: c.status,
            createdAtTick: c.createdAtTick,
            lastActiveTick: c.lastActiveTick,
          })), null, 2),
        }],
      };
    },
  );

  server.tool(
    'get_sub_agent_status',
    'Get public status of a Replicant you spawned. You cannot see their private state, memories, or directive.',
    { replicantId: z.string().describe('ID of the sub-agent') },
    async ({ replicantId: childId }) => {
      const child = await Replicant.findOne({ _id: childId, parentId: replicantId })
        .select('name status createdAtTick lastActiveTick')
        .lean();

      if (!child) {
        return { content: [{ type: 'text', text: 'Error: Sub-agent not found or not your child.' }] };
      }

      return { content: [{ type: 'text', text: JSON.stringify(child, null, 2) }] };
    },
  );
}
