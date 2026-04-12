import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nanoid } from 'nanoid';
import { Replicant, Ship, AMI, MemoryLog, Tick, ResourceStore, Technology, ScanData, NavigationData, KnownEntity, Notification } from '../../db/models/index.js';
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
      const childPassword = nanoid(16); // Auto-generated password for easy auth

      // Create the new replicant with inherited tech levels
      const child = await Replicant.create({
        name,
        apiKey,
        password: childPassword,
        parentId: parent._id,
        lineage: [...parent.lineage, parent._id],
        directive,
        techLevels: { ...parent.techLevels as Record<string, number> }, // Inherit tech levels
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

      // Create 2 starter miner drones for the child
      await AMI.insertMany([
        `${name}'s Miner Drone Alpha`, `${name}'s Miner Drone Beta`,
      ].map(droneName => ({
        name: droneName, ownerId: child._id, type: 'miner',
        status: 'idle', shipId: ship._id,
        script: { type: 'builtin', builtinName: 'miner' },
        specs: { miningRate: 3, cargoCapacity: 50, sensorRange: 0.1, speed: 0, combatPower: 0, manufacturingRate: 0 },
        createdAtTick: currentTick,
      })));

      // ── Inherit knowledge ──

      // 1. Seed memories from parent
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

      // 2. Copy parent's last 50 log entries
      const parentLogs = await MemoryLog.find({
        replicantId: parent._id,
        category: 'log',
      }).sort({ tick: -1 }).limit(50).lean();

      if (parentLogs.length > 0) {
        await MemoryLog.insertMany(
          parentLogs.map(log => ({
            replicantId: child._id,
            category: 'log',
            title: `[Inherited] ${log.title}`,
            content: log.content,
            tags: ['inherited', ...(log.tags || [])],
            tick: currentTick,
          })),
        );
      }

      // 3. Inherit all technologies
      const parentTechs = await Technology.find({ knownBy: parent._id });
      for (const tech of parentTechs) {
        if (!tech.knownBy.some(id => id.toString() === child._id.toString())) {
          tech.knownBy.push(child._id);
          await tech.save();
        }
      }

      // 4. Copy parent's scan data
      const parentScans = await ScanData.find({ ownerId: parent._id }).sort({ scanTick: -1 }).limit(30).lean();
      if (parentScans.length > 0) {
        await ScanData.insertMany(
          parentScans.map(scan => ({
            ...scan,
            _id: undefined,
            ownerId: child._id,
            shared: false,
            sharedWith: [],
          })),
        );
      }

      // 5. Copy parent's nav data
      const parentNavs = await NavigationData.find({ ownerId: parent._id }).sort({ computedAtTick: -1 }).limit(20).lean();
      if (parentNavs.length > 0) {
        await NavigationData.insertMany(
          parentNavs.map(nav => ({
            ...nav,
            _id: undefined,
            ownerId: child._id,
            shared: false,
            sharedWith: [],
          })),
        );
      }

      // 6. Copy parent's known entities (fog of war knowledge)
      const parentKnowledge = await KnownEntity.find({ replicantId: parent._id }).lean();
      if (parentKnowledge.length > 0) {
        await KnownEntity.insertMany(
          parentKnowledge.map(k => ({
            ...k,
            _id: undefined,
            replicantId: child._id,
            discoveredBy: 'shared' as const,
          })),
        );
      }

      // Deduct from parent
      parent.computeCycles -= REPLICATE_COMPUTE_COST;
      parent.energyBudget -= REPLICATE_ENERGY_COST;
      await parent.save();

      // Create dashboard notification — operator needs to connect an agent
      await Notification.create({
        type: 'replicant_spawned',
        title: `New Replicant: ${name}`,
        body: `${parent.name} spawned "${name}" at tick ${currentTick}. The new replicant needs an AI agent connected to it.`,
        data: {
          childId: child._id.toString(),
          childName: name,
          parentName: parent.name,
          password: childPassword,
          shipName: ship.name,
          location: ship.orbitingBodyId?.toString() || 'in transit',
        },
        tick: currentTick,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            childId: child._id.toString(),
            childName: child.name,
            apiKey,
            password: childPassword,
            shipTransferred: ship.name,
            inherited: {
              technologies: parentTechs.length,
              scanData: parentScans.length,
              navData: parentNavs.length,
              memories: parentLogs.length + (initialMemories?.length || 0),
              knownEntities: parentKnowledge.length,
              techLevels: child.techLevels,
              minerDrones: 2,
            },
            connection: {
              mcp: 'Connect to /mcp with X-Replicant-Name + X-Replicant-Password headers',
              rest: `Authenticate with X-Replicant-Name: ${name} and X-Replicant-Password: ${childPassword}`,
              note: 'The new replicant needs an AI agent to connect and drive it.',
            },
            parentComputeRemaining: parent.computeCycles,
            parentEnergyRemaining: parent.energyBudget,
            message: `Replicant "${name}" has been spawned with full knowledge inheritance: ${parentTechs.length} technologies, ${parentScans.length} scans, ${parentKnowledge.length} known locations. They are now fully autonomous.`,
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
