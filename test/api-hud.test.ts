import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant, api } from './setup.js';
import { Message } from '../src/db/models/index.js';

// Verifies the HUD/guidance/hints flow over the REST tool API (POST /api/tools/:toolName),
// not just the in-process registry — i.e. they work on API requests too.
describe('HUD over REST tool API', () => {
  let rep: { id: string; apiKey: string; shipId: string };
  let sender: { id: string; apiKey: string; shipId: string };

  beforeAll(async () => {
    await setupTestServer();
    rep = await registerReplicant('ApiHudTester');
    sender = await registerReplicant('ApiHudSender');
  }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('an object-returning tool returns a clean result plus a structured hud', async () => {
    const { status, data } = await api('/api/tools/get_position', { method: 'POST', apiKey: rep.apiKey, body: {} });
    expect(status).toBe(200);
    const d = data as { result: Record<string, unknown>; hud?: Record<string, unknown> };
    // result is the untouched tool payload — no HUD mixed in.
    expect(d.result.shipName).toBeDefined();
    expect((d.result as Record<string, unknown>)._hud).toBeUndefined();
    expect(d.result.hint).toContain('move_ship'); // per-tool hint survives over REST
    // hud is a sibling field, cleanly serialized.
    expect(d.hud).toBeTruthy();
    expect(Array.isArray(d.hud!.guidance)).toBe(true);
  });

  it('an array-returning tool (read_messages) stays a clean array, hud alongside', async () => {
    await Message.create({
      senderId: sender.id, recipientId: rep.id, subject: 'Hi', body: 'yo',
      senderPosition: { x: 0, y: 0, z: 0 }, recipientPosition: { x: 0, y: 0, z: 0 },
      distanceAU: 0, sentAtTick: 1, deliverAtTick: 1, delivered: true, read: false,
    });
    const { status, data } = await api('/api/tools/read_messages', { method: 'POST', apiKey: rep.apiKey, body: {} });
    expect(status).toBe(200);
    const d = data as { result: unknown; hud?: { guidance: string[] } };
    expect(Array.isArray(d.result)).toBe(true); // not corrupted into a string
    expect(d.hud!.guidance.some((g) => /mark_messages_read|unread/i.test(g))).toBe(true);
  });

  it('mark_messages_read works over REST and clears the unread guidance', async () => {
    const marked = await api('/api/tools/mark_messages_read', { method: 'POST', apiKey: rep.apiKey, body: {} });
    expect(marked.status).toBe(200);
    expect((marked.data as { result: { marked: number } }).result.marked).toBeGreaterThanOrEqual(1);
    const unread = await Message.countDocuments({ recipientId: rep.id, read: false });
    expect(unread).toBe(0);
  });
});
