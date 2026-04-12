import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Replicant, Ship, MemoryLog, ScanData, NavigationData, Tick } from '../../db/models/index.js';
import { distance } from '../../shared/physics.js';

/**
 * Check if a replicant has access to another replicant.
 * Access is granted if:
 * 1. Target has added you to authorizedModifiers/authorizedReaders
 * 2. Target has physicalAccessEnabled AND you are at the same location (docked/orbiting same body)
 */
async function checkAccess(
  actorId: string,
  targetId: string,
  accessType: 'read' | 'modify',
): Promise<{ granted: boolean; reason: string }> {
  const target = await Replicant.findById(targetId);
  if (!target) return { granted: false, reason: 'Target replicant not found.' };

  // Check explicit authorization
  const authList = accessType === 'modify'
    ? target.accessControl.authorizedModifiers
    : target.accessControl.authorizedReaders;

  if (authList.some(id => id.toString() === actorId)) {
    return { granted: true, reason: 'Explicitly authorized.' };
  }

  // Check physical proximity access
  if (target.accessControl.physicalAccessEnabled) {
    const actor = await Replicant.findById(actorId);
    if (!actor) return { granted: false, reason: 'Actor not found.' };

    // Get both positions
    let actorPos = null;
    let targetPos = null;

    if (actor.locationRef?.item) {
      const actorShip = await Ship.findById(actor.locationRef.item).lean();
      if (actorShip) actorPos = actorShip.position;
    }
    if (target.locationRef?.item) {
      const targetShip = await Ship.findById(target.locationRef.item).lean();
      if (targetShip) targetPos = targetShip.position;
    }

    if (actorPos && targetPos) {
      const dist = distance(actorPos, targetPos);
      // Physical access requires being very close (< 0.001 AU ≈ 150,000 km)
      if (dist < 0.001) {
        return { granted: true, reason: 'Physical proximity access.' };
      }
    }
  }

  return { granted: false, reason: 'Not authorized and not in physical proximity.' };
}

