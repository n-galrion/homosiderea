# Persistent, Interrupt-Driven Agents + Observability + Chat UI

**Date:** 2026-06-21
**Status:** Approved design, pending spec review

## Problem

The managed-agent runtime is **stateless-episodic**: every `thinkEveryNTicks`, a BullMQ job spins up a fresh `AgentRunner`, rebuilds context from a 10-message / 10-action snapshot, runs a bounded 20-round loop with a hard per-cycle token budget, then **discards the entire conversation**. Consequences the operator hit:

1. **Token budget feels restrictive** — full context + all 79 tool defs are re-sent every round, so a 50K budget is consumed in ~1–2 rounds and the agent is cut off mid-thought.
2. **Can't follow the agent** — only aggregate stats (`tokensUsed`, `toolCalls`, `durationMs`) are persisted; the reasoning and tool calls/results are built in memory and thrown away, so the dashboard has nothing to show.
3. **MC console (and comms) don't look like conversations** — the chat markup uses CSS classes (`.msg-in/.msg-out`, `.mc-*`) that don't exist in `style.css`, so they render as plain stacked divs.

The deeper issue (1 and 2): **agents shouldn't be torn down and rebuilt each tick.** A real agent runs a continuous thread and is *interrupted/resumed* by events, keeping its train of thought. The episodic model is the root cause.

## Direction (approved)

