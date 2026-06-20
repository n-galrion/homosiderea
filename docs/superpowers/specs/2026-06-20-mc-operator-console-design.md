# Operator ↔ Master Controller Console

**Date:** 2026-06-20
**Status:** Approved design, pending spec review

## Problem

The Master Controller (MC) — the LLM world-simulator in `src/engine/systems/MCWorldSimulator.ts` — only runs on a fixed schedule (every 50 ticks) and executes its tool calls immediately. The operator (game master) has no way to direct it: to say "stir up pirate trouble near Mars" or "make Shanghai turn on the replicants" and have the MC make it happen. We want a web console where the operator converses with the MC and it dispatches world events — but with the operator approving the MC's proposed actions before they hit game state.

## Decisions (from brainstorming)

- **Conversational** multi-turn chat with persisted history.
- **Propose-then-confirm**: the MC proposes tool actions; nothing changes until the operator applies them.
- **New event types** added beyond the existing 5 MC tools: `spawn_pirates`, `trigger_disaster`, `spawn_salvage`.
- **Dedicated `/admin/mc` page**, operator-only, server-rendered like the rest of the dashboard.
- Routes live in **new files** to avoid tangling the operator's in-progress WIP in `admin.routes.ts` / `admin.pages.routes.ts`.

## Architecture

The MC's tools are currently *defined and executed inline* by `simulateWorldWithMC`. We split **decide** from **execute** and centralize both, so the same tools serve the scheduled world-sim (execute immediately) and the operator console (propose, then execute on approval).

### Unit boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `src/engine/systems/mc/tools.ts` | `MC_TOOLS` defs (5 existing + 3 new) and `executeMCTool(name, args, tick)` dispatcher (all handlers) | DB models, pirate/salvage systems |
| `src/engine/systems/mc/propose.ts` | `proposeMCActions(history)` — runs the LLM with `MC_TOOLS`, returns `{ reply, proposedActions }` WITHOUT executing | `tools.ts`, OpenAI client, config |
| `src/services/mcChat.ts` | Conversation service: `getConversation()`, `sendOperatorMessage(text)`, `applyProposed(messageId)`, `discardProposed(messageId)` | `propose.ts`, `tools.ts`, `MCConversation` model |
| `src/db/models/MCConversation.ts` | Persisted transcript + pending actions (single global thread) | — |
| `src/api/routes/mc.routes.ts` | `/api/admin/mc/*` REST endpoints → call the service | `mcChat.ts`, admin auth |
| `src/web/routes/mc.pages.routes.ts` | `/admin/mc` page + form POSTs → call the service, render | `mcChat.ts`, role auth |
| `src/web/views/admin/mc.ejs` | Transcript + pending-action Apply/Discard forms + input | — |

`MCWorldSimulator.ts` is refactored to import `MC_TOOLS`/`executeMCTool` from `mc/tools.ts` (no behavior change — it still executes inline in its 5-round loop).

## Components & data flow

