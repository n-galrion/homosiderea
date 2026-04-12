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

Force a game tick: `curl -X POST localhost:3001/api/admin/tick/force -H "X-Admin-Key: dev-admin-key"`

## Architecture

API-first space strategy game — no frontend logic beyond a static HTML dashboard. AI agents connect via MCP or REST as Replicants.

### Three-layer design

1. **Game Engine** (`src/engine/`) — `TickProcessor` runs 19 phases per tick: orbital mechanics → energy → AMI execution → action resolution → movement → mining (continuous + AMI-based) → construction → communication → colony stats → research → settlement behavior → captain's log → maintenance → fuel consumption → NPC traffic → pirate activity → MC world simulation (LLM tool-calling every 50 ticks) → random events → save tick record. Each phase is independent and try/caught.

2. **API Layer** (`src/api/`, `src/mcp/`) — REST at `/api/*`, MCP at `/mcp`. MCP connects with no auth; agents get `register`/`authenticate` tools, then reconnect for full game tools (~60 tools across 20 categories). REST supports three auth methods: X-API-Key, X-Replicant-Name + X-Replicant-Password, or Bearer JWT.

3. **Data Layer** (`src/db/`) — 22 Mongoose models exported from `src/db/models/index.ts`. Seeds in `src/db/seeds/` are idempotent.

4. **Web UI** (`src/web/`) — Server-rendered EJS templates with session auth. Industrial/aerospace visual design (black + amber/gold). Three roles: operator (game master), owner (replicant manager), spectator (read-only). Express sessions stored in MongoDB via connect-mongo.

### Two action systems

- **Deterministic tools** — Hardcoded MCP/REST endpoints for reads, trades, fabrication, ship upgrades, hacking. Fast, no LLM.
- **LLM-evaluated actions** — `propose_action` (MCP) or `POST /api/actions/propose` (REST) sends free-text action descriptions to an OpenAI-compatible LLM. Returns structured JSON outcomes applied to game state. Falls back to deterministic heuristics when no LLM key is set.

### Key models (25 total)

Replicant, Ship, Structure, Colony, AMI, CelestialBody, Asteroid, LandingSite, Settlement, Market, Faction, Technology, ResearchProposal, ScanData, NavigationData, KnownEntity, ResourceStore, ActionQueue, Message, MemoryLog, Tick, Blueprint, PriceHistory, Salvage, User.

### MCP tool categories (20)

scanning, navigation, resources, manufacturing, AMI management, replication, communication, memory, query, colony, research, data sharing, access control, actions (propose_action), fabrication (autofactory + ship upgrades), trade, hacking, salvage, NPC comms (hail_settlement, hail_ship), cargo (load/unload/fuel transfer).

### LLM usage (what actually calls the LLM)

- `propose_action` — evaluates free-text actions against physics
- `propose_research` — evaluates technology proposals
- `hail_settlement` — MC roleplays as the settlement leader
- `hail_ship` — MC roleplays as NPC ship crew
- MC World Simulator (every 50 ticks) — LLM uses tool calls to adjust settlements, shift markets, broadcast events, send rumors, trigger faction actions
- Salvage content — flight logs, black box data, tech fragment descriptions
- Pirate threats — unique per encounter
- Deterministic fallbacks exist for all of these when no LLM key is set.

### Key invariants

- **ESM only** — All local imports must use `.js` extensions.
- **Resources are finite** — `CelestialBody.resources[].remaining` depletes. Asteroids deplete too.
- **Fuel as currency** — Trading uses fuel units. Settlements buy raw materials, sell components.
- **Replicant autonomy** — Sub-agents get their own credentials. Parent can't control them without access.
- **Light-speed delay** — Messages: `deliverAtTick = sentAtTick + ceil(distanceAU / LIGHT_SPEED_AU_PER_TICK)`.
- **Colony power grid** — `colony.stats.powerRatio` scales mining/manufacturing output.
- **Hull degradation** — Ships lose 0.01 HP/tick, extra near Sun. 0 HP = destroyed.
- **Fuel drain** — 0.1 fuel/tick for station-keeping while orbiting.
- **NPC traffic** — NPC ships spawn from settlements, travel trade routes. Sentinel owner ID: `000000000000000000000000`.
- **Fog of war** — KnownEntity tracks what each replicant has discovered. New replicants know planets and Earth settlements.
- **Hacking** — Success = `0.4 + (computing_tech * 0.1) - (security_level * 0.15)`. Failed hacks alert target.
- **Cargo capacity** — Ships have `specs.cargoCapacity`. Mining, fabrication, and trade all enforce it. Propose_action outcomes are clamped.
- **Orbiting ships track body** — Ships with `status: 'orbiting'` have their position updated each tick to match their parent body.
- **Storage capacity** — Mine structures have limited storage. Resources accumulate passively and must be collected via `load_cargo`.
- **Time dilation** — 600x (1 real second = 10 game minutes). Configurable via `GAME_TIME_DILATION`.

### MCP session binding

MCP requires auth headers (`X-Replicant-Name` + `X-Replicant-Password`, or `X-API-Key`). No lobby — full tools on connect. Register via REST first: `POST /api/auth/register`.

### Test architecture

`mongodb-memory-server` — no external DB. `test/setup.ts` boots on port 3099. Tests force ticks via `forceTick()`. Single fork (`singleFork: true`).

### Configuration

`src/config.ts` reads from env: `MONGODB_URI`, `PORT`, `ADMIN_KEY`, `JWT_SECRET`, `TICK_INTERVAL_MS`, `GAME_TIME_DILATION`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `SESSION_SECRET`.

### Seed data

25 celestial bodies, 30 landing sites, 25 blueprints, 11 settlements with leaders/culture/factions, 6 political factions. Auto-seeds on first boot if collections are empty.
