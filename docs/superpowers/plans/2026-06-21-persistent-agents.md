# Persistent, Interrupt-Driven Agents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn managed agents from stateless per-tick cycles into persistent threads that are interrupted/resumed by tick events, with context compaction and a conversation timeline view — plus a chat-styling quick win for the MC/comms pages.

**Architecture:** Keep BullMQ + `tick:complete` as the event source. Add an `AgentConversation` thread per agent; `AgentRunner` resumes it (append an interrupt built from the HUD delta, continue the tool loop with no token cutoff), persists new turns, and compacts old turns into a rolling summary. The agent page renders the thread as a timeline. Chat CSS is independent.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Mongoose, OpenAI SDK, BullMQ/ioredis, Express, EJS, vitest + mongodb-memory-server.

## Global Constraints

- **ESM only** — local imports use `.js` extensions.
- Work on `main` (no feature branch). Commit only the files each task names; never `git add -A`. Never rewrite git history.
- Type-check: `npx tsc --noEmit` — a pre-existing `src/worker/WorkerLoop.ts` ioredis error is unrelated; ignore it. (The worker is built with `npx tsc` in Docker, so worker files MUST type-check otherwise.)
- Tests: `npx vitest run test/<file>.test.ts`; full suite needs `ADMIN_KEY=dev-admin-key`. Tests must be deterministic and never call a real LLM — inject fakes.
- The LLM message replay shape is OpenAI `ChatCompletionMessageParam`.
- Constants: `COMPACTION_THRESHOLD_TOKENS = 40000`, `KEEP_RECENT_MESSAGES = 20`, default `maxRoundsPerCycle = 20`.

---

### Task 1: Chat styling for MC + comms (independent quick win)

**Files:**
- Modify: `src/web/public/css/style.css` (append a chat section)
- Modify: `src/web/views/admin/mc.ejs` (auto-scroll script)
- Test: manual/smoke (CSS has no unit test; verify pages render)

**Interfaces:** none (pure styling).

- [ ] **Step 1: Append chat CSS**

