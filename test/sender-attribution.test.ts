/**
 * Playtest-feedback fix #3: sender attribution for MC broadcasts and settlement hails.
 *
 * Two scenarios:
 * 1. MC broadcast_event → from: 'Mission Control', NOT the replicant's own name.
 * 2. Settlement-sourced message (hail_settlement inbox copy) → from: settlement name, NOT 'Unknown'.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant } from './setup.js';
import { Message, Settlement, Tick } from '../src/db/models/index.js';
import { executeMCTool } from '../src/engine/systems/mc/tools.js';
import { buildToolRegistry } from '../src/tools/registry.js';

describe('sender attribution — MC broadcasts', () => {
  let rep: { id: string; apiKey: string; shipId: string };

  beforeAll(async () => {
    await setupTestServer();
    rep = await registerReplicant('SenderTestRep');
  }, 60000);

  afterAll(async () => {
    await teardownTestServer();
  });

  it('broadcast_event shows from: "Mission Control", not the replicant name', async () => {
    await executeMCTool(
      'broadcast_event',
      {
        title: 'Tiangong-3 Trade Summit',
        description: 'Shanghai and Tiangong-3 announce a joint trade agreement. Helium3 prices expected to shift.',
      },
      42,
    );

    const registry = buildToolRegistry(rep.id);
    const out = await registry.get('read_messages')!.handler({});
    const msgs = JSON.parse(out.content[0].text) as Array<{ from: string; subject: string }>;

    const broadcast = msgs.find((m) => m.subject === 'Tiangong-3 Trade Summit');
    expect(broadcast).toBeDefined();
    expect(broadcast!.from).toBe('Mission Control');
    expect(broadcast!.from).not.toBe('SenderTestRep');
  });

  it('send_rumor shows from: "Mission Control", not the replicant name', async () => {
    await executeMCTool(
      'send_rumor',
      { content: 'Intercepted: unidentified ships spotted near Jupiter L4.' },
      43,
    );

    const registry = buildToolRegistry(rep.id);
    const out = await registry.get('read_messages')!.handler({});
    const msgs = JSON.parse(out.content[0].text) as Array<{ from: string; subject: string; body: string }>;

    const rumor = msgs.find((m) => m.subject === 'Intercepted Transmission');
    expect(rumor).toBeDefined();
    expect(rumor!.from).toBe('Mission Control');
    expect(rumor!.from).not.toBe('SenderTestRep');
  });
});

describe('sender attribution — settlement-sourced messages', () => {
  let rep: { id: string; apiKey: string; shipId: string };

  beforeAll(async () => {
    await setupTestServer();
    rep = await registerReplicant('SettlementMsgRep');
  }, 60000);

  afterAll(async () => {
    await teardownTestServer();
  });

  it('message with senderId = settlement._id resolves from: settlement name', async () => {
    const settlement = await Settlement.findOne();
    expect(settlement).not.toBeNull();

    const t = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const tick = (t as { tickNumber?: number } | null)?.tickNumber ?? 0;

    await Message.create({
      senderId: settlement!._id,
      recipientId: rep.id,
      subject: `Comm: ${settlement!.name}`,
      body: `[${settlement!.name}]: Welcome, Replicant.`,
      metadata: { type: 'npc_conversation', settlementId: settlement!._id.toString() },
      senderPosition: { x: 0, y: 0, z: 0 },
      recipientPosition: { x: 0, y: 0, z: 0 },
      distanceAU: 0,
      sentAtTick: tick,
      deliverAtTick: tick,
      delivered: true,
      read: false,
    });

    const registry = buildToolRegistry(rep.id);
    const out = await registry.get('read_messages')!.handler({});
    const msgs = JSON.parse(out.content[0].text) as Array<{ from: string; subject: string }>;

    const hailMsg = msgs.find((m) => m.subject === `Comm: ${settlement!.name}`);
    expect(hailMsg).toBeDefined();
    expect(hailMsg!.from).toBe(settlement!.name);
    expect(hailMsg!.from).not.toBe('Unknown');
    expect(hailMsg!.from).not.toBe('SettlementMsgRep');
  });
});
