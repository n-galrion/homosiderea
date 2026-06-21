import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant } from './setup.js';
import { AgentConversation, AgentSession, Replicant, AgentConfig } from '../src/db/models/index.js';
import { AgentRunner } from '../src/worker/AgentRunner.js';
import { DirectGameClient } from '../src/worker/DirectGameClient.js';

// A fake LLM: first call requests a tool, second call returns a final message.
function fakeLLM() {
  let n = 0;
  return {
    async chat() {
      n += 1;
      if (n === 1) {
        return { choices: [{ message: { role: 'assistant', content: 'Checking position.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_position', arguments: '{}' } }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } as never;
      }
      return { choices: [{ message: { role: 'assistant', content: 'Holding position this cycle.' } }], usage: { prompt_tokens: 8, completion_tokens: 4 } } as never;
    },
    async summarize(_text: string) {
      return 'summary';
    },
  };
}

describe('AgentRunner resume model', () => {
  let rep: { id: string; apiKey: string; shipId: string };
  beforeAll(async () => {
    await setupTestServer();
    rep = await registerReplicant('ResumeTester');
    await AgentConfig.create({ userId: rep.id, replicantId: rep.id, enabled: true, provider: { baseUrl: 'x', apiKey: 'x', model: 'm' } });
    await AgentSession.create({ replicantId: rep.id, status: 'running' });
  }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('persists the thread, executes the tool, and stops when no tool calls', async () => {
    const replicant = await Replicant.findById(rep.id);
    const cfg = await AgentConfig.findOne({ replicantId: rep.id });
    const runner = new AgentRunner(cfg as never, replicant as never, 10, new DirectGameClient(rep.id), fakeLLM() as never);
    await runner.run();

    const convo = await AgentConversation.findOne({ replicantId: rep.id });
    expect(convo).toBeTruthy();
    const roles = convo!.messages.map((m) => m.role);
    expect(roles).toContain('user');      // the interrupt
    expect(roles).toContain('assistant'); // reasoning + tool call
    expect(roles).toContain('tool');      // get_position result
    // a second resume continues the SAME thread, not a fresh one
    const before = convo!.messages.length;
    const runner2 = new AgentRunner(cfg as never, replicant as never, 15, new DirectGameClient(rep.id), fakeLLM() as never);
    await runner2.run();
    const convo2 = await AgentConversation.findOne({ replicantId: rep.id });
    expect(convo2!.messages.length).toBeGreaterThan(before);
  });
});