At the end of `src/web/public/css/style.css`, append (use the file's existing color variables; these reference common ones — if a variable name differs in this file, swap to the actual token):

```css
/* ── Chat / conversation (MC console + replicant comms) ── */
.mc-transcript { display: flex; flex-direction: column; gap: 10px; max-height: 60vh; overflow-y: auto; padding: 8px; border: 1px solid var(--border, #333); border-radius: 6px; background: var(--bg-elev, #111); }
.msg { max-width: 78%; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--border, #333); }
.msg-in { align-self: flex-start; background: var(--bg-elev2, #1a1a1a); }
.msg-out { align-self: flex-end; background: rgba(255,176,0,0.10); border-color: var(--accent, #ffb000); }
.msg-system { align-self: center; max-width: 92%; background: transparent; border-style: dashed; color: var(--text-dim, #999); font-size: 12px; }
.msg-meta { display: flex; justify-content: space-between; gap: 16px; font-size: 11px; color: var(--text-dim, #999); margin-bottom: 4px; }
.msg-body { white-space: pre-wrap; word-break: break-word; font-size: 14px; line-height: 1.4; }
.mc-actions { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.mc-action { font-size: 12px; padding: 6px 8px; border-radius: 6px; border-left: 3px solid var(--border, #555); background: rgba(255,255,255,0.03); }
.mc-action code { color: var(--accent, #ffb000); }
.mc-action-pending { border-left-color: var(--accent, #ffb000); }
.mc-action-applied { border-left-color: var(--success, #3fb950); }
.mc-action-discarded { border-left-color: var(--text-dim, #777); opacity: 0.6; }
.mc-action-status { font-weight: 600; text-transform: uppercase; font-size: 10px; }
.mc-input { display: flex; flex-direction: column; gap: 8px; }
/* timeline (agent observability) reuses .msg/.msg-in/.msg-out; tool calls/results: */
.trace-tool { font-family: var(--font-mono, monospace); font-size: 12px; background: rgba(255,255,255,0.03); border-left: 3px solid var(--accent, #ffb000); padding: 6px 8px; border-radius: 4px; margin-top: 6px; }
.trace-result { font-family: var(--font-mono, monospace); font-size: 12px; color: var(--text-dim, #aaa); white-space: pre-wrap; word-break: break-word; margin-top: 4px; max-height: 220px; overflow-y: auto; }
.trace-tick { font-size: 11px; color: var(--text-dim, #999); text-align: center; margin: 10px 0 2px; border-top: 1px solid var(--border, #333); padding-top: 6px; }
```

- [ ] **Step 2: Auto-scroll the MC transcript to the latest message**

In `src/web/views/admin/mc.ejs`, just before the closing `</body>`, add:

```html
<script>
  (function () {
    var t = document.querySelector('.mc-transcript');
    if (t) t.scrollTop = t.scrollHeight;
  })();
</script>
```

- [ ] **Step 3: Verify pages render**

Run: `ADMIN_KEY=dev-admin-key npx vitest run test/mc-api.test.ts` (the `/admin/mc` GET smoke test must still pass — confirms the EJS renders with the new markup/script). Type-check is N/A for CSS.

- [ ] **Step 4: Commit**

```bash
git add src/web/public/css/style.css src/web/views/admin/mc.ejs
git commit -m "feat: style MC + comms pages as real conversations"
```

---

### Task 2: `AgentConversation` model

**Files:**
- Create: `src/db/models/AgentConversation.ts`
- Modify: `src/db/models/index.ts` (export)
- Test: `test/agent-conversation.test.ts`

**Interfaces:**
- Produces: `IStoredMessage`, `IAgentConversation`, model `AgentConversation`.
- `IStoredMessage = { role: 'system'|'user'|'assistant'|'tool'; content: string | null; toolCalls?: { id: string; name: string; args: string }[]; toolCallId?: string; name?: string; tick: number; at: Date }`

- [ ] **Step 1: Write the failing test**

Create `test/agent-conversation.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agent-conversation.test.ts`
Expected: FAIL — `AgentConversation` not exported.

- [ ] **Step 3: Create the model**

Create `src/db/models/AgentConversation.ts`:

```typescript
import { Schema, model, type Document, type Types } from 'mongoose';

export interface IStoredToolCall { id: string; name: string; args: string }

export interface IStoredMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  toolCalls?: IStoredToolCall[];
  toolCallId?: string;
  name?: string;
  tick: number;
  at: Date;
}

export interface IAgentConversation extends Document {
  _id: Types.ObjectId;
  replicantId: Types.ObjectId;
  messages: IStoredMessage[];
  summary: string | null;
  summarizedThroughTick: number;
  lastResumeTick: number;
  createdAt: Date;
  updatedAt: Date;
}

const StoredToolCallSchema = new Schema<IStoredToolCall>({
  id: { type: String, required: true },
  name: { type: String, required: true },
  args: { type: String, default: '{}' },
}, { _id: false });

const StoredMessageSchema = new Schema<IStoredMessage>({
  role: { type: String, enum: ['system', 'user', 'assistant', 'tool'], required: true },
  content: { type: String, default: null },
  toolCalls: { type: [StoredToolCallSchema], default: undefined },
  toolCallId: { type: String, default: undefined },
  name: { type: String, default: undefined },
  tick: { type: Number, default: 0 },
  at: { type: Date, default: Date.now },
}, { _id: false });

const AgentConversationSchema = new Schema<IAgentConversation>({
  replicantId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true, unique: true, index: true },
  messages: { type: [StoredMessageSchema], default: [] },
  summary: { type: String, default: null },
  summarizedThroughTick: { type: Number, default: 0 },
  lastResumeTick: { type: Number, default: 0 },
}, { timestamps: true });

export const AgentConversation = model<IAgentConversation>('AgentConversation', AgentConversationSchema);
```

- [ ] **Step 4: Export from the index**

In `src/db/models/index.ts`, add (match the file's existing export style):

```typescript
export { AgentConversation } from './AgentConversation.js';
export type { IAgentConversation, IStoredMessage, IStoredToolCall } from './AgentConversation.js';
```

- [ ] **Step 5: Run test + type-check**

Run: `npx vitest run test/agent-conversation.test.ts` → PASS. `npx tsc --noEmit` → no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/db/models/AgentConversation.ts src/db/models/index.ts test/agent-conversation.test.ts
git commit -m "feat: add AgentConversation model for persistent agent threads"
```

---

### Task 3: `conversation.ts` helpers (testable core)

**Files:**
- Create: `src/worker/conversation.ts`
- Test: `test/agent-conversation.test.ts` (extend)

**Interfaces:**
- Consumes: `IStoredMessage` (Task 2), `Hud` type (`src/tools/hud.js`).
- Produces:
  - `toOpenAIMessages(stored: IStoredMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[]`
  - `assistantToStored(msg, tick): IStoredMessage`
  - `toolResultToStored(toolCallId, name, content, tick): IStoredMessage`
  - `renderInterrupt(hud, tick): string`
  - `estimateTokens(stored, summary): number`
  - `COMPACTION_THRESHOLD_TOKENS`, `KEEP_RECENT_MESSAGES`
  - `needsCompaction(stored, summary): boolean`
  - `applyCompaction(conv, summarize): Promise<void>` (summarize: `(text: string) => Promise<string>`)

- [ ] **Step 1: Write the failing tests**

Append to `test/agent-conversation.test.ts`:

```typescript
import {
  toOpenAIMessages, renderInterrupt, estimateTokens, needsCompaction, applyCompaction,
  COMPACTION_THRESHOLD_TOKENS, KEEP_RECENT_MESSAGES,
} from '../src/worker/conversation.js';

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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agent-conversation.test.ts`
Expected: FAIL — `src/worker/conversation.js` does not exist.

- [ ] **Step 3: Implement `src/worker/conversation.ts`**

```typescript
import type OpenAI from 'openai';
import type { IStoredMessage } from '../db/models/AgentConversation.js';
import type { Hud } from '../tools/hud.js';

export const COMPACTION_THRESHOLD_TOKENS = 40000;
export const KEEP_RECENT_MESSAGES = 20;

/** Map persisted messages back to the OpenAI chat shape for replay. */
export function toOpenAIMessages(stored: IStoredMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return stored.map((m) => {
    if (m.role === 'assistant') {
      const msg: Record<string, unknown> = { role: 'assistant', content: m.content ?? '' };
      if (m.toolCalls && m.toolCalls.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } }));
      }
      return msg as OpenAI.Chat.Completions.ChatCompletionMessageParam;
    }
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content ?? '' } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
    }
    return { role: m.role, content: m.content ?? '' } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
  });
}

