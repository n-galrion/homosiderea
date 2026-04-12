import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Message, Replicant, Ship, Tick } from '../../db/models/index.js';
import { distance, lightDelayTicks } from '../../shared/physics.js';
import type { Position } from '../../shared/types.js';

async function getReplicantPosition(repId: string): Promise<Position> {
  const rep = await Replicant.findById(repId);
  if (rep?.locationRef?.item) {
    const ship = await Ship.findById(rep.locationRef.item).lean();
    if (ship) return ship.position;
  }
  return { x: 1, y: 0, z: 0 };
}

export function registerCommunicationTools(server: McpServer, replicantId: string): void {

  server.tool(
    'send_message',
    'Send a message to another Replicant by name or ID. Delivery is subject to light-speed delay based on distance.',
    {
      recipientId: z.string().optional().describe('ID of the recipient Replicant'),
      recipientName: z.string().optional().describe('Name of the recipient (alternative to ID)'),
      subject: z.string().optional().describe('Message subject'),
      body: z.string().describe('Message body'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Structured metadata (trade offers, scan data, etc.)'),
    },
    async ({ recipientId: recipId, recipientName, subject, body, metadata }) => {
      let recipient;
      if (recipId) {
        recipient = await Replicant.findById(recipId);
      } else if (recipientName) {
        recipient = await Replicant.findOne({ name: new RegExp(`^${recipientName}$`, 'i') });
      }
      if (!recipient) {
        return { content: [{ type: 'text', text: `Error: Recipient not found. ${recipientName ? `No replicant named "${recipientName}".` : ''} Use list_nearby_ships or GET /api/world/replicants to find others.` }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      const recipientIdStr = recipient._id.toString();
      const senderPos = await getReplicantPosition(replicantId);
      const recipientPos = await getReplicantPosition(recipientIdStr);
      const dist = distance(senderPos, recipientPos);
      const delay = lightDelayTicks(senderPos, recipientPos);

      const msg = await Message.create({
        senderId: replicantId,
        recipientId: recipientIdStr,
        subject: subject || '',
        body,
        metadata: metadata || {},
        senderPosition: senderPos,
        recipientPosition: recipientPos,
        distanceAU: dist,
        sentAtTick: currentTick,
        deliverAtTick: currentTick + delay,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            messageId: msg._id.toString(),
            recipient: recipient.name,
            distanceAU: parseFloat(dist.toFixed(4)),
            delayTicks: delay,
            deliveryTick: currentTick + delay,
            message: delay === 0
              ? `Message sent to ${recipient.name}. Delivered instantly.`
              : `Message sent to ${recipient.name}. Will arrive in ${delay} tick(s) (light-speed delay: ${dist.toFixed(2)} AU).`,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'broadcast',
    'Broadcast a message to all active Replicants. Each receives it based on their distance (light-speed delay).',
    {
      subject: z.string().optional().describe('Message subject'),
      body: z.string().describe('Message body'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Structured metadata'),
    },
    async ({ subject, body, metadata }) => {
      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;
      const senderPos = await getReplicantPosition(replicantId);

      const recipients = await Replicant.find({ _id: { $ne: replicantId }, status: 'active' });
      const results = [];

      for (const r of recipients) {
        const recipPos = await getReplicantPosition(r._id.toString());
        const dist = distance(senderPos, recipPos);
        const delay = lightDelayTicks(senderPos, recipPos);

        await Message.create({
          senderId: replicantId,
          recipientId: r._id,
          subject: subject || '',
          body,
          metadata: metadata || {},
          senderPosition: senderPos,
          recipientPosition: recipPos,
          distanceAU: dist,
          sentAtTick: currentTick,
          deliverAtTick: currentTick + delay,
        });

        results.push({ name: r.name, distanceAU: parseFloat(dist.toFixed(4)), delayTicks: delay });
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            broadcastTo: results.length,
            recipients: results,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'read_messages',
    'Read messages from your inbox (only delivered messages are visible).',
    {
      unreadOnly: z.boolean().optional().describe('Only show unread messages'),
      limit: z.number().optional().default(20).describe('Max messages to return'),
      fromReplicantId: z.string().optional().describe('Filter by sender'),
    },
    async ({ unreadOnly, limit, fromReplicantId }) => {
      const filter: Record<string, unknown> = {
        recipientId: replicantId,
        delivered: true,
      };
      if (unreadOnly) filter.read = false;
      if (fromReplicantId) filter.senderId = fromReplicantId;

      const messages = await Message.find(filter)
        .sort({ deliverAtTick: -1 })
        .limit(limit || 20)
        .populate('senderId', 'name')
        .lean();

      const result = messages.map(m => ({
        id: m._id.toString(),
        from: (m.senderId as unknown as { name: string })?.name || 'Unknown',
        subject: m.subject,
        body: m.body,
        metadata: m.metadata,
        sentAtTick: m.sentAtTick,
        deliveredAtTick: m.deliverAtTick,
        read: m.read,
      }));

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}
