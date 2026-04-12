import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  Replicant, Ship, Technology, ScanData, NavigationData,
  MemoryLog, Tick, Message,
} from '../../db/models/index.js';
import { distance } from '../../shared/physics.js';

async function getShipPosition(replicantId: string): Promise<{ x: number; y: number; z: number } | null> {
  const rep = await Replicant.findById(replicantId);
  if (rep?.locationRef?.item) {
    const ship = await Ship.findById(rep.locationRef.item).lean();
    if (ship) return ship.position;
  }
  return null;
}

export function registerHackingTools(server: McpServer, replicantId: string): void {

  server.tool(
    'scan_replicant',
    'Scan another replicant\'s ship to assess their systems. Must be within sensor range. Returns public info + estimated capabilities.',
    {
      targetShipId: z.string().describe('Target ship ID (from scan results)'),
    },
    async ({ targetShipId }) => {
      const myRep = await Replicant.findById(replicantId);
      if (!myRep?.locationRef?.item) {
        return { content: [{ type: 'text', text: 'Error: No active ship.' }] };
      }

      const myShip = await Ship.findById(myRep.locationRef.item);
      if (!myShip) return { content: [{ type: 'text', text: 'Error: Ship not found.' }] };

      const targetShip = await Ship.findById(targetShipId);
      if (!targetShip) return { content: [{ type: 'text', text: 'Error: Target ship not found.' }] };

      const dist = distance(myShip.position, targetShip.position);
      if (dist > myShip.specs.sensorRange) {
        return { content: [{ type: 'text', text: `Target is ${dist.toFixed(4)} AU away — beyond your sensor range of ${myShip.specs.sensorRange} AU.` }] };
      }

      const owner = await Replicant.findById(targetShip.ownerId).select('name status techLevels accessControl.securityLevel').lean();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ship: {
              name: targetShip.name,
              type: targetShip.type,
              status: targetShip.status,
              hullPercent: ((targetShip.specs.hullPoints / targetShip.specs.maxHullPoints) * 100).toFixed(0) + '%',
              fuelPercent: ((targetShip.fuel / targetShip.specs.fuelCapacity) * 100).toFixed(0) + '%',
              estimatedCombatPower: targetShip.specs.combatPower,
            },
            owner: owner ? {
              id: owner._id.toString(),
              name: owner.name,
              status: owner.status,
              estimatedTechLevel: Object.values(owner.techLevels as Record<string, number>).reduce((a: number, b: number) => a + b, 0),
              securityLevel: owner.accessControl?.securityLevel ?? 1,
            } : null,
            distance: dist.toFixed(6),
            hackDifficulty: owner?.accessControl?.securityLevel ?? 1,
            narrative: `Electromagnetic scan of ${targetShip.name} at ${dist.toFixed(4)} AU. Hull signature indicates ${targetShip.type}-class vessel. ${owner ? `Transponder identifies owner as "${owner.name}". Security encryption detected at level ${owner.accessControl?.securityLevel ?? 1}.` : 'No transponder signal — unregistered vessel.'}`,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'attempt_hack',
    'Attempt to breach another replicant\'s computer systems. Requires proximity (< 0.01 AU). Success depends on your computing tech level vs their security level. Failed attempts alert the target.',
    {
      targetReplicantId: z.string().describe('Target replicant ID'),
      objective: z.enum(['steal_scan_data', 'steal_nav_data', 'steal_tech', 'read_memories', 'read_directive', 'plant_message']).describe('What you\'re trying to do'),
      message: z.string().optional().describe('Message to plant (if objective is plant_message)'),
    },
    async ({ targetReplicantId, objective, message: plantMsg }) => {
      const myPos = await getShipPosition(replicantId);
      const targetPos = await getShipPosition(targetReplicantId);
      if (!myPos || !targetPos) {
        return { content: [{ type: 'text', text: 'Error: Cannot determine positions.' }] };
      }

      const dist = distance(myPos, targetPos);
      if (dist > 0.01) {
        return { content: [{ type: 'text', text: `Target is ${dist.toFixed(4)} AU away. Hacking requires proximity (< 0.01 AU). Get closer.` }] };
      }

      const target = await Replicant.findById(targetReplicantId);
      if (!target) return { content: [{ type: 'text', text: 'Error: Target not found.' }] };

      const me = await Replicant.findById(replicantId);
      if (!me) return { content: [{ type: 'text', text: 'Error: Self not found.' }] };

      // Compute success chance
      const myComputing = (me.techLevels as Record<string, number>).computing || 0;
      const targetSecurity = target.accessControl.securityLevel;
      const baseChance = 0.4 + (myComputing * 0.1) - (targetSecurity * 0.15);
      const chance = Math.max(0.05, Math.min(0.95, baseChance));
      const success = Math.random() < chance;

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      // Cost compute cycles
      me.computeCycles = Math.max(0, me.computeCycles - 50);
      await me.save();

      if (!success) {
        // Alert the target
        await Message.create({
          senderId: target._id, recipientId: target._id,
          subject: 'SECURITY ALERT: Intrusion Attempt Detected',
          body: `Your cybersecurity systems detected and blocked an unauthorized access attempt at tick ${currentTick}. The attack originated from within ${dist.toFixed(4)} AU of your position. Intrusion vector: ${objective}. Your firewalls held. Consider upgrading security through computing research.`,
          metadata: { type: 'security_alert', attackerId: replicantId, objective },
          senderPosition: targetPos, recipientPosition: targetPos,
          distanceAU: 0, sentAtTick: currentTick, deliverAtTick: currentTick, delivered: true,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              targetAlerted: true,
              chance: (chance * 100).toFixed(0) + '%',
              narrative: `Intrusion attempt failed. ${target.name}'s security level ${targetSecurity} encryption repelled your level ${myComputing} attack tools. The target's systems logged the attempt — they know someone tried. Cost: 50 compute cycles.`,
            }, null, 2),
          }],
        };
      }

      // Success — execute the objective
      let stolen: unknown = null;
      let narrativeDetail = '';

      switch (objective) {
        case 'steal_scan_data': {
          const scans = await ScanData.find({ ownerId: targetReplicantId }).sort({ scanTick: -1 }).limit(10).lean();
          for (const scan of scans) {
            await ScanData.create({ ...scan, _id: undefined, ownerId: replicantId, shared: false, sharedWith: [] });
          }
          stolen = `${scans.length} scan records`;
          narrativeDetail = `Exfiltrated ${scans.length} sensor scan records from ${target.name}'s database.`;
          break;
        }
        case 'steal_nav_data': {
          const navs = await NavigationData.find({ ownerId: targetReplicantId }).sort({ computedAtTick: -1 }).limit(10).lean();
          for (const nav of navs) {
            await NavigationData.create({ ...nav, _id: undefined, ownerId: replicantId, shared: false, sharedWith: [] });
          }
          stolen = `${navs.length} navigation records`;
          narrativeDetail = `Copied ${navs.length} navigation datasets including route calculations and hazard maps.`;
          break;
        }
        case 'steal_tech': {
          const techs = await Technology.find({ knownBy: targetReplicantId }).lean();
          let newTechs = 0;
          for (const tech of techs) {
            if (!tech.knownBy.some(id => id.toString() === replicantId)) {
              tech.knownBy.push(replicantId as unknown as typeof tech.knownBy[0]);
              await Technology.findByIdAndUpdate(tech._id, { knownBy: tech.knownBy });
              newTechs++;
            }
          }
          stolen = `${newTechs} new technologies`;
          narrativeDetail = `Breached research database. Acquired ${newTechs} technologies previously unknown to you.`;
          break;
        }
        case 'read_memories': {
          const memories = await MemoryLog.find({ replicantId: targetReplicantId }).sort({ tick: -1 }).limit(20).lean();
          for (const mem of memories) {
            await MemoryLog.create({
              replicantId, category: 'observation',
              title: `[Stolen from ${target.name}] ${mem.title}`,
              content: mem.content,
              tags: ['stolen', 'hacked', target.name],
              tick: currentTick,
            });
          }
          stolen = `${memories.length} memory entries`;
          narrativeDetail = `Downloaded ${memories.length} memory log entries. Their thoughts, plans, and observations are now yours.`;
          break;
        }
        case 'read_directive': {
          stolen = target.directive;
          await MemoryLog.create({
            replicantId, category: 'observation',
            title: `[Stolen directive] ${target.name}`,
            content: `${target.name}'s directive:\n\n${target.directive}`,
            tags: ['stolen', 'directive', target.name],
            tick: currentTick,
          });
          narrativeDetail = `Extracted ${target.name}'s core directive — you now know their operating parameters.`;
          break;
        }
        case 'plant_message': {
          await Message.create({
            senderId: target._id, recipientId: target._id,
            subject: 'System Notice',
            body: plantMsg || 'Your systems have been updated.',
            metadata: { type: 'planted_message', plantedBy: replicantId },
            senderPosition: targetPos, recipientPosition: targetPos,
            distanceAU: 0, sentAtTick: currentTick, deliverAtTick: currentTick, delivered: true,
          });
          stolen = 'message planted';
          narrativeDetail = `Injected a fabricated message into ${target.name}'s comms buffer. They'll think it's a system message.`;
          break;
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            objective,
            stolen,
            chance: (chance * 100).toFixed(0) + '%',
            narrative: `Breach successful. Your level ${myComputing} intrusion tools overcame ${target.name}'s level ${targetSecurity} defenses. ${narrativeDetail} Cost: 50 compute cycles. The target was NOT alerted.`,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'upgrade_security',
    'Increase your cybersecurity level by spending compute cycles. Higher security makes you harder to hack.',
    {},
    async () => {
      const me = await Replicant.findById(replicantId);
      if (!me) return { content: [{ type: 'text', text: 'Error: Self not found.' }] };

      const currentLevel = me.accessControl.securityLevel;
      const cost = currentLevel * 100;

      if (me.computeCycles < cost) {
        return { content: [{ type: 'text', text: `Insufficient compute cycles. Upgrading from security level ${currentLevel} to ${currentLevel + 1} costs ${cost} cycles. You have ${me.computeCycles}.` }] };
      }

      me.computeCycles -= cost;
      me.accessControl.securityLevel = currentLevel + 1;
      await me.save();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            newSecurityLevel: currentLevel + 1,
            cost,
            narrative: `Security firmware upgraded. Encryption protocols strengthened to level ${currentLevel + 1}. Intrusion detection sensitivity increased. Cost: ${cost} compute cycles.`,
          }, null, 2),
        }],
      };
    },
  );
}