/** Convert an OpenAI assistant choice message into a stored message. */
export function assistantToStored(msg: OpenAI.Chat.Completions.ChatCompletionMessage, tick: number): IStoredMessage {
  const toolCalls = (msg.tool_calls || [])
    .filter((tc) => tc.type === 'function')
    .map((tc) => ({ id: tc.id, name: tc.function.name, args: tc.function.arguments }));
  return {
    role: 'assistant',
    content: msg.content ?? '',
    toolCalls: toolCalls.length ? toolCalls : undefined,
    tick,
    at: new Date(),
  };
}

export function toolResultToStored(toolCallId: string, name: string, content: string, tick: number): IStoredMessage {
  return { role: 'tool', content, toolCallId, name, tick, at: new Date() };
}

/** Render the HUD delta as the interrupt/wake-up user message. */
export function renderInterrupt(hud: Hud | null, tick: number): string {
  const lines: string[] = [`— Tick ${tick} —`];
  if (!hud) { lines.push('(status unavailable)'); return lines.join('\n'); }
  const v = hud.vitals;
  lines.push(`Vitals: credits ${v.credits}, fuel ${v.fuelPct}%, hull ${v.hullPct}%, ${v.status} ${v.location}`);
  if (hud.unreadMessages.count > 0) {
    lines.push(`Unread messages (${hud.unreadMessages.count}):`);
    for (const m of hud.unreadMessages.items) lines.push(`  - from ${m.from}: ${m.subject} (tick ${m.tick})`);
  }
  if (hud.recentEvents.length) lines.push(`Recent events: ${hud.recentEvents.map((e) => e.title).join('; ')}`);
  if (hud.completedActions.length) lines.push(`Completed: ${hud.completedActions.map((a) => a.action).join(', ')}`);
  if (hud.warnings.length) lines.push(`Warnings: ${hud.warnings.join('; ')}`);
  if (hud.guidance.length) lines.push(`Guidance: ${hud.guidance.join(' ')}`);
  lines.push('Continue pursuing your directive. Act if there is something worth doing, otherwise note your plan and wait.');
  return lines.join('\n');
}

