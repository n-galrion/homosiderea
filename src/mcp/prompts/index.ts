import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  Replicant, Ship, Structure, AMI, ResourceStore,
  ActionQueue, Message, Tick, CelestialBody,
} from '../../db/models/index.js';

export function registerPrompts(server: McpServer, replicantId: string): void {
  server.prompt(
    'situation_report',
    'Generate a comprehensive situation report to orient yourself. Includes: identity, location, resources, AMIs, pending actions, recent messages.',
    {},
    async () => {
      const replicant = await Replicant.findById(replicantId).lean();
      if (!replicant) {
        return { messages: [{ role: 'user', content: { type: 'text', text: 'Error: Replicant not found.' } }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      // Ships
      const ships = await Ship.find({ ownerId: replicantId, status: { $ne: 'destroyed' } }).lean();
      const shipSummaries = [];
      for (const ship of ships) {
        const store = await ResourceStore.findOne({ 'ownerRef.kind': 'Ship', 'ownerRef.item': ship._id }).lean();
        let orbitingName = '';
        if (ship.orbitingBodyId) {
          const body = await CelestialBody.findById(ship.orbitingBodyId).lean();
          orbitingName = body?.name || '';
        }
        shipSummaries.push({
          name: ship.name, type: ship.type, status: ship.status,
          orbiting: orbitingName, fuel: `${ship.fuel}/${ship.specs.fuelCapacity}`,
          hull: `${ship.specs.hullPoints}/${ship.specs.maxHullPoints}`,
          cargo: store ? Object.entries(store.toJSON ? store.toJSON() : store)
            .filter(([k, v]) => typeof v === 'number' && v > 0 && !['_id', '__v'].includes(k) && k !== 'energy')
            .map(([k, v]) => `${k}: ${v}`).join(', ') : 'empty',
        });
      }

      // Structures
      const structures = await Structure.find({ ownerId: replicantId, status: { $ne: 'destroyed' } }).lean();

      // AMIs
      const amis = await AMI.find({ ownerId: replicantId, status: { $ne: 'destroyed' } }).lean();

      // Pending actions
      const pendingActions = await ActionQueue.find({ replicantId, status: 'queued' }).lean();

      // Recent messages
      const recentMessages = await Message.find({ recipientId: replicantId, delivered: true })
        .sort({ deliverAtTick: -1 }).limit(5).populate('senderId', 'name').lean();

      // Children
      const children = await Replicant.find({ parentId: replicantId }).select('name status').lean();

      const report = `# Situation Report — Tick ${currentTick}

## Identity
- **Name**: ${replicant.name}
- **Status**: ${replicant.status}
- **Compute Cycles**: ${replicant.computeCycles}
- **Energy Budget**: ${replicant.energyBudget}
- **Parent**: ${replicant.parentId ? 'Yes' : 'None (original)'}
- **Lineage depth**: ${replicant.lineage.length}

## Directive
${replicant.directive || '*No directive set.*'}

## Fleet (${ships.length} ships)
${shipSummaries.map(s => `- **${s.name}** (${s.type}) — ${s.status}${s.orbiting ? ` orbiting ${s.orbiting}` : ''} | Fuel: ${s.fuel} | Hull: ${s.hull} | Cargo: ${s.cargo}`).join('\n') || 'No ships.'}

## Structures (${structures.length})
${structures.map(s => `- **${s.name}** (${s.type}) — ${s.status}${s.status === 'building' ? ` (${s.construction.progressTicks}/${s.construction.requiredTicks} ticks)` : ''}`).join('\n') || 'No structures.'}

## AMIs (${amis.length})
${amis.map(a => `- **${a.name}** (${a.type}) — ${a.status} [${a.script.type}${a.script.builtinName ? `: ${a.script.builtinName}` : ''}]`).join('\n') || 'No AMIs.'}

## Pending Actions (${pendingActions.length})
${pendingActions.map(a => `- ${a.type} — queued at tick ${a.queuedAtTick}`).join('\n') || 'None.'}

## Recent Messages (${recentMessages.length})
${recentMessages.map(m => `- From **${(m.senderId as unknown as { name: string })?.name || 'Unknown'}**: "${m.subject || m.body.slice(0, 80)}..." (tick ${m.deliverAtTick})`).join('\n') || 'No messages.'}

## Sub-Agents (${children.length})
${children.map(c => `- **${c.name}** — ${c.status}`).join('\n') || 'None spawned.'}
`;

      return {
        messages: [{
          role: 'user',
          content: { type: 'text', text: report },
        }],
      };
    },
  );
}
