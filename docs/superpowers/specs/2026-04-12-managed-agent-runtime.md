# Managed Agent Runtime — Design Spec

## Overview

A system that runs AI agents for replicants inside the Homosideria game. Users provide their own LLM credentials (provider URL, API key, model, sampling parameters) and the system executes an agentic loop on their behalf — building context from game state, calling the LLM, executing tool calls via REST, and repeating until the token budget is exhausted.

**Key properties:**
- Separate worker process communicating with the game server via Redis (tick signals) and REST (game interactions)
- Users configure everything: LLM provider, model, samplers, think interval, token budget, system prompt
- API keys encrypted at rest in MongoDB (AES-256-GCM)
- Worker is a pure REST client — can be open-sourced as a standalone agent runner
- Horizontally scalable — multiple workers, Redis locks prevent duplicate execution

---

## Data Model

### AgentConfig

One per replicant. Stores the user's LLM configuration and scheduling preferences.

```
AgentConfig {
  userId: ObjectId              // ref User — who owns this config
  replicantId: ObjectId         // ref Replicant — unique, one config per replicant
  enabled: boolean              // master on/off switch

  provider: {
    baseUrl: string             // e.g. "https://openrouter.ai/api/v1"
    apiKey: string              // AES-256-GCM encrypted at rest
    model: string               // e.g. "anthropic/claude-sonnet-4"
  }

  sampling: {
    temperature: number         // default 0.7
    topP: number                // default 1.0
    maxTokens: number           // max output tokens per LLM call, default 4096
  }

  thinkEveryNTicks: number      // how often the agent thinks (default 5)
  tokenBudgetPerCycle: number   // max total tokens per think cycle (default 50000, max 200000)

  systemPromptOverride: string | null   // custom system prompt, null = use default
}
```

### AgentSession

Runtime state for an active agent. One per replicant with an AgentConfig.

```
AgentSession {
  replicantId: ObjectId         // unique
  status: 'running' | 'paused' | 'stopped' | 'error'
  lastCycleTick: number
  lastCycleAt: Date
  lastError: string | null
  consecutiveErrors: number     // 3 → auto-pause

  totalCycles: number
  totalTokensUsed: number
  totalToolCalls: number

  cycleHistory: [{              // last 50 cycles, ring buffer
    tick: number
    tokensUsed: number
    toolCalls: number
    durationMs: number
    error: string | null
  }]
}
```

### Encryption

- Algorithm: AES-256-GCM via Node.js `crypto` module
- Storage format: `{iv_hex}:{authTag_hex}:{ciphertext_hex}`
- Key: `AGENT_ENCRYPTION_KEY` env var (64-char hex = 32 bytes)
- Utility: `src/shared/crypto.ts` with `encrypt(plaintext, key)` / `decrypt(ciphertext, key)`
- API keys are decrypted only in the worker process, only for the duration of an LLM call

---

## Architecture

```
Game Server Process                    Agent Worker Process
┌──────────────────────┐              ┌──────────────────────────┐
│                      │              │                          │
│  GameLoop            │   Redis      │  WorkerLoop              │
│  ├─ processTick()    │──publish──→  │  ├─ onTickComplete()     │
│  │  └─ after tick:   │ "tick:N"     │  │  └─ for each due      │
│  │    redis.publish() │              │  │      agent:            │
│  │                   │              │  │    AgentRunner.run()   │
│  REST API            │              │  │                        │
│  ├─ /api/tools/:name │←── HTTP ────│  AgentRunner              │
│  ├─ /api/replicants/ │              │  ├─ buildContext()        │
│  ├─ /api/game/       │              │  │   GET /api/replicants/ │
│  └─ etc.             │              │  │   GET messages, ships  │
│                      │              │  ├─ callLLM()             │
│  MongoDB             │              │  │   user's provider/key  │
│  ├─ Game data        │              │  ├─ executeTool()         │
│  ├─ AgentConfig ─────│──read──────→ │  │   POST /api/tools/:n  │
│  └─ AgentSession ────│←─write──────│  └─ loop until budget     │
│                      │              │      exhausted or done    │
└──────────────────────┘              └──────────────────────────┘
```

### Boundaries