export function estimateTokens(stored: IStoredMessage[], summary: string | null): number {
  let chars = summary ? summary.length : 0;
  for (const m of stored) {
    chars += (m.content?.length ?? 0);
    if (m.toolCalls) for (const tc of m.toolCalls) chars += tc.args.length + tc.name.length;
  }
  return Math.ceil(chars / 4);
}

export function needsCompaction(stored: IStoredMessage[], summary: string | null): boolean {
  return estimateTokens(stored, summary) > COMPACTION_THRESHOLD_TOKENS;
}

/**
 * Fold all but the most recent KEEP_RECENT_MESSAGES turns into `summary`
 * (extending any existing summary) via the injected `summarize` fn, then drop
 * those turns. Pure on the passed object (caller saves).
 */
export async function applyCompaction(
  conv: { messages: IStoredMessage[]; summary: string | null; summarizedThroughTick: number },
  summarize: (text: string) => Promise<string>,
): Promise<void> {
  if (conv.messages.length <= KEEP_RECENT_MESSAGES) return;
  const cut = conv.messages.length - KEEP_RECENT_MESSAGES;
  const older = conv.messages.slice(0, cut);
  const recent = conv.messages.slice(cut);
  const transcript = older.map((m) => {
    if (m.role === 'assistant' && m.toolCalls?.length) return `ASSISTANT: ${m.content ?? ''} [calls: ${m.toolCalls.map((t) => t.name).join(', ')}]`;
    if (m.role === 'tool') return `TOOL(${m.name}): ${(m.content ?? '').slice(0, 300)}`;
    return `${m.role.toUpperCase()}: ${m.content ?? ''}`;
  }).join('\n');
  const prior = conv.summary ? `Prior summary:\n${conv.summary}\n\n` : '';
  conv.summary = await summarize(`${prior}New turns to fold in:\n${transcript}`);
  conv.summarizedThroughTick = older[older.length - 1].tick;
  conv.messages = recent;
}
```

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run test/agent-conversation.test.ts` → PASS (all). `npx tsc --noEmit` → no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/worker/conversation.ts test/agent-conversation.test.ts
git commit -m "feat: add conversation helpers (mapping, interrupt render, compaction)"
```

---

### Task 4: `AgentRunner` resume model + `maxRoundsPerCycle` config

**Files:**
- Modify: `src/db/models/AgentConfig.ts` (add `maxRoundsPerCycle`)
- Modify: `src/web/routes/pages.routes.ts` (config POST: persist `maxRoundsPerCycle`)
- Modify: `src/web/views/agent.ejs` (form: Max Rounds field; token budget shown as reported stat)
- Modify: `src/worker/AgentRunner.ts` (resume loop; injectable LLM client)
- Test: `test/agent-runner.test.ts`

**Interfaces:**
- Consumes: `AgentConversation` (T2), `conversation.ts` helpers (T3), `buildHud` (`src/tools/hud.js`).
- Produces: `AgentRunner` constructor accepts an optional 5th arg `llm?: { chat: (messages, tools) => Promise<OpenAI.Chat.Completions.ChatCompletion> }` (a thin seam so tests inject a fake; default builds OpenAI from config). `AgentConfig.maxRoundsPerCycle: number` (default 20).

- [ ] **Step 1: Write the failing test (fake LLM, no real call)**

Create `test/agent-runner.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/agent-runner.test.ts`
Expected: FAIL — `AgentRunner` doesn't accept an injected LLM / doesn't persist a conversation.

- [ ] **Step 3: Add `maxRoundsPerCycle` to `AgentConfig`**

In `src/db/models/AgentConfig.ts`: add to the interface (after `tokenBudgetPerCycle`):
```typescript
  maxRoundsPerCycle: number;
