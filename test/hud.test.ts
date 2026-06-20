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

  it('returns null when nothing is notable', async () => {
    const hud = await buildHud(rep.id);
    expect(hud).toBeNull();
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
    expect(hud!.unreadMessages.count).toBe(1);
    expect(hud!.unreadMessages.items[0].subject).toBe('Trade offer');

    // HUD must not mutate read state.
    const msg = await Message.findOne({ recipientId: rep.id });
    expect(msg!.read).toBe(false);
  });

  it('attaches _hud to a JSON result when notable', async () => {
    const result = { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
    const out = await attachHud(result, rep.id);
    const parsed = JSON.parse(out.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed._hud).toBeTruthy();
    expect(parsed._hud.vitals.credits).toBe(500);
  });

  it('leaves a plain-text result intact but appends a HUD block when notable', async () => {
    const result = { content: [{ type: 'text', text: 'Error: nope.' }] };
    const out = await attachHud(result, rep.id);
    expect(out.content[0].text).toContain('Error: nope.');
    expect(out.content[0].text).toContain('--- HUD ---');
  });
});
