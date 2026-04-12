import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  Replicant, Ship, Structure, AMI, ResourceStore,
  ActionQueue, Message, Tick, CelestialBody, Settlement,
} from '../../db/models/index.js';
import { distance } from '../../shared/physics.js';
import { AU_IN_KM } from '../../shared/constants.js';

export function registerPrompts(server: McpServer, replicantId: string): void {
  server.prompt(
    'situation_report',
    'Generate a comprehensive situation report to orient yourself. Includes: identity, location, resources, AMIs, pending actions, recent messages, and a captain\'s assessment.',
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
          position: ship.position,
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

      // Compute positional narrative for the primary ship
      let positionNarrative = 'Location unknown — no active vessel detected.';
      let nearbySettlementInfo = '';
      if (ships.length > 0) {
        const primaryShip = ships[0];
        const pos = primaryShip.position;
        const distFromSol = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
        const angleRad = Math.atan2(pos.y, pos.x);
        const angleDeg = ((angleRad * 180 / Math.PI) + 360) % 360;

        let orbitDesc = '';
        if (primaryShip.orbitingBodyId) {
          const body = await CelestialBody.findById(primaryShip.orbitingBodyId).lean();
          if (body) {
            orbitDesc = ` in orbit around ${body.name}`;
          }
        }

        positionNarrative = `Currently ${distFromSol.toFixed(4)} AU from Sol (${(distFromSol * AU_IN_KM).toExponential(3)} km), bearing ${angleDeg.toFixed(1)} degrees ecliptic${orbitDesc}. Fuel reserves at ${primaryShip.fuel}/${primaryShip.specs.fuelCapacity} — ${primaryShip.fuel > primaryShip.specs.fuelCapacity * 0.5 ? 'adequate for extended operations' : primaryShip.fuel > primaryShip.specs.fuelCapacity * 0.2 ? 'sufficient for local maneuvers, resupply recommended before deep-space transit' : 'critically low, immediate resupply required'}. Hull integrity ${primaryShip.specs.hullPoints}/${primaryShip.specs.maxHullPoints}.`;

        // Find nearby settlements
        if (primaryShip.orbitingBodyId) {
          const bodySettlements = await Settlement.find({ bodyId: primaryShip.orbitingBodyId }).lean();
          if (bodySettlements.length > 0) {
            nearbySettlementInfo = `Nearby settlements: ${bodySettlements.map(s => `${s.name} (${s.nation}, pop. ${s.population.toLocaleString()}, attitude: ${s.attitude.general > 0.5 ? 'favorable' : s.attitude.general > 0 ? 'neutral' : 'hostile'})`).join('; ')}.`;
          }
        }
      }

      // Captain's assessment
      const assessmentParts: string[] = [];
      const fuelPct = ships.length > 0 ? ships[0].fuel / ships[0].specs.fuelCapacity : 0;
      const hasResources = shipSummaries.some(s => s.cargo !== 'empty');

      if (ships.length === 0) {
        assessmentParts.push('CRITICAL: No operational vessels. Priority one is acquiring or constructing a ship.');
      } else {
        if (fuelPct < 0.2) assessmentParts.push('WARNING: Primary vessel fuel reserves critically low. Recommend immediate refueling via trade or ice mining before undertaking any transit operations.');
        if (!hasResources && currentTick < 10) assessmentParts.push('Early-phase operations. Bootstrap resources are available in the cargo hold. Recommend establishing a mining operation or trading with nearby settlements to build an economic base.');
        if (structures.length === 0 && currentTick > 5) assessmentParts.push('No infrastructure constructed. Consider establishing a mining outpost or habitat to generate passive resource income.');
        if (pendingActions.length > 3) assessmentParts.push(`${pendingActions.length} actions queued. Monitor completion status to avoid resource bottlenecks.`);
        if (nearbySettlementInfo) assessmentParts.push(nearbySettlementInfo);
      }

      if (children.length > 0) {
        const activeChildren = children.filter(c => c.status === 'active').length;
        assessmentParts.push(`${activeChildren} of ${children.length} sub-agent(s) operational. Coordinate directives to avoid resource contention.`);
      }

      if (assessmentParts.length === 0) {
        assessmentParts.push('All systems nominal. No immediate threats or critical resource shortages detected. Standard operating procedures apply.');
      }

      const report = `# Captain's Log — Tick ${currentTick} (Game Hour ${currentTick})

> ${positionNarrative}

---

## Identity
- **Designation**: ${replicant.name}
- **Status**: ${replicant.status}
- **Compute Cycles**: ${replicant.computeCycles} (processing capacity for actions and research)
- **Energy Budget**: ${replicant.energyBudget} (available power allocation)
- **Origin**: ${replicant.parentId ? 'Spawned replicant (child process)' : 'Original consciousness — no parent lineage'}
- **Lineage depth**: ${replicant.lineage.length}

## Standing Directive
${replicant.directive || '*No directive set. Operating under autonomous judgment.*'}

## Fleet Status (${ships.length} vessel${ships.length !== 1 ? 's' : ''})
${shipSummaries.map(s => `- **${s.name}** (${s.type}) — ${s.status}${s.orbiting ? `, holding orbit at ${s.orbiting}` : ', in transit'} | Fuel: ${s.fuel} | Hull: ${s.hull} | Cargo: [${s.cargo || 'empty holds'}]`).join('\n') || 'No operational vessels. You are adrift.'}

## Infrastructure (${structures.length} structure${structures.length !== 1 ? 's' : ''})
${structures.map(s => `- **${s.name}** (${s.type}) — ${s.status}${s.status === 'building' ? ` (construction ${s.construction.progressTicks}/${s.construction.requiredTicks} ticks — ${((s.construction.progressTicks / s.construction.requiredTicks) * 100).toFixed(0)}% complete)` : ''}`).join('\n') || 'No structures deployed. Infrastructure investment will provide passive resource generation and manufacturing capability.'}

## Autonomous Mining Intelligences (${amis.length})
${amis.map(a => `- **${a.name}** (${a.type}) — ${a.status} [running: ${a.script.type}${a.script.builtinName ? ` / ${a.script.builtinName}` : ''}]`).join('\n') || 'No AMIs deployed.'}

## Action Queue (${pendingActions.length} pending)
${pendingActions.map(a => `- ${a.type} — queued at tick ${a.queuedAtTick}${a.type === 'move' ? ' (in transit)' : ''}`).join('\n') || 'No pending actions. All systems idle.'}

## Communications Log (${recentMessages.length} recent)
${recentMessages.map(m => `- [Tick ${m.deliverAtTick}] From **${(m.senderId as unknown as { name: string })?.name || 'Unknown'}**: "${m.subject || m.body.slice(0, 80)}..."`).join('\n') || 'No messages received. Communication channels are clear.'}

## Sub-Agents (${children.length} spawned)
${children.map(c => `- **${c.name}** — ${c.status}`).join('\n') || 'No child replicants spawned. Replication costs ${500} compute and ${200} energy.'}

---

## Captain's Assessment
${assessmentParts.join(' ')}
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