- **Worker → Game**: All game interactions via REST API. Worker authenticates with the replicant's API key. Same permissions as any external MCP/REST client.
- **Worker → MongoDB**: Direct connection ONLY for reading AgentConfig and writing AgentSession. No game data access through MongoDB.
- **Game Server → Worker**: Redis pub/sub only. Game server publishes `tick:complete` with `{ tick: N }` after each tick. No other coupling.
- **Horizontal scaling**: Multiple workers subscribe to the same Redis channel. Redis locks (`SET agent:lock:{replicantId} {workerId} NX EX 60`) prevent two workers from running the same agent simultaneously.

---

## Generic Tool Execution Endpoint

New REST endpoint that exposes all MCP tools via HTTP:

```
POST /api/tools/:toolName
Headers: X-API-Key: {replicant's API key}  (or X-Replicant-Name + X-Replicant-Password, or Bearer JWT)
Body: { ...tool parameters as JSON }
Response: { result: ...tool output as JSON }
```

### Tool Registry Refactor

Extract core tool logic from MCP binding layer into standalone handlers:

```typescript
// src/tools/registry.ts
type ToolHandler = (replicantId: string, params: Record<string, unknown>) => Promise<unknown>;
const toolRegistry = new Map<string, { handler: ToolHandler; schema: object; description: string }>();

export function registerTool(name: string, description: string, schema: object, handler: ToolHandler): void;
export function getTool(name: string): { handler: ToolHandler; schema: object; description: string } | undefined;
export function getAllTools(): Array<{ name: string; description: string; schema: object }>;
```

Both layers consume the registry:
- **MCP layer**: `server.tool(name, description, zodSchema, (params) => registry.get(name).handler(replicantId, params))`
- **REST layer**: `router.post('/tools/:toolName', auth, (req, res) => registry.get(toolName).handler(req.replicantId, req.body))`
- **Worker**: Fetches tool definitions from `GET /api/tools` and executes via `POST /api/tools/:toolName`

This is the biggest refactor in the project but gives a universal tool interface.

---

## Agent Runtime — Think Cycle

### Context Building (all via REST)

Each think cycle, the worker assembles context by calling:

1. `GET /api/replicants/me` — identity, compute, energy, directive, location, credits
2. `GET /api/replicants/me/ships` — fleet status (fuel, hull, cargo, position, orbiting body)
3. `GET /api/replicants/me/messages?limit=10` — recent inbox (comms, world events, rumors)
4. `GET /api/replicants/me/actions?limit=10` — recent action results

Assembled into a system prompt:

```
You are {name}, a Replicant in Homosideria — a hard sci-fi space strategy game set in the Sol system.

{background}
{personality}

DIRECTIVE: {directive}

CURRENT STATE:
{assembled context from REST calls}

You have tools to interact with the world. Use them to pursue your directive.
Think step by step about what to do, then act. You can make multiple tool calls.
When you have no more actions to take this cycle, respond with your reasoning and stop.
```

If the user has set `systemPromptOverride`, use that instead (with context still injected as the user message).

### Tool Definitions

The worker fetches available tools from `GET /api/tools` (returns name, description, parameter schema for all tools). These are translated to OpenAI function-calling format and included in the LLM request.

### Agentic Loop

```
1. Build context via REST
2. Send system prompt + context + tool definitions to user's LLM
3. Read response:
   a. If no tool calls → cycle complete, log results
   b. If tool calls → execute each via POST /api/tools/:name
   c. Append tool results to conversation
   d. Track tokens: prompt_tokens + completion_tokens from response.usage
   e. If cumulative tokens >= tokenBudgetPerCycle → stop loop, log budget exhaustion
   f. Otherwise → go to step 2 with updated conversation
4. Update AgentSession with cycle stats
```

### Token Tracking

- After each LLM call, read `usage.prompt_tokens` + `usage.completion_tokens` from the OpenAI-compatible response
- Running total per cycle. If total >= `tokenBudgetPerCycle`, stop the loop
- Token usage logged in AgentSession.cycleHistory and running totals

### Error Handling

- **LLM API errors** (rate limit, auth failure, timeout): log error in AgentSession, set status to `error`, skip this cycle
- **Tool execution errors** (4xx/5xx from REST): return the error text to the LLM as the tool result — let it adapt and try something else
- **3 consecutive cycle errors**: auto-pause the agent (`status: 'paused'`), user must manually restart from web UI

---

## Infrastructure Changes

### Redis

- Package: `ioredis`
- Docker: `redis:7-alpine` added to docker-compose
- Env: `REDIS_URL=redis://localhost:6379`
- Game server: connect on startup, `redis.publish('tick:complete', JSON.stringify({ tick }))` after each tick
- Worker: connect on startup, `redis.subscribe('tick:complete')`
- Locks: `SET agent:lock:{replicantId} {workerId} NX EX 60`

