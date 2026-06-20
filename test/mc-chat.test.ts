import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer } from './setup.js';
import { MCConversation, Ship } from '../src/db/models/index.js';
import { proposeMCActions } from '../src/engine/systems/mc/propose.js';
import { config } from '../src/config.js';
import { getConversation, sendOperatorMessage, applyProposed, discardProposed } from '../src/services/mcChat.js';

describe('MCConversation model', () => {
  beforeAll(async () => { await setupTestServer(); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('persists messages with proposed actions', async () => {
    const convo = await MCConversation.create({
      messages: [{
        role: 'mc', content: 'Proposing a raid.', tick: 1,
        proposedActions: [{ tool: 'spawn_pirates', args: { count: 2, narrative: 'x' }, status: 'pending', result: null }],
      }],
    });
    const found = await MCConversation.findById(convo._id).lean();
    expect(found!.messages[0].proposedActions![0].tool).toBe('spawn_pirates');
    expect(found!.messages[0].proposedActions![0].status).toBe('pending');
  });
});

describe('proposeMCActions', () => {
  beforeAll(async () => { await setupTestServer(); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('returns an offline reply with no actions when no LLM key is set', async () => {
    const saved = config.llm.apiKey;
    config.llm.apiKey = '';
    try {
      const out = await proposeMCActions([{ role: 'operator', content: 'Cause chaos near Mars.' }]);
      expect(out.proposedActions).toEqual([]);
      expect(out.reply.toLowerCase()).toContain('offline');
    } finally {
      config.llm.apiKey = saved;
    }
  });
});

describe('mcChat service', () => {
  beforeAll(async () => { await setupTestServer(); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('sendOperatorMessage records operator + MC messages (offline)', async () => {
    const saved = config.llm.apiKey;
    config.llm.apiKey = '';
    try {
      const convo = await sendOperatorMessage('Stir up trouble.');
      const roles = convo.messages.map((m) => m.role);
      expect(roles).toContain('operator');
      expect(roles).toContain('mc');
    } finally { config.llm.apiKey = saved; }
  });

  it('applyProposed executes pending actions and marks them applied', async () => {
    // Craft an MC message with a pending spawn_pirates action (no LLM needed).
    const convo = await getConversation();
    convo.messages.push({
      role: 'mc', content: 'Raid incoming.', tick: 1, at: new Date(),
      proposedActions: [{ tool: 'spawn_pirates', args: { count: 1, nearBodyName: 'Mars', narrative: 'x' }, status: 'pending', result: null }],
    } as never);
    await convo.save();
    const msgId = (convo.messages[convo.messages.length - 1] as unknown as { _id: { toString(): string } })._id.toString();

    const before = await Ship.countDocuments({ ownerId: '000000000000000000000001' });
    const { results } = await applyProposed(msgId);
    expect(results.length).toBe(1);
    expect(await Ship.countDocuments({ ownerId: '000000000000000000000001' })).toBe(before + 1);

    const after = await MCConversation.findById(convo._id).lean();
    const msg = after!.messages.find((m) => (m as unknown as { _id: { toString(): string } })._id.toString() === msgId)!;
    expect(msg.proposedActions![0].status).toBe('applied');

    // Double-apply is a no-op.
    const second = await applyProposed(msgId);
    expect(second.results.length).toBe(0);
  });

  it('discardProposed marks pending actions discarded', async () => {
    const convo = await getConversation();
    convo.messages.push({
      role: 'mc', content: 'Maybe a flare.', tick: 2, at: new Date(),
      proposedActions: [{ tool: 'broadcast_event', args: { title: 't', description: 'd' }, status: 'pending', result: null }],
    } as never);
    await convo.save();
    const msgId = (convo.messages[convo.messages.length - 1] as unknown as { _id: { toString(): string } })._id.toString();
    await discardProposed(msgId);
    const after = await MCConversation.findById(convo._id).lean();
    const msg = after!.messages.find((m) => (m as unknown as { _id: { toString(): string } })._id.toString() === msgId)!;
    expect(msg.proposedActions![0].status).toBe('discarded');
  });
});
