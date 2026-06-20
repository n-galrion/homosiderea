import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant } from './setup.js';
import { Message, Replicant, Ship } from '../src/db/models/index.js';
import { buildHud, attachHud } from '../src/tools/hud.js';

describe('HUD', () => {
  let rep: { id: string; apiKey: string; shipId: string };

  beforeAll(async () => {
    await setupTestServer();
    rep = await registerReplicant('HudTester');
  }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('always returns a HUD with vitals and guidance for a valid replicant', async () => {
    const hud = await buildHud(rep.id);
    expect(hud).not.toBeNull();
    expect(hud!.vitals.credits).toBe(500);
    expect(Array.isArray(hud!.guidance)).toBe(true);
  });

  it('guidance tells the replicant to clear unread messages', async () => {
    const sender = await registerReplicant('GuidanceSender');
    await Message.create({
      senderId: sender.id, recipientId: rep.id, subject: 'Ping', body: 'yo',
      senderPosition: { x: 0, y: 0, z: 0 }, recipientPosition: { x: 0, y: 0, z: 0 },
      distanceAU: 0, sentAtTick: 1, deliverAtTick: 1, delivered: true, read: false,
    });
    const hud = await buildHud(rep.id);
    expect(hud!.guidance.some((g) => /mark_messages_read|unread/i.test(g))).toBe(true);
  });

  it('reports unread messages without marking them read', async () => {
    const sender = await registerReplicant('HudSender');
    await Message.create({
      senderId: sender.id, recipientId: rep.id,
      subject: 'Trade offer', body: 'Want ice?',
      senderPosition: { x: 0, y: 0, z: 0 }, recipientPosition: { x: 0, y: 0, z: 0 },
      distanceAU: 0, sentAtTick: 1, deliverAtTick: 1, delivered: true, read: false,
    });

    const hud = await buildHud(rep.id);
    expect(hud).not.toBeNull();
    expect(hud!.unreadMessages.count).toBeGreaterThanOrEqual(1);
    expect(hud!.unreadMessages.items.some((m) => m.subject === 'Trade offer')).toBe(true);

    // HUD must not mutate read state.
    const msg = await Message.findOne({ recipientId: rep.id });
    expect(msg!.read).toBe(false);
  });

  it('attaches _hud to a JSON result', async () => {
    const result = { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
    const out = await attachHud(result, rep.id);
    const parsed = JSON.parse(out.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed._hud).toBeTruthy();
    expect(parsed._hud.vitals.credits).toBe(500);
  });

  it('leaves a plain-text result intact but appends a HUD block', async () => {
    const result = { content: [{ type: 'text', text: 'Error: nope.' }] };
    const out = await attachHud(result, rep.id);
    expect(out.content[0].text).toContain('Error: nope.');
    expect(out.content[0].text).toContain('--- HUD ---');
  });

  it('REST tool responses include _hud', async () => {
    const { buildToolRegistry } = await import('../src/tools/registry.js');
    const registry = buildToolRegistry(rep.id);
    const getPosition = registry.get('get_position');
    expect(getPosition).toBeTruthy();
    const out = await getPosition!.handler({});
    const parsed = JSON.parse(out.content[0].text);
    expect(parsed._hud).toBeTruthy();
    expect(parsed._hud.unreadMessages.count).toBeGreaterThanOrEqual(1);
  });
});