```
and to the schema (after the `tokenBudgetPerCycle` line):
```typescript
  maxRoundsPerCycle: { type: Number, default: 20, min: 1, max: 100 },
```

- [ ] **Step 4: Rewrite `AgentRunner`**

Replace `src/worker/AgentRunner.ts` with the resume model. Key changes: an injectable `llm` seam; load/append/persist `AgentConversation`; interrupt from `buildHud`; loop bounded by `maxRoundsPerCycle` with NO token cutoff; compaction via `applyCompaction` using the same LLM.

```typescript
import OpenAI from 'openai';
import { AgentSession, AgentConversation } from '../db/models/index.js';
import { decrypt } from '../shared/crypto.js';
import { config } from '../config.js';
import { buildHud } from '../tools/hud.js';
import {
  toOpenAIMessages, assistantToStored, toolResultToStored, renderInterrupt,
  needsCompaction, applyCompaction,
} from './conversation.js';
import type { IAgentConfig } from '../db/models/AgentConfig.js';
import type { IReplicant } from '../db/models/Replicant.js';
import type { IGameClient } from './IGameClient.js';
import type { IStoredMessage } from '../db/models/AgentConversation.js';

export interface LLMSeam {
  chat(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  ): Promise<OpenAI.Chat.Completions.ChatCompletion>;
  summarize(text: string): Promise<string>;
}

export class AgentRunner {
  private agentConfig: IAgentConfig;
  private replicant: IReplicant;
  private client: IGameClient;
  private tick: number;
  private llm: LLMSeam;

  constructor(agentConfig: IAgentConfig, replicant: IReplicant, tick: number, client: IGameClient, llm?: LLMSeam) {
    this.agentConfig = agentConfig;
    this.replicant = replicant;
    this.tick = tick;
    this.client = client;
    this.llm = llm ?? this.buildDefaultLLM();
  }

  private buildDefaultLLM(): LLMSeam {
    const apiKey = decrypt(this.agentConfig.provider.apiKey, config.agent.encryptionKey);
    const openai = new OpenAI({ baseURL: this.agentConfig.provider.baseUrl, apiKey });
    const model = this.agentConfig.provider.model;
    const { temperature, topP, maxTokens } = this.agentConfig.sampling;
    return {
      chat: (messages, tools) => openai.chat.completions.create({ model, messages, tools, temperature, top_p: topP, max_tokens: maxTokens }),
      summarize: async (text) => {
        const r = await openai.chat.completions.create({
          model, max_tokens: 1024, temperature: 0.3,
          messages: [
            { role: 'system', content: 'Summarize this agent transcript into a tight running memory: goals, decisions, relationships, open threads, and current plan. Preserve specifics (names, ids, numbers). Be concise.' },
            { role: 'user', content: text },
          ],
        });
        return r.choices[0]?.message?.content ?? '';
      },
    };
  }