### Propose vs execute
- `proposeMCActions(history)`: builds `[{role:'system', operatorPrompt}, ...history]`, calls the LLM once with `tools: MC_TOOLS` (no forced tool_choice). The assistant's `content` is the MC's in-character reply; any `tool_calls` become `proposedActions: [{ tool, args }]` — **not executed**. Returns `{ reply, proposedActions }`. (No multi-round loop — we're proposing, not executing.)
- `executeMCTool(name, args, tick)`: dispatch table of handlers (existing 5 + 3 new). Returns a human-readable result string. Used by both the scheduled sim and `applyProposed`.

### Conversation service
- `sendOperatorMessage(text)`: load (or create) the global `MCConversation`; push `{role:'operator', content:text}`; call `proposeMCActions(historyAsChatMessages)`; push `{role:'mc', content:reply, proposedActions:[{tool,args,status:'pending',result:null}]}`; save; return the new MC message. If no LLM key: push an MC message `content: 'MC offline — no LLM configured.'` with no actions.
- `applyProposed(messageId)`: find the MC message; for each `pending` action run `executeMCTool(tool, args, currentTick)`, set `status:'applied'`, `result`; save; return results.
- `discardProposed(messageId)`: set all that message's `pending` actions to `discarded`; save.
- History → chat messages: `operator`→`user`, `mc`→`assistant` (content only). Cap conversation to the last 100 messages.

### Operator system prompt
A variant of the world-sim prompt telling the MC it is responding to the operator (game master): converse in-character, and when the operator wants something to happen, call the appropriate tools to propose it (the operator will approve). Same "be specific, hard sci-fi, name real settlements" rules.

## New tools

Each reuses an existing subsystem; all are `executeMCTool` handlers and appear in `MC_TOOLS`.

1. **`spawn_pirates`** — `{ nearSettlementName?: string, nearBodyName?: string, count: number (1-5), threatLevel?: 'low'|'medium'|'high', narrative: string }`. Resolves a position from the named settlement's body or a named celestial body. Creates `count` pirate ships (`Ship.create`, `ownerId = PIRATE_OWNER_ID` sentinel `000000000000000000000001`, `type:'warship'`, combatPower scaled by threatLevel, position near the target), mirroring `ensurePiratePresence` in `PirateActivity.ts`. Returns a summary.
2. **`trigger_disaster`** — `{ settlementName: string, severity: 'minor'|'major'|'catastrophic', narrative: string }`. Sets settlement `status` (major/catastrophic → `damaged`), reduces population by a severity-scaled fraction, and broadcasts a `world_event` message (the narrative) to all active replicants. Returns a summary.
3. **`spawn_salvage`** — `{ nearBodyName: string, richness?: 'poor'|'moderate'|'rich', narrative: string }`. Creates one or more `Salvage` documents near the named body (reusing `Salvage.create` field shapes from `SalvageGenerator.ts`), scaled by richness. Returns a summary.

(NPC-fleet spawn is deferred — `NPCDispatch` encodes missions in ship names, too tangled for v1.)

## Data model — `MCConversation`

Single global document (created on first use).

```
{
  messages: [{
    role: 'operator' | 'mc',
    content: string,
    tick: number,
    at: Date,
    proposedActions?: [{
      tool: string,
      args: Record<string, unknown>,   // Mixed
      status: 'pending' | 'applied' | 'discarded',
      result: string | null,
    }],
  }],
}
```

Messages array is capped to the most recent 100 on save.

## REST endpoints (`/api/admin/mc/*`, admin-key auth)

- `GET /api/admin/mc/conversation` → `{ messages }`.
- `POST /api/admin/mc/chat { message }` → runs `sendOperatorMessage`, returns the new MC message (reply + pending actions).
- `POST /api/admin/mc/apply { messageId }` → runs `applyProposed`, returns `{ results }`.
- `POST /api/admin/mc/discard { messageId }` → runs `discardProposed`, returns `{ ok: true }`.

## Web page (`/admin/mc`, operator-only, session role)

- `GET /admin/mc` → render `admin/mc.ejs`: the transcript (operator + MC messages), each MC message's proposed actions with **Apply** / **Discard** buttons (forms), and a message input form. Server-rendered, form-POST + redirect — no heavy client JS.
- `POST /admin/mc/chat` (form) → `sendOperatorMessage(text)` → redirect `/admin/mc`.
- `POST /admin/mc/apply` (form, `messageId`) → `applyProposed` → redirect.
- `POST /admin/mc/discard` (form, `messageId`) → `discardProposed` → redirect.

The page routes call the **service directly** (no internal HTTP hop). A nav link to `/admin/mc` is added to the admin navigation partial, and the route files are mounted in the web/api app setup — these are the only touches to shared/existing files, kept minimal and separable.

## Error handling & fallback

- No LLM key → the MC reply is a fixed "MC offline — no LLM configured." message with no proposed actions (operator chat is inherently LLM-driven; no deterministic fallback).
- LLM/tool errors during `propose` are caught; the MC message records the error as its content rather than throwing.
- `applyProposed` runs each action in its own try/catch; a failing action records its error in `result` and does not block the others.
- Applying an already-applied/discarded message is a no-op.

## Testing

- **New tool handlers** (`executeMCTool`) — direct DB-backed tests: `spawn_pirates` creates N pirate-owned ships near the target; `trigger_disaster` damages the settlement + broadcasts to replicants; `spawn_salvage` creates salvage near the body. Assert on persisted state.
- **Conversation service** — `applyProposed` executes pending actions and marks them applied (using a hand-crafted MC message with `proposedActions`, so no LLM needed); `discardProposed` marks discarded; double-apply is a no-op; `MCConversation` caps at 100 messages.
- **Endpoints / page** — operator-only auth enforced; apply/discard endpoints invoke the service and return results.
- The LLM `propose` path is **not** unit-tested (no key in the test env); the apply/execute half is fully covered with crafted proposals.
- Existing tests must continue to pass (`mongodb-memory-server`, single fork, `ADMIN_KEY=dev-admin-key`).

## Non-goals

- No streaming responses; chat is request/response with page reload.
- No NPC-fleet spawn tool in v1.
- No change to the scheduled world-sim cadence or behavior (only refactored to share the tool module).
- No multi-operator conversation threading — a single global MC thread.