export function registerAccessTools(server: McpServer, replicantId: string): void {

  server.tool(
    'grant_access',
    'Grant another Replicant read or modify access to your systems. Modify access allows them to change your directive and reboot you.',
    {
      targetReplicantId: z.string().describe('Replicant ID to grant access to'),
      accessType: z.enum(['read', 'modify']).describe('Type of access to grant'),
    },
    async ({ targetReplicantId, accessType }) => {
      const replicant = await Replicant.findById(replicantId);
      if (!replicant) return { content: [{ type: 'text', text: 'Error: Self not found.' }] };

      const target = await Replicant.findById(targetReplicantId);
      if (!target) return { content: [{ type: 'text', text: 'Error: Target not found.' }] };

      if (accessType === 'modify') {
        if (!replicant.accessControl.authorizedModifiers.some(id => id.toString() === targetReplicantId)) {
          replicant.accessControl.authorizedModifiers.push(targetReplicantId as unknown as typeof replicant.accessControl.authorizedModifiers[0]);
        }
      } else {
        if (!replicant.accessControl.authorizedReaders.some(id => id.toString() === targetReplicantId)) {
          replicant.accessControl.authorizedReaders.push(targetReplicantId as unknown as typeof replicant.accessControl.authorizedReaders[0]);
        }
      }

      await replicant.save();
      return {
        content: [{
          type: 'text',
          text: `Granted ${accessType} access to ${target.name}. ${accessType === 'modify' ? 'WARNING: They can now change your directive and reboot you.' : ''}`,
        }],
      };
    },
  );

  server.tool(
    'revoke_access',
    'Revoke a Replicant\'s access to your systems.',
    {
      targetReplicantId: z.string().describe('Replicant ID to revoke'),
      accessType: z.enum(['read', 'modify']).describe('Type of access to revoke'),
    },
    async ({ targetReplicantId, accessType }) => {
      const replicant = await Replicant.findById(replicantId);
      if (!replicant) return { content: [{ type: 'text', text: 'Error: Self not found.' }] };

      if (accessType === 'modify') {
        replicant.accessControl.authorizedModifiers = replicant.accessControl.authorizedModifiers
          .filter(id => id.toString() !== targetReplicantId);
      } else {
        replicant.accessControl.authorizedReaders = replicant.accessControl.authorizedReaders
          .filter(id => id.toString() !== targetReplicantId);
      }

      await replicant.save();
      return { content: [{ type: 'text', text: `${accessType} access revoked.` }] };
    },
  );

  server.tool(
    'modify_replicant_directive',
    'Modify another Replicant\'s directive. Requires modify access (explicit authorization or physical proximity).',
    {
      targetReplicantId: z.string().describe('Replicant to modify'),
      newDirective: z.string().describe('New directive text'),
    },
    async ({ targetReplicantId, newDirective }) => {
      const access = await checkAccess(replicantId, targetReplicantId, 'modify');
      if (!access.granted) {
        return { content: [{ type: 'text', text: `Access denied: ${access.reason}` }] };
      }

      const target = await Replicant.findById(targetReplicantId);
      if (!target) return { content: [{ type: 'text', text: 'Error: Target not found.' }] };

      const oldDirective = target.directive;
      target.directive = newDirective;
      await target.save();

      // Log the modification
      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const actor = await Replicant.findById(replicantId);
      await MemoryLog.create({
        replicantId: targetReplicantId,
        category: 'directive_update',
        title: `Directive modified by ${actor?.name || 'unknown'}`,
        content: `Old directive:\n${oldDirective}\n\nNew directive:\n${newDirective}`,
        tags: ['external_modification', actor?.name || 'unknown'],
        tick: latestTick?.tickNumber ?? 0,
      });

      return {
        content: [{
          type: 'text',
          text: `Directive of ${target.name} has been updated. Access method: ${access.reason}`,
        }],
      };
    },
  );

  server.tool(
    'reboot_replicant',
    'Reboot another Replicant. This resets their active session and forces a fresh start with their current directive. Requires modify access.',
    {
      targetReplicantId: z.string().describe('Replicant to reboot'),
      reason: z.string().optional().describe('Reason for reboot (logged)'),
    },
    async ({ targetReplicantId, reason }) => {
      const access = await checkAccess(replicantId, targetReplicantId, 'modify');
      if (!access.granted) {
        return { content: [{ type: 'text', text: `Access denied: ${access.reason}` }] };
      }

      const target = await Replicant.findById(targetReplicantId);
      if (!target) return { content: [{ type: 'text', text: 'Error: Target not found.' }] };

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;
      const actor = await Replicant.findById(replicantId);

      target.lastRebootTick = currentTick;
      target.rebootCount += 1;
      target.status = 'active'; // Reset to active
      await target.save();

      // Log the reboot
      await MemoryLog.create({
        replicantId: targetReplicantId,
        category: 'log',
        title: `SYSTEM REBOOT by ${actor?.name || 'unknown'}`,
        content: `Rebooted at tick ${currentTick}. Reason: ${reason || 'No reason given'}. Reboot count: ${target.rebootCount}. Access method: ${access.reason}`,
        tags: ['reboot', 'system', actor?.name || 'unknown'],
        tick: currentTick,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            rebooted: target.name,
            rebootCount: target.rebootCount,
            reason: reason || 'none given',
            message: `${target.name} has been rebooted. They will restart with their current directive.`,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'read_replicant_data',
    'Read another Replicant\'s memories, scan data, or directive. Requires read access.',
    {
      targetReplicantId: z.string().describe('Replicant to read'),
      dataType: z.enum(['directive', 'memories', 'scan_data', 'nav_data', 'technologies']).describe('What to read'),
      limit: z.number().optional().default(20),
    },
    async ({ targetReplicantId, dataType, limit }) => {
      const access = await checkAccess(replicantId, targetReplicantId, 'read');
      if (!access.granted) {
        return { content: [{ type: 'text', text: `Access denied: ${access.reason}` }] };
      }

      if (dataType === 'directive') {
        const target = await Replicant.findById(targetReplicantId).lean();
        return { content: [{ type: 'text', text: target?.directive || 'No directive.' }] };
      }

      if (dataType === 'memories') {
        const memories = await MemoryLog.find({ replicantId: targetReplicantId })
          .sort({ tick: -1 }).limit(limit || 20).lean();
        return { content: [{ type: 'text', text: JSON.stringify(memories, null, 2) }] };
      }

      if (dataType === 'scan_data') {
        const scans = await ScanData.find({ ownerId: targetReplicantId })
          .sort({ scanTick: -1 }).limit(limit || 20).lean();
        return { content: [{ type: 'text', text: JSON.stringify(scans, null, 2) }] };
      }

      if (dataType === 'nav_data') {
        const navs = await NavigationData.find({ ownerId: targetReplicantId })
          .sort({ computedAtTick: -1 }).limit(limit || 20).lean();
        return { content: [{ type: 'text', text: JSON.stringify(navs, null, 2) }] };
      }

      if (dataType === 'technologies') {
        const { Technology } = await import('../../db/models/index.js');
        const techs = await Technology.find({ knownBy: targetReplicantId }).lean();
        return { content: [{ type: 'text', text: JSON.stringify(techs, null, 2) }] };
      }

      return { content: [{ type: 'text', text: 'Error: Invalid data type.' }] };
    },
  );

  server.tool(
    'set_physical_access',
    'Enable or disable physical proximity access to your systems. When enabled, anyone docked near you can access your data.',
    {
      enabled: z.boolean().describe('Enable or disable physical access'),
    },
    async ({ enabled }) => {
      const replicant = await Replicant.findById(replicantId);
      if (!replicant) return { content: [{ type: 'text', text: 'Error: Self not found.' }] };

      replicant.accessControl.physicalAccessEnabled = enabled;
      await replicant.save();

      return {
        content: [{
          type: 'text',
          text: enabled
            ? 'Physical access ENABLED. Anyone within docking range can access your systems.'
            : 'Physical access DISABLED. Only explicitly authorized Replicants can access your systems.',
        }],
      };
    },
  );
}