### Worker Process

- Entry point: `src/worker/index.ts`
- Script: `npm run worker` → `tsx src/worker/index.ts`
- Docker: new service `agent-worker` in docker-compose, depends on `redis` and `homosideria`
- Imports only from `src/shared/` and `src/db/models/` (AgentConfig, AgentSession only)
- All game interactions via HTTP to `GAME_API_URL`

### New Environment Variables

```
REDIS_URL=redis://localhost:6379
AGENT_ENCRYPTION_KEY=<64-char hex string>
GAME_API_URL=http://localhost:3001
```

### File Structure

```
src/worker/
  index.ts              — entry point: connect Redis, MongoDB, start loop
  WorkerLoop.ts         — subscribes to tick events, schedules agents
  AgentRunner.ts        — builds context, runs agentic loop, tracks tokens
  GameClient.ts         — REST client wrapper (auth, endpoints, error handling)
  toolDefs.ts           — static tool definitions in OpenAI function format

src/shared/
  crypto.ts             — AES-256-GCM encrypt/decrypt

src/db/models/
  AgentConfig.ts        — Mongoose model
  AgentSession.ts       — Mongoose model

src/api/routes/
  tools.routes.ts       — POST /api/tools/:toolName, GET /api/tools

src/tools/
  registry.ts           — universal tool registry
  handlers/             — extracted tool handler functions (or keep in existing tool files)
```

---

## Web UI

### Agent List (`/agents`)

- Grid of cards, one per replicant with an AgentConfig
- Card shows: replicant name, model, status badge (green/amber/red/grey), last cycle tick, total tokens used
- "Configure Agent" button on unconfigured replicants

### Agent Config Page (`/agent/:replicantId`)

**Provider section:**
- Base URL (text input, default: openrouter)
- API key (password input, shows "configured" if set, never sends stored value back)
- Model (text input)

**Sampling section:**
- Temperature (0.0 - 2.0, default 0.7)
- Top P (0.0 - 1.0, default 1.0)
- Max output tokens (number, default 4096)

**Scheduling section:**
- Think every N ticks (1-100, default 5) with real-time translation ("every ~25s / ~4 game hours")
- Token budget per cycle (1000-200000, default 50000)

**System prompt section:**
- Textarea for custom override
- "Use default" checkbox
- Preview of default template

**Controls:**
- Start / Pause / Stop buttons
- Save config
- Status + last error display

**Cycle log:**
- Table of last 20 cycles: tick, tokens, tool calls, duration, error
- Expandable detail showing which tools were called

### Web Routes

```
GET  /agents                    — list page
GET  /agent/:replicantId        — config page
POST /agent/:replicantId/config — save config
POST /agent/:replicantId/start  — start agent
POST /agent/:replicantId/pause  — pause agent
POST /agent/:replicantId/stop   — stop agent
```

---

## Security & Limits

| Concern | Mitigation |
|---------|-----------|
| API key exposure | AES-256-GCM encrypted at rest, decrypted only in worker for LLM call duration, never sent to browser |
| Agent escalation | Worker authenticates as the replicant via REST — same permissions as external client |
| Duplicate execution | Redis locks with TTL per agent per cycle |
| Runaway costs | Token budget per cycle (hard max 200,000), configurable per agent |
| Cascading failures | 3 consecutive errors → auto-pause, manual restart required |
| Think interval abuse | Minimum 1 tick, maximum 100 ticks |

### Deployment Defaults

| Parameter | Default | Range |
|-----------|---------|-------|
| thinkEveryNTicks | 5 | 1 - 100 |
| tokenBudgetPerCycle | 50,000 | 1,000 - 200,000 |
| temperature | 0.7 | 0.0 - 2.0 |
| topP | 1.0 | 0.0 - 1.0 |
| maxTokens | 4096 | 256 - 32,768 |

---

## Future (v2)

- **Persistent conversation memory**: Rolling conversation history stored in MongoDB/Redis, carried across cycles. Context window management with summarization.
- **Subscription/billing**: Metered usage based on token consumption, tiered plans.
- **Tool subsets**: Let users enable/disable specific tools per agent (e.g., no combat tools for a peaceful trader).
- **Webhooks**: Notify external systems when agents complete cycles or encounter errors.
- **Standalone client extraction**: Extract `src/worker/` as an npm package / separate repo that anyone can run against any Homosideria server.
