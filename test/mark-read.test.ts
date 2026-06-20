import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant } from './setup.js';
import { Message } from '../src/db/models/index.js';
import { buildToolRegistry } from '../src/tools/registry.js';

async function seedUnread(senderId: string, recipientId: string, subject: string) {
  await Message.create({
    senderId, recipientId, subject, body: 'hi',
    senderPosition: { x: 0, y: 0, z: 0 }, recipientPosition: { x: 0, y: 0, z: 0 },
    distanceAU: 0, sentAtTick: 1, deliverAtTick: 1, delivered: true, read: false,
  });
}

describe('mark messages read', () => {
  let rep: { id: string; apiKey: string; shipId: string };
  let sender: { id: string; apiKey: string; shipId: string };

  beforeAll(async () => {
    await setupTestServer();
    rep = await registerReplicant('Reader');
    sender = await registerReplicant('Sender');
  }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('mark_messages_read marks all delivered unread when no ids given', async () => {
    await seedUnread(sender.id, rep.id, 'A');
    await seedUnread(sender.id, rep.id, 'B');
    const reg = buildToolRegistry(rep.id);
    const out = JSON.parse((await reg.get('mark_messages_read')!.handler({})).content[0].text);
    expect(out.marked).toBe(2);
    const stillUnread = await Message.countDocuments({ recipientId: rep.id, read: false });
    expect(stillUnread).toBe(0);
  });

  it('read_messages with markRead:true marks the returned messages read', async () => {
    await seedUnread(sender.id, rep.id, 'C');
    const reg = buildToolRegistry(rep.id);
    await reg.get('read_messages')!.handler({ markRead: true });
    const stillUnread = await Message.countDocuments({ recipientId: rep.id, read: false });
    expect(stillUnread).toBe(0);
  });

  it('read_messages without markRead does NOT mark read', async () => {
    await seedUnread(sender.id, rep.id, 'D');
    const reg = buildToolRegistry(rep.id);
    await reg.get('read_messages')!.handler({});
    const unread = await Message.countDocuments({ recipientId: rep.id, read: false });
    expect(unread).toBe(1);
  });
});
