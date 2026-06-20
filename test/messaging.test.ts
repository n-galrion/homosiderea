import { describe, it, expect } from 'vitest';
import { senderLabel, MISSION_CONTROL_ID } from '../src/shared/messaging.js';

describe('senderLabel', () => {
  it('labels the Mission Control sentinel', () => {
    expect(senderLabel(MISSION_CONTROL_ID)).toBe('Mission Control');
  });
  it('labels NPC and pirate sentinels', () => {
    expect(senderLabel('000000000000000000000000')).toBe('NPC Traffic');
    expect(senderLabel('000000000000000000000001')).toBe('Pirate');
  });
  it('uses the resolved replicant name for a normal sender', () => {
    expect(senderLabel('64b9f0000000000000000abc', 'GUPPE')).toBe('GUPPE');
  });
  it('falls back to Unknown when no name resolves', () => {
    expect(senderLabel('64b9f0000000000000000abc')).toBe('Unknown');
    expect(senderLabel(null)).toBe('Unknown');
  });
});

import { beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant, api } from './setup.js';
import { Message, Tick } from '../src/db/models/index.js';
import { buildToolRegistry } from '../src/tools/registry.js';

describe('advisory sender attribution (DB)', () => {
  let rep: { id: string; apiKey: string; shipId: string };
  beforeAll(async () => { await setupTestServer(); rep = await registerReplicant('AdvisoryTester'); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('a Mission Control advisory does not appear to come from the replicant itself', async () => {
    const t = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    await Message.create({
      senderId: MISSION_CONTROL_ID, recipientId: rep.id,
      subject: 'Advisory', body: 'Consider mining Luna.',
      metadata: { type: 'system_suggestion', fromDashboard: true },
      senderPosition: { x: 0, y: 0, z: 0 }, recipientPosition: { x: 0, y: 0, z: 0 },
      distanceAU: 0, sentAtTick: (t as { tickNumber?: number } | null)?.tickNumber ?? 0,
      deliverAtTick: (t as { tickNumber?: number } | null)?.tickNumber ?? 0, delivered: true, read: false,
    });

    const registry = buildToolRegistry(rep.id);
    const out = await registry.get('read_messages')!.handler({});
    // read_messages returns a JSON array; withHud may append a HUD block as text
    const rawText = out.content[0].text;
    const jsonPart = rawText.includes('\n\n--- HUD ---\n') ? rawText.split('\n\n--- HUD ---\n')[0] : rawText;
    const msgs = JSON.parse(jsonPart);
    const advisory = msgs.find((m: { subject: string }) => m.subject === 'Advisory');
    expect(advisory.from).toBe('Mission Control');
    expect(advisory.from).not.toBe('AdvisoryTester');
  });
});
