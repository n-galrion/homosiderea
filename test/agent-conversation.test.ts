import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant } from './setup.js';
import { AgentConversation } from '../src/db/models/index.js';
import {
  toOpenAIMessages, renderInterrupt, estimateTokens, needsCompaction, applyCompaction,
  COMPACTION_THRESHOLD_TOKENS, KEEP_RECENT_MESSAGES,
} from '../src/worker/conversation.js';

describe('AgentConversation model', () => {
  let rep: { id: string; apiKey: string; shipId: string };
  beforeAll(async () => { await setupTestServer(); rep = await registerReplicant('ConvoTester'); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('round-trips messages with tool calls and results', async () => {
    const convo = await AgentConversation.create({
      replicantId: rep.id,
      messages: [
        { role: 'user', content: '— Tick 5 —', tick: 5, at: new Date() },
        { role: 'assistant', content: 'Scanning.', toolCalls: [{ id: 'c1', name: 'scan_location', args: '{}' }], tick: 5, at: new Date() },
        { role: 'tool', content: '{"nearby":[]}', toolCallId: 'c1', name: 'scan_location', tick: 5, at: new Date() },
      ],
      summary: null,
    });
    const found = await AgentConversation.findById(convo._id).lean();
    expect(found!.messages).toHaveLength(3);
    expect(found!.messages[1].toolCalls![0].name).toBe('scan_location');
    expect(found!.messages[2].toolCallId).toBe('c1');
  });
});

describe('conversation helpers', () => {
  it('maps stored messages to OpenAI shape', () => {
    const out = toOpenAIMessages([
      { role: 'user', content: 'hi', tick: 1, at: new Date() },
      { role: 'assistant', content: 'ok', toolCalls: [{ id: 'c1', name: 'scan', args: '{"a":1}' }], tick: 1, at: new Date() },
      { role: 'tool', content: 'done', toolCallId: 'c1', name: 'scan', tick: 1, at: new Date() },
    ]);
    expect(out[0]).toEqual({ role: 'user', content: 'hi' });
    expect((out[1] as any).tool_calls[0]).toEqual({ id: 'c1', type: 'function', function: { name: 'scan', arguments: '{"a":1}' } });
    expect(out[2]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'done' });
  });

  it('renders an interrupt from a HUD object', () => {
    const hud = { tick: 7, vitals: { credits: 500, fuelPct: 80, hullPct: 90, location: 'orbiting X', status: 'orbiting' }, unreadMessages: { count: 1, items: [{ from: 'Mission Control', subject: 'News', tick: 6 }] }, recentEvents: [], nearbyEntities: [], activeOps: {}, completedActions: [], warnings: [], guidance: ['You are idle — scan or move.'] };
    const text = renderInterrupt(hud as never, 7);
    expect(text).toContain('Tick 7');
    expect(text).toContain('500');
    expect(text).toMatch(/unread|Mission Control/i);
    expect(text).toContain('idle');
  });

  it('needsCompaction triggers over the token threshold', () => {
    const big = Array.from({ length: 200 }, (_, i) => ({ role: 'assistant' as const, content: 'x'.repeat(2000), tick: i, at: new Date() }));
    expect(needsCompaction(big, null)).toBe(true);
    expect(needsCompaction([{ role: 'user', content: 'hi', tick: 1, at: new Date() }], null)).toBe(false);
  });

  it('applyCompaction folds old turns into summary and keeps recent ones', async () => {
    const messages = Array.from({ length: KEEP_RECENT_MESSAGES + 10 }, (_, i) => ({ role: 'assistant' as const, content: `turn ${i}`, tick: i, at: new Date() }));
    const conv = { messages, summary: null as string | null, summarizedThroughTick: 0 };
    await applyCompaction(conv as never, async () => 'SUMMARY OF OLD TURNS');
    expect(conv.summary).toBe('SUMMARY OF OLD TURNS');
    expect(conv.messages.length).toBe(KEEP_RECENT_MESSAGES);
    expect(conv.messages[0].content).toBe(`turn 10`); // first 10 folded away
    expect(conv.summarizedThroughTick).toBe(messages[9].tick);
  });

  it('applyCompaction never starts recent on an orphaned tool result', async () => {
    // Build a thread of length KEEP_RECENT_MESSAGES + 4.
    // The raw cut = 4, which lands on index 4 — a tool result whose assistant is at index 3.
    // The fix must advance cut past that tool message so recent[0] is not a 'tool' role.
    const total = KEEP_RECENT_MESSAGES + 4;
    const messages = Array.from({ length: total }, (_, i) => ({
      role: 'assistant' as const,
      content: `plain turn ${i}`,
      tick: i,
      at: new Date(),
    }));
    // Index 3 (cut - 1): assistant with toolCalls
    messages[3] = {
      role: 'assistant',
      content: 'calling a tool',
      tick: 3,
      at: new Date(),
      toolCalls: [{ id: 'tc1', name: 'scan_location', args: '{}' }],
    } as typeof messages[0];
    // Index 4 (raw cut): tool result — this is the orphan candidate
    messages[4] = {
      role: 'tool' as const,
      content: '{"result":"ok"}',
      toolCallId: 'tc1',
      name: 'scan_location',
      tick: 4,
      at: new Date(),
    } as typeof messages[0];

    const conv = { messages: [...messages], summary: null as string | null, summarizedThroughTick: 0 };
    await applyCompaction(conv as never, async () => 'COMPACT_SUMMARY');

    // recent must not start with a tool message
    expect(conv.messages[0].role).not.toBe('tool');
    // all retained messages must fit within the keep budget
    expect(conv.messages.length).toBeLessThanOrEqual(KEEP_RECENT_MESSAGES);
    // summary was set
    expect(conv.summary).toBe('COMPACT_SUMMARY');
  });
});