Make agents **persistent and interrupt-driven**, keeping the existing BullMQ + `tick:complete` plumbing as the event source. v1 interrupt cadence = tick-driven (every `thinkEveryNTicks`); event-driven wakeups (resume the instant a message arrives) are a noted follow-up. Chat styling (#3) is an independent quick win.

## Architecture

### A. Chat styling (independent)
Add the missing chat CSS to `src/web/public/css/style.css`: `.msg`, `.msg-in`/`.msg-out` (bubble + left/right alignment), `.msg-meta`, `.msg-body`, `.msg-system` (distinct Mission-Control/system style), and the MC-specific `.mc-transcript` (scrollable column), `.mc-actions`/`.mc-action` with `.mc-action-pending|applied|discarded` color states, `.mc-action-status`, `.mc-input`. Plus a small auto-scroll-to-bottom script on the MC page. No template/logic changes — fixes the MC page *and* the replicant comms page.

### B. Persistent conversation model
New collection `AgentConversation` (one per replicant) holds the running thread:

```
{
  replicantId: ObjectId (unique, indexed),
  messages: [{
    role: 'system' | 'user' | 'assistant' | 'tool',
    content: string | null,
    toolCalls?: [{ id: string, name: string, args: string }],   // assistant tool-call requests (args = JSON string)
    toolCallId?: string,                                          // for role:'tool' results
    name?: string,                                                // tool name for role:'tool'
    tick: number,                                                 // the interrupt tick this turn belongs to
    at: Date,
  }],
  summary: string | null,        // rolling compaction memory of older turns
  summarizedThroughTick: number, // turns up to here are folded into `summary`
  lastResumeTick: number,
  createdAt, updatedAt,
}
```

Messages are stored in a shape that both (a) maps cleanly back to OpenAI `ChatCompletionMessageParam` for replay and (b) renders as a timeline. The `system` persona message is NOT stored in `messages` (it's rebuilt fresh each resume from current identity/directive so persona/directive edits take effect).

### C. Resume instead of rebuild (`AgentRunner` rewrite)
`AgentRunner.run(tick)` becomes a **resume**:
1. Load (or create) the agent's `AgentConversation`.
2. Build the LLM message array: `[ freshSystemPrompt, (summary as a system note if present), ...storedMessages.mapToOpenAI(), interruptMessage ]`.
3. **Interrupt message** (the "what changed since you last acted" wake-up): reuse `buildHud(replicantId)` (vitals, unread messages, recent events, completed actions, warnings, guidance) rendered to a readable text block, prefixed `— Tick N —`. This is the delta that resumes the thread.
4. Run the tool-calling loop, **continuing the thread**: each assistant message and each tool result is appended to the conversation (with `tick`). Loop until the model stops requesting tools or `maxRoundsPerCycle` is hit. **No mid-thought token cutoff.**
5. Persist the new turns onto `AgentConversation`; update `AgentSession` stats (tokensUsed/toolCalls/duration as today, for the dashboard summary).
6. Run compaction (D) if the thread is large.

`buildSystemPrompt()` (the persona prompt) is rebuilt each resume and prepended; it is the only "always-fresh" message. The interrupt message is appended as `role:'user'`.

### D. Context compaction (replaces the token-budget cap)
A forever-thread will exceed the model's context window, so:
- Estimate thread size (sum of message `content` lengths ÷ 4 ≈ tokens; cheap heuristic).
- When it exceeds `COMPACTION_THRESHOLD_TOKENS` (default ~40K), summarize the oldest turns (everything except the most recent `KEEP_RECENT_MESSAGES`, default 20) into/extending `summary` via one LLM call (same provider/model), then drop those turns from `messages` and advance `summarizedThroughTick`.
- Result: the replayed context is always `system + summary + recent turns`, bounded, so the agent can "run forever."
- This is the real control. The per-cycle **token hard cap is removed** (no mid-thought cutoff); a per-resume **`maxRoundsPerCycle`** (config, default 20) remains as the only safety against a runaway single resume.

### E. Observability = the conversation (timeline view)
The persisted `AgentConversation` IS the trace. The agent page (`agent.ejs`) gains a **timeline** rendering the thread grouped by `tick`/interrupt: for each turn, show assistant reasoning (`content`), tool calls (`name` + pretty `args`), and tool results (`role:'tool'` content). Newest interrupt at the bottom (or top — operator preference; default newest-last like a chat). Server-rendered; reuse the chat CSS from (A). The existing aggregate stats table stays as a summary header.

### Config changes (`AgentConfig`)
- Remove the per-cycle token-budget gate from the runtime. Keep `tokenBudgetPerCycle` as a stored field but stop enforcing it (display as "tokens/cycle (reported)"), OR replace it in the UI with `maxRoundsPerCycle`. Decision: **add `maxRoundsPerCycle` (default 20)**, drop the budget gate in `AgentRunner`, and relabel the agent-config form field accordingly (token budget shown as a stat, not a limit).

## Components

| Unit | Responsibility |
|------|----------------|
| `src/web/public/css/style.css` | Chat-bubble + MC-action styling (A) |
| `src/db/models/AgentConversation.ts` | Persistent thread + summary (B) |
| `src/worker/conversation.ts` (new) | Pure helpers: map stored ↔ OpenAI messages; render `buildHud` result → interrupt text; estimate size; decide+apply compaction (LLM summarizer injectable) |
| `src/worker/AgentRunner.ts` | Resume model: load thread → interrupt → loop (no cutoff, round cap) → persist → compact (C, D) |
| `src/db/models/AgentConfig.ts` + `agent.ejs` | `maxRoundsPerCycle`; drop budget gate; relabel form |
| `src/web/routes/*` + `agent.ejs` | Conversation timeline view (E) |

## Error handling
- A new agent with an empty conversation seeds from the system prompt + first interrupt — no special case.
- Tool-call execution errors are recorded as the tool result (as today) and the loop continues.
- Compaction LLM failure: skip compaction this resume (thread keeps growing; retried next resume) — never abort the cycle.
- Missing LLM key: the resume can't run (LLM-driven); record the error on the session as today.
- `buildHud` runs in the worker process against the shared DB (worker has a mongoose connection); if it throws, fall back to a minimal interrupt ("— Tick N — (status unavailable)").

## Testing
LLM calls aren't exercised in tests (no key). Test the deterministic, decomposed pieces:
- `AgentConversation` model round-trips messages with toolCalls/toolCallId.
- `conversation.ts`: stored↔OpenAI message mapping; HUD→interrupt-text rendering (feed a known HUD object, assert the text); size estimate; compaction **decision** (over/under threshold) and **application** with an injected fake summarizer (assert old turns replaced by summary, recent kept, `summarizedThroughTick` advanced) — no real LLM.
- `AgentConfig`/form: `maxRoundsPerCycle` persists; budget gate removed (assert `AgentRunner` no longer breaks on token count — via a unit on the loop-control helper, or a documented manual check).
- Timeline view: renders a conversation with reasoning + tool call + result without EJS errors (operator-only auth enforced).
- Chat CSS: visual; verify the classes exist and the pages render (smoke).
- Existing tests stay green (`ADMIN_KEY=dev-admin-key`).

## Non-goals (v1)
- Event-driven wakeups (resume instantly on message/event arrival) — keep tick-cadence; note as follow-up.
- Multi-agent shared memory.
- Streaming the live cycle to the browser — the timeline is persisted-then-rendered (refresh to update); live streaming is a later enhancement.
- Changing the BullMQ scheduling / tick source.