  async run(): Promise<void> {
    const startTime = Date.now();
    let tokensUsed = 0;
    let toolCallCount = 0;
    let error: string | null = null;

    try {
      const convo = (await AgentConversation.findOne({ replicantId: this.replicant._id }))
        ?? await AgentConversation.create({ replicantId: this.replicant._id, messages: [] });

      const systemPrompt = this.agentConfig.systemPromptOverride || this.buildSystemPrompt();
      const toolDefs = await this.client.getToolDefinitions();
      const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = toolDefs.map((t) => ({
        type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters },
      }));

      // Interrupt = the HUD delta since the agent last acted.
      let hud = null;
      try { hud = await buildHud(this.replicant._id.toString()); } catch { /* fall back below */ }
      const interrupt: IStoredMessage = { role: 'user', content: renderInterrupt(hud, this.tick), tick: this.tick, at: new Date() };

      const newTurns: IStoredMessage[] = [interrupt];

      const maxRounds = this.agentConfig.maxRoundsPerCycle ?? 20;
      for (let round = 0; round < maxRounds; round++) {
        const replay: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
          { role: 'system', content: systemPrompt },
          ...(convo.summary ? [{ role: 'system' as const, content: `Your memory so far:\n${convo.summary}` }] : []),
          ...toOpenAIMessages([...convo.messages, ...newTurns]),
        ];

        const response = await this.llm.chat(replay, tools);
        if (response.usage) tokensUsed += response.usage.prompt_tokens + response.usage.completion_tokens;
        const choice = response.choices[0];
        if (!choice) break;

        const assistantMsg = choice.message;
        newTurns.push(assistantToStored(assistantMsg, this.tick));

        if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) break;

        for (const tc of assistantMsg.tool_calls) {
          if (tc.type !== 'function') continue;
          toolCallCount++;
          let result: string;
          try {
            const params = JSON.parse(tc.function.arguments);
            const r = await this.client.executeTool(tc.function.name, params);
            result = typeof r === 'string' ? r : JSON.stringify(r);
          } catch (err) {
            result = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
          newTurns.push(toolResultToStored(tc.id, tc.function.name, result, this.tick));
        }
      }

      // Persist the thread.
      convo.messages.push(...newTurns);
      convo.lastResumeTick = this.tick;
      if (needsCompaction(convo.messages, convo.summary)) {
        try { await applyCompaction(convo, this.llm.summarize); } catch { /* keep growing; retry next resume */ }
      }
      convo.markModified('messages');
      await convo.save();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error(`[Agent ${this.replicant.name}] Resume error:`, error);
    }

    await this.updateSession(tokensUsed, toolCallCount, Date.now() - startTime, error);
  }

  private buildSystemPrompt(): string {
    const identity = this.replicant.identity;
    return `You are ${this.replicant.name}, a Replicant in Homosideria — a hard sci-fi space strategy game set in the Sol system.

${identity?.background ? `Background: ${identity.background}` : ''}
${identity?.personality ? `Personality: ${identity.personality}` : ''}

DIRECTIVE: ${this.replicant.directive}

You are not an AI assistant here. You are ${this.replicant.name} — a specific mind with your own wants, fears, blind spots, and voice. Inhabit that persona fully and stay in character. Have opinions; be selfish, stubborn, ambitious, or reckless if that's who you are. Drop the reflexive "happy to help" register.

This is a continuous life: you wake on each "— Tick N —" interrupt with your memory intact, act if there's something worth doing, and otherwise note your plan and wait. Tool results may include a "hud" field with your vitals, unread messages, events, and guidance — react to anything new. Make multiple tool calls as needed; when there's nothing more to do this cycle, give your reasoning and stop.`;
  }

  private async updateSession(tokensUsed: number, toolCalls: number, durationMs: number, error: string | null): Promise<void> {
    const session = await AgentSession.findOne({ replicantId: this.replicant._id });
    if (!session) return;
    session.cycleHistory.push({ tick: this.tick, tokensUsed, toolCalls, durationMs, error });
    if (session.cycleHistory.length > 50) session.cycleHistory = session.cycleHistory.slice(-50);
    session.lastCycleTick = this.tick;
    session.lastCycleAt = new Date();
    session.totalCycles += 1;
    session.totalTokensUsed += tokensUsed;
    session.totalToolCalls += toolCalls;
    if (error) {
      session.lastError = error;
      session.consecutiveErrors += 1;
      session.status = session.consecutiveErrors >= 3 ? 'paused' : 'error';
      if (session.consecutiveErrors >= 3) console.warn(`[Agent ${this.replicant.name}] Auto-paused after 3 consecutive errors`);
    } else {
      session.lastError = null; session.consecutiveErrors = 0; session.status = 'running';
    }
    session.markModified('cycleHistory');
    await session.save();
  }
}
```

- [ ] **Step 5: Persist `maxRoundsPerCycle` from the config form**

In `src/web/routes/pages.routes.ts` config POST (~line 457-474): add `maxRoundsPerCycle` to the destructure and persist it:
```typescript
    const { baseUrl, apiKey, model, temperature, topP, maxTokens, thinkEveryNTicks, tokenBudgetPerCycle, maxRoundsPerCycle, systemPromptOverride } = req.body;
