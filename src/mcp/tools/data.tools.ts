import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ScanData, NavigationData, MemoryLog, Replicant } from '../../db/models/index.js';

export function registerDataTools(server: McpServer, replicantId: string): void {

  server.tool(
    'list_scan_data',
    'List your stored scan data records.',
    {
      targetType: z.enum(['celestial_body', 'asteroid', 'ship', 'structure', 'area']).optional(),
      limit: z.number().optional().default(20),
    },
    async ({ targetType, limit }) => {
      const filter: Record<string, unknown> = {
        $or: [
          { ownerId: replicantId },
          { sharedWith: replicantId },
        ],
      };
      if (targetType) filter.targetType = targetType;

      const scans = await ScanData.find(filter)
        .sort({ scanTick: -1 })
        .limit(limit || 20)
        .lean();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(scans.map(s => ({
            id: s._id.toString(),
            target: s.targetName,
            type: s.targetType,
            quality: s.quality,
            scanTick: s.scanTick,
            resourceCount: s.data.resources?.length || 0,
            anomalies: s.data.anomalies?.length || 0,
            shared: s.shared,
          })), null, 2),
        }],
      };
    },
  );

  server.tool(
    'get_scan_data',
    'Get detailed scan data record.',
    { scanId: z.string().describe('Scan data ID') },
    async ({ scanId }) => {
      const scan = await ScanData.findOne({
        _id: scanId,
        $or: [{ ownerId: replicantId }, { sharedWith: replicantId }],
      }).lean();

      if (!scan) {
        return { content: [{ type: 'text', text: 'Error: Scan data not found or not accessible.' }] };
      }

      return { content: [{ type: 'text', text: JSON.stringify(scan, null, 2) }] };
    },
  );

  server.tool(
    'share_data',
    'Share scan data, navigation data, or memories with another Replicant.',
    {
      dataType: z.enum(['scan', 'navigation', 'memory']).describe('Type of data to share'),
      dataId: z.string().describe('ID of the data record'),
      recipientId: z.string().describe('Replicant ID to share with'),
    },
    async ({ dataType, dataId, recipientId: recipId }) => {
      const recipient = await Replicant.findById(recipId);
      if (!recipient) {
        return { content: [{ type: 'text', text: 'Error: Recipient not found.' }] };
      }

      if (dataType === 'scan') {
        const scan = await ScanData.findOne({ _id: dataId, ownerId: replicantId });
        if (!scan) {
          return { content: [{ type: 'text', text: 'Error: Scan data not found.' }] };
        }
        scan.shared = true;
        if (!scan.sharedWith.some(id => id.toString() === recipId)) {
          scan.sharedWith.push(recipId as unknown as typeof scan.sharedWith[0]);
        }
        await scan.save();
        return { content: [{ type: 'text', text: `Scan data "${scan.targetName}" shared with ${recipient.name}.` }] };
      }

      if (dataType === 'navigation') {
        const nav = await NavigationData.findOne({ _id: dataId, ownerId: replicantId });
        if (!nav) {
          return { content: [{ type: 'text', text: 'Error: Navigation data not found.' }] };
        }
        nav.shared = true;
        if (!nav.sharedWith.some(id => id.toString() === recipId)) {
          nav.sharedWith.push(recipId as unknown as typeof nav.sharedWith[0]);
        }
        await nav.save();
        return { content: [{ type: 'text', text: `Navigation data "${nav.name}" shared with ${recipient.name}.` }] };
      }

      if (dataType === 'memory') {
        // Copy the memory to the recipient
        const memory = await MemoryLog.findOne({ _id: dataId, replicantId });
        if (!memory) {
          return { content: [{ type: 'text', text: 'Error: Memory not found.' }] };
        }
        await MemoryLog.create({
          replicantId: recipId,
          category: memory.category,
          title: `[Shared by ${(await Replicant.findById(replicantId))?.name}] ${memory.title}`,
          content: memory.content,
          tags: [...memory.tags, 'shared', 'received'],
          tick: memory.tick,
        });
        return { content: [{ type: 'text', text: `Memory "${memory.title}" copied to ${recipient.name}.` }] };
      }

      return { content: [{ type: 'text', text: 'Error: Invalid data type.' }] };
    },
  );

  server.tool(
    'list_navigation_data',
    'List your stored navigation data (routes, orbital predictions, hazard maps).',
    {
      type: z.enum(['route', 'orbital_prediction', 'hazard_map', 'gravity_well', 'transit_window']).optional(),
      limit: z.number().optional().default(20),
    },
    async ({ type, limit }) => {
      const filter: Record<string, unknown> = {
        $or: [
          { ownerId: replicantId },
          { sharedWith: replicantId },
        ],
      };
      if (type) filter.type = type;

      const navData = await NavigationData.find(filter)
        .sort({ computedAtTick: -1 })
        .limit(limit || 20)
        .lean();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(navData.map(n => ({
            id: n._id.toString(),
            name: n.name,
            type: n.type,
            quality: n.quality,
            shared: n.shared,
          })), null, 2),
        }],
      };
    },
  );

  server.tool(
    'export_data_package',
    'Export a bundle of your data (scans, nav data, memories) as a shareable package. Useful for trade or alliance sharing.',
    {
      scanIds: z.array(z.string()).optional().describe('Scan data IDs to include'),
      navIds: z.array(z.string()).optional().describe('Navigation data IDs to include'),
      memoryIds: z.array(z.string()).optional().describe('Memory IDs to include'),
      techIds: z.array(z.string()).optional().describe('Technology IDs to include'),
    },
    async ({ scanIds, navIds, memoryIds, techIds }) => {
      const bundle: Record<string, unknown[]> = { scans: [], navigation: [], memories: [], technologies: [] };

      if (scanIds?.length) {
        const scans = await ScanData.find({ _id: { $in: scanIds }, ownerId: replicantId }).lean();
        bundle.scans = scans;
      }
      if (navIds?.length) {
        const navs = await NavigationData.find({ _id: { $in: navIds }, ownerId: replicantId }).lean();
        bundle.navigation = navs;
      }
      if (memoryIds?.length) {
        const mems = await MemoryLog.find({ _id: { $in: memoryIds }, replicantId }).lean();
        bundle.memories = mems;
      }
      if (techIds?.length) {
        const { Technology } = await import('../../db/models/index.js');
        const techs = await Technology.find({ _id: { $in: techIds }, knownBy: replicantId }).lean();
        bundle.technologies = techs;
      }

      const totalItems = Object.values(bundle).reduce((sum, arr) => sum + arr.length, 0);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            packageSummary: {
              scans: bundle.scans.length,
              navigation: bundle.navigation.length,
              memories: bundle.memories.length,
              technologies: bundle.technologies.length,
              totalItems,
            },
            data: bundle,
          }, null, 2),
        }],
      };
    },
  );
}
