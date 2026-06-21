import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant } from './setup.js';
import { AgentConversation } from '../src/db/models/index.js';

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