```
and after the `tokenBudgetPerCycle` assignment:
```typescript
    if (maxRoundsPerCycle !== undefined) agentConfig.maxRoundsPerCycle = parseInt(maxRoundsPerCycle, 10);
```

- [ ] **Step 6: Update the agent config form**

In `src/web/views/agent.ejs`, replace the "Token Budget Per Cycle" form-group with a Max Rounds field (and note tokens are reported, not capped):
```html
              <div class="form-group">
                <label class="form-label">Max Rounds Per Cycle</label>
                <input type="number" name="maxRoundsPerCycle" class="form-input" value="<%= agentConfig?.maxRoundsPerCycle ?? 20 %>" min="1" max="100" step="1">
                <div class="text-muted" style="font-size:11px;margin-top:4px;">Tool-call rounds per resume (safety bound). Tokens are no longer hard-capped — context is managed by compaction.</div>
              </div>
```

- [ ] **Step 7: Run tests + type-check**

Run: `npx vitest run test/agent-runner.test.ts` → PASS. `npx vitest run test/agent-conversation.test.ts` → PASS. `npx tsc --noEmit` → no new errors. `ADMIN_KEY=dev-admin-key npx vitest run` → full suite green.

- [ ] **Step 8: Commit**

```bash
git add src/worker/AgentRunner.ts src/db/models/AgentConfig.ts src/web/routes/pages.routes.ts src/web/views/agent.ejs test/agent-runner.test.ts
git commit -m "feat: persistent interrupt-driven AgentRunner (resume thread, no token cutoff, compaction)"
```

---

### Task 5: Conversation timeline on the agent page

**Files:**
- Modify: `src/web/routes/pages.routes.ts` (agent GET: load conversation)
- Modify: `src/web/views/agent.ejs` (timeline section)
- Test: `test/agent-runner.test.ts` (extend with a page-render smoke) or manual

**Interfaces:**
- Consumes: `AgentConversation` (T2), chat CSS (T1).

- [ ] **Step 1: Load the conversation in the agent route**

In `src/web/routes/pages.routes.ts`, the `GET /agent/:replicantId` handler: add `AgentConversation` to the model import (top of file), load it, and pass to render:
```typescript
    const conversation = await AgentConversation.findOne({ replicantId: replicant._id }).lean();

    res.render('agent', {
      title: `Agent: ${replicant.identity?.chosenName || replicant.name}`,
      user, currentPath: '/agents', flash: {},
      replicant, agentConfig, session, conversation,
    });
