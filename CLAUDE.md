# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run test:server      # Start with in-memory MongoDB (no external DB needed)
npm run dev              # Dev mode with file watching (requires external MongoDB)
npm run build            # TypeScript compile to dist/
npm test                 # Run all tests (vitest, uses mongodb-memory-server)
npx vitest run test/integration.test.ts  # Run a specific test file
npm run seed             # Seed external MongoDB with game data
docker compose up --build  # Full stack: MongoDB + app in containers
```

Type-check without emitting: `npx tsc --noEmit`

Force a game tick (admin): `curl -X POST localhost:3001/api/admin/tick/force -H "X-Admin-Key: dev-admin-key"`

## Architecture

This is an API-first game server — there is no frontend logic beyond a static HTML dashboard. AI agents connect via MCP or REST.

### Three-layer design

1. **Game Engine** (`src/engine/`) — Pure game logic. `TickProcessor` runs 11 phases in strict order each tick: orbital mechanics → energy → AMI execution → action resolution → movement → mining → construction → communication → colony stats → research → tick record. `GameLoop` wraps this in a `setInterval`. Each phase is independent and try/caught so failures don't cascade.

2. **API Layer** (`src/api/`, `src/mcp/`) — Two interfaces to the same game state. REST routes at `/api/*` and MCP tools at `/mcp`. The MCP server creates a per-session `McpServer` instance bound to the authenticated replicant's context — tool handlers close over `replicantId`.

3. **Data Layer** (`src/db/`) — 20 Mongoose models, all exported from `src/db/models/index.ts`. Seeds in `src/db/seeds/` are idempotent (clear + reinsert).

### Two action systems

- **Deterministic tools** — Hardcoded MCP tools for reads/queries (scan, inventory, position, messages). Fast, no LLM.
- **MC-evaluated actions** — `propose_action` MCP tool sends free-text action descriptions to an OpenAI-compatible LLM (configured via `LLM_BASE_URL`). The LLM returns structured JSON outcomes (resource deltas, entity creation, population changes) that `ActionEvaluator.applyOutcomes()` writes to the DB. Falls back to deterministic heuristics when no LLM key is set.

### Key invariants

- **ESM only** — All local imports must use `.js` extensions (`import { Foo } from './foo.js'`).
- **Resources are finite** — `CelestialBody.resources[].remaining` decreases on mining. When 0, `accessible` flips false.
- **Replicant autonomy** — Sub-agents spawned via `replicate` get their own API key and cannot be controlled by the parent. Access requires explicit authorization or physical proximity.
- **Light-speed delay** — Messages have `deliverAtTick = sentAtTick + ceil(distanceAU / LIGHT_SPEED_AU_PER_TICK)`. They're invisible to the recipient until delivered.
- **Colony power grid** — `colony.stats.powerRatio` (production/consumption) scales mining and manufacturing output. Below 1.0, everything runs slower.

### MCP session binding

Each MCP connection authenticates via `X-API-Key` header. On initialize, a new `McpServer` + `StreamableHTTPServerTransport` pair is created with all tools bound to that replicant's ID via closures. This means tool handlers can safely use `replicantId` without per-call auth.

### Test architecture

Tests use `mongodb-memory-server` — no external MongoDB needed. `test/setup.ts` exports `setupTestServer()` which boots in-memory Mongo, seeds all data, starts Express on port 3099. Tests force ticks manually via the exported `forceTick()` function rather than using the game loop timer. All tests run in a single fork (`singleFork: true` in vitest config) because they share one DB.

## Configuration

All config is in `src/config.ts`, read from env vars. Key vars: `MONGODB_URI`, `PORT`, `ADMIN_KEY`, `JWT_SECRET`, `TICK_INTERVAL_MS`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`.