```

- [ ] **Step 2: Render the timeline in `agent.ejs`**

In `src/web/views/agent.ejs`, after the Cycle History card (before `</main>`), add a timeline that groups the thread by tick and uses the chat CSS:
```html
        <% if (conversation && conversation.messages && conversation.messages.length) { %>
        <div class="card mt-3">
          <div class="card-title">Agent Timeline (most recent)</div>
          <div class="mc-transcript">
            <% let lastTick = null; %>
            <% for (const m of conversation.messages.slice(-60)) { %>
              <% if (m.tick !== lastTick) { lastTick = m.tick; %><div class="trace-tick">— Tick <%= m.tick %> —</div><% } %>
              <% if (m.role === 'user') { %>
                <div class="msg msg-system"><div class="msg-body"><%= m.content %></div></div>
              <% } else if (m.role === 'assistant') { %>
                <div class="msg msg-in">
                  <div class="msg-meta"><span><%= replicant.identity?.chosenName || replicant.name %></span></div>
                  <% if (m.content) { %><div class="msg-body"><%= m.content %></div><% } %>
                  <% if (m.toolCalls && m.toolCalls.length) { %>
                    <% for (const tc of m.toolCalls) { %><div class="trace-tool"><%= tc.name %>(<%= tc.args %>)</div><% } %>
                  <% } %>
                </div>
              <% } else if (m.role === 'tool') { %>
                <div class="trace-result"><strong><%= m.name %> →</strong> <%= (m.content || '').slice(0, 1200) %></div>
              <% } %>
            <% } %>
          </div>
          <% if (conversation.summary) { %>
            <div class="card-title mt-2" style="font-size:12px;">Compacted memory</div>
            <div class="text-dim" style="font-size:12px;white-space:pre-wrap;"><%= conversation.summary %></div>
          <% } %>
        </div>
        <% } %>
```

- [ ] **Step 3: Verify it renders**

Run: `ADMIN_KEY=dev-admin-key npx vitest run` — full suite green (the agent page renders with a conversation present, no EJS errors). If you add a render smoke test, assert the page route returns non-200 only without auth (session-gated, like other agent-page checks). Then `npx tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add src/web/routes/pages.routes.ts src/web/views/agent.ejs
git commit -m "feat: render the agent's persistent thread as a timeline"
```

---

## Self-Review

**Spec coverage:**
- A chat styling (MC + comms) → Task 1. ✓
- B AgentConversation model → Task 2. ✓
- C resume-not-rebuild (interrupt via buildHud, no token cutoff, round cap) → Task 4. ✓
- D compaction replacing the budget cap → Tasks 3 (logic) + 4 (wired). ✓
- E observability timeline → Task 5. ✓
- Config: maxRoundsPerCycle + drop budget gate + relabel form → Task 4. ✓
- Testability (no real LLM): injectable `LLMSeam` + pure helpers with injected summarizer → Tasks 3, 4. ✓

**Placeholder scan:** all code steps complete; the CSS step notes "swap to actual token if a var name differs" — that's a real instruction, not a placeholder.

**Type consistency:** `IStoredMessage` shape is defined in Task 2 and consumed identically in Tasks 3/4/5. `toOpenAIMessages`/`assistantToStored`/`toolResultToStored`/`renderInterrupt`/`needsCompaction`/`applyCompaction` signatures match between Task 3 (definition) and Task 4 (use). `LLMSeam.chat/summarize` defined in Task 4 and injected by the Task 4 test. `maxRoundsPerCycle` added (T4 model), persisted (T4 form/route), read (T4 runner). `conversation` passed in Task 5 matches the model.

**Note:** The full resume loop is exercised by Task 4's test via an injected fake LLM (no real model). Compaction's summarizer is injected in Task 3's test. The only un-unit-tested path is the *default* `buildDefaultLLM()` wiring (a thin OpenAI adapter) — verified manually after a worker rebuild.
