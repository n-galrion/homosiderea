# Operator ↔ Master Controller Console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the operator converse with the Master Controller in a `/admin/mc` console; the MC proposes world-event actions which the operator approves before they apply.

**Architecture:** Split the MC's "decide" from "execute". A shared `mc/tools.ts` holds the tool defs + `executeMCTool`. `mc/propose.ts` runs the LLM and returns proposed actions without executing. `mcChat.ts` persists a global conversation and applies approved actions. New REST + web routes (in their own files) expose it; the scheduled world-sim is refactored to use the same tool module unchanged.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Mongoose, OpenAI SDK (OpenAI-compatible), Express, EJS, vitest + mongodb-memory-server.

## Global Constraints

- **ESM only** — all local imports use `.js` extensions.
- Type-check: `npx tsc --noEmit` (a pre-existing `src/worker/WorkerLoop.ts` ioredis error is unrelated; ignore it).
- Run a test file: `npx vitest run test/<file>.test.ts`. Full suite needs `ADMIN_KEY=dev-admin-key` (a real `.env` `ADMIN_KEY` otherwise overrides the test default and 6 admin tests 401).
- Tests must be deterministic and must NOT call a real LLM. The local `.env` sets `LLM_API_KEY`, so any test of the propose/chat path forces `config.llm.apiKey = ''` (offline) and restores it after.
- Pirate sentinel owner id: `000000000000000000000001`. MC must stay operator-only (admin-key for API, session role `operator` for pages).
- New routes live in NEW files (`mc.routes.ts`, `mc.pages.routes.ts`); do not edit the operator's WIP files `src/api/routes/admin.routes.ts` or `src/web/routes/admin.pages.routes.ts`. Mount the new routes in `src/api/server.ts` (not WIP) and add the nav link in `src/web/views/partials/nav.ejs` (not WIP).

---

### Task 1: Extract the MC tool module

Move the existing MC tool defs + handlers out of `MCWorldSimulator.ts` into a shared module, with a single `executeMCTool` dispatcher. The world-sim keeps working, now importing from the module.

**Files:**
- Create: `src/engine/systems/mc/tools.ts`
- Modify: `src/engine/systems/MCWorldSimulator.ts` (import from the module; drop the moved code)
- Test: `test/mc-tools.test.ts`

**Interfaces:**
- Produces: `export const MC_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[]`
- Produces: `export async function executeMCTool(name: string, args: Record<string, unknown>, tick: number): Promise<string>`
- Produces: `export const MC_WORLD_SIM_SYSTEM: string` (the existing world-sim system prompt)

- [ ] **Step 1: Write the failing test**

Create `test/mc-tools.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant } from './setup.js';
import { Message } from '../src/db/models/index.js';
import { executeMCTool } from '../src/engine/systems/mc/tools.js';

describe('executeMCTool — existing tools', () => {
  beforeAll(async () => { await setupTestServer(); await registerReplicant('MCToolTester'); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('broadcast_event sends a world_event message to every active replicant', async () => {
    const before = await Message.countDocuments({ 'metadata.type': 'world_event' });
    const out = await executeMCTool('broadcast_event', { title: 'Solar Flare', description: 'A flare disrupts comms.' }, 100);
    expect(out).toContain('Solar Flare');
    const after = await Message.countDocuments({ 'metadata.type': 'world_event' });
    expect(after).toBeGreaterThan(before);
  });

  it('returns a message for an unknown tool', async () => {
    const out = await executeMCTool('does_not_exist', {}, 100);
    expect(out.toLowerCase()).toContain('unknown');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/mc-tools.test.ts`
Expected: FAIL — `src/engine/systems/mc/tools.js` does not exist.

- [ ] **Step 3: Create `src/engine/systems/mc/tools.ts`**

Move the following from `MCWorldSimulator.ts` verbatim into this new file: the `WORLD_SIM_SYSTEM` string (rename the export to `MC_WORLD_SIM_SYSTEM`), the `MC_TOOLS` array, and the five `exec*` handler functions (`execAdjustSettlement`, `execShiftMarket`, `execBroadcast`, `execRumor`, `execFactionAction`). Then add the dispatcher. The file:

```typescript
import OpenAI from 'openai';
import { Settlement, Market, Replicant, Message, Faction } from '../../../db/models/index.js';

export const MC_WORLD_SIM_SYSTEM = `You are the Master Controller of Homosideria, a hard sci-fi space strategy game set in the Sol system. Every ~50 game ticks, you review the state of human civilization and generate dynamic events.

You have tools to modify the world. Use them to:
- Adjust settlement attitudes based on replicant behavior and political events
- Shift market prices based on supply/demand and political decisions
- Change settlement status (thriving/stable/struggling/damaged)
- Broadcast events to all replicants
- Send rumors to individual replicants
- Adjust faction attitudes

Rules:
- Be specific: name real settlements, reference actual resources, cite real physics
- Create events that provide opportunities AND threats for replicants
- Settlements with mercantile temperament react to trade, scientific ones to research, military ones to threats
- Consider what replicants have been doing (trading? mining? hostile?) when making decisions
- Generate 1-4 actions per simulation cycle
- Write vivid, hard sci-fi narrative descriptions`;

export const MC_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  /* ... the five existing tool defs, copied verbatim from MCWorldSimulator.ts (adjust_settlement,
     shift_market_prices, broadcast_event, send_rumor, faction_action) ... */
];

// ── Handlers (moved verbatim from MCWorldSimulator.ts) ──
async function execAdjustSettlement(args: Record<string, unknown>, tick: number): Promise<string> { /* verbatim */ }
async function execShiftMarket(args: Record<string, unknown>, tick: number): Promise<string> { /* verbatim */ }
async function execBroadcast(args: Record<string, unknown>, tick: number): Promise<string> { /* verbatim */ }
async function execRumor(args: Record<string, unknown>, tick: number): Promise<string> { /* verbatim */ }
async function execFactionAction(args: Record<string, unknown>, tick: number): Promise<string> { /* verbatim */ }

const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>, tick: number) => Promise<string>> = {
  adjust_settlement: execAdjustSettlement,
  shift_market_prices: execShiftMarket,
  broadcast_event: execBroadcast,
  send_rumor: execRumor,
  faction_action: execFactionAction,
};

/** Execute a single MC tool by name. Returns a human-readable result string. */
export async function executeMCTool(name: string, args: Record<string, unknown>, tick: number): Promise<string> {
  const handler = TOOL_HANDLERS[name];
  if (!handler) return `Unknown tool: ${name}`;
  return handler(args, tick);
}
```

> NOTE TO IMPLEMENTER: copy the five tool defs and five handler bodies EXACTLY from the current `MCWorldSimulator.ts` (lines ~26-222). Do not rewrite their logic.

- [ ] **Step 4: Refactor `MCWorldSimulator.ts` to use the module**

In `src/engine/systems/MCWorldSimulator.ts`: delete the moved `WORLD_SIM_SYSTEM`, `MC_TOOLS`, the five `exec*` functions, and the local `TOOL_HANDLERS` map. Add the import:

```typescript
import { MC_TOOLS, MC_WORLD_SIM_SYSTEM, executeMCTool } from './mc/tools.js';
```

Replace the system-prompt reference (`content: WORLD_SIM_SYSTEM`) with `MC_WORLD_SIM_SYSTEM`, and replace the inline handler lookup/execute in the tool loop:

```typescript
        const handler = TOOL_HANDLERS[fn.name];
        let result = 'Unknown tool.';
        if (handler) {
          try {
            const args = JSON.parse(fn.arguments);
            result = await handler(args, tick);
            logs.push(result);
          } catch (err) {
            result = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
```

with:

```typescript
        let result = 'Unknown tool.';
        try {
          const args = JSON.parse(fn.arguments);
          result = await executeMCTool(fn.name, args, tick);
          logs.push(result);
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
```

Keep everything else (the LLM loop, `buildWorldSummary`, `simulateWorldWithMC`) unchanged. Remove now-unused imports from `MCWorldSimulator.ts` (the models only used by the moved handlers — keep any still used by `buildWorldSummary`: `Settlement, Faction, Replicant, Ship, Colony`).

- [ ] **Step 5: Run tests + type-check**

Run: `npx vitest run test/mc-tools.test.ts` → PASS (2). Then `npx tsc --noEmit` → no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/engine/systems/mc/tools.ts src/engine/systems/MCWorldSimulator.ts test/mc-tools.test.ts
git commit -m "refactor: extract MC tool defs + executeMCTool into mc/tools module"
```

---

### Task 2: New MC event tools

Add three operator-usable event tools to the shared module.

**Files:**
- Modify: `src/engine/systems/mc/tools.ts`
- Test: `test/mc-tools.test.ts` (extend)

**Interfaces:**
- Consumes: `executeMCTool` (Task 1).
- Produces: tool names `spawn_pirates`, `trigger_disaster`, `spawn_salvage` registered in `MC_TOOLS` and `TOOL_HANDLERS`.

- [ ] **Step 1: Write the failing tests**

Append to `test/mc-tools.test.ts`:

```typescript
import { Ship, Settlement, Salvage, CelestialBody } from '../src/db/models/index.js';

describe('executeMCTool — new event tools', () => {
  beforeAll(async () => { await setupTestServer(); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('spawn_pirates creates pirate-owned warships', async () => {
    const before = await Ship.countDocuments({ ownerId: '000000000000000000000001' });
    const out = await executeMCTool('spawn_pirates', { nearBodyName: 'Mars', count: 2, threatLevel: 'high', narrative: 'Raiders close on Mars.' }, 100);
    expect(out).toContain('2');
    const after = await Ship.countDocuments({ ownerId: '000000000000000000000001' });
    expect(after - before).toBe(2);
  });

  it('trigger_disaster damages the settlement and broadcasts', async () => {
    const out = await executeMCTool('trigger_disaster', { settlementName: 'Shanghai', severity: 'major', narrative: 'A reactor breach rocks the district.' }, 100);
    expect(out).toContain('Shanghai');
    const s = await Settlement.findOne({ name: 'Shanghai' });
    expect(s!.status).toBe('damaged');
    const broadcasts = await Message.countDocuments({ 'metadata.type': 'world_event' });
    expect(broadcasts).toBeGreaterThan(0);
  });

  it('spawn_salvage creates salvage near a body', async () => {
    const before = await Salvage.countDocuments();
    const out = await executeMCTool('spawn_salvage', { nearBodyName: 'Mars', richness: 'rich', narrative: 'A derelict hauler drifts.' }, 100);
    expect(out.toLowerCase()).toContain('salvage');
    expect(await Salvage.countDocuments()).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/mc-tools.test.ts`
Expected: FAIL — the three new tools return "Unknown tool".

- [ ] **Step 3: Add the tool defs**

In `src/engine/systems/mc/tools.ts`, add these three entries to the `MC_TOOLS` array:

```typescript
  {
    type: 'function',
    function: {
      name: 'spawn_pirates',
      description: 'Spawn pirate warships near a settlement or celestial body to threaten replicants.',
      parameters: {
        type: 'object',
        properties: {
          nearSettlementName: { type: 'string', description: 'Spawn near this settlement\'s body (optional)' },
          nearBodyName: { type: 'string', description: 'Spawn near this celestial body (optional)' },
          count: { type: 'number', description: 'How many pirate ships (1-5)' },
          threatLevel: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Combat strength' },
          narrative: { type: 'string', description: 'Hard sci-fi description of the threat' },
        },
        required: ['count', 'narrative'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trigger_disaster',
      description: 'Strike a settlement with a disaster: damages status and population, and broadcasts the event.',
      parameters: {
        type: 'object',
        properties: {
          settlementName: { type: 'string' },
          severity: { type: 'string', enum: ['minor', 'major', 'catastrophic'] },
          narrative: { type: 'string', description: 'Hard sci-fi description of the disaster' },
        },
        required: ['settlementName', 'severity', 'narrative'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawn_salvage',
      description: 'Create a salvage field (derelict wreckage) near a celestial body for replicants to find.',
      parameters: {
        type: 'object',
        properties: {
          nearBodyName: { type: 'string' },
          richness: { type: 'string', enum: ['poor', 'moderate', 'rich'] },
          narrative: { type: 'string' },
        },
        required: ['nearBodyName', 'narrative'],
      },
    },
  },
```

- [ ] **Step 4: Add the handlers**

In `src/engine/systems/mc/tools.ts`, add imports for `Ship`, `Salvage`, `CelestialBody`:

```typescript
import { Settlement, Market, Replicant, Message, Faction, Ship, Salvage, CelestialBody } from '../../../db/models/index.js';
```

Add a position resolver and the three handlers:

```typescript
const PIRATE_OWNER_ID = '000000000000000000000001';

/** Resolve a spawn position from a settlement's body or a named body; falls back to the belt. */
async function resolveTargetPosition(args: Record<string, unknown>): Promise<{ x: number; y: number; z: number }> {
  if (typeof args.nearSettlementName === 'string') {
    const s = await Settlement.findOne({ name: new RegExp(`^${args.nearSettlementName}$`, 'i') });
    if (s) {
      const body = await CelestialBody.findById(s.bodyId).lean();
      if (body?.position) return { ...body.position };
    }
  }
  if (typeof args.nearBodyName === 'string') {
    const body = await CelestialBody.findOne({ name: new RegExp(`^${args.nearBodyName}$`, 'i') }).lean();
    if (body?.position) return { ...body.position };
  }
  return { x: 2.5, y: 0, z: 0 }; // asteroid belt fallback
}

async function execSpawnPirates(args: Record<string, unknown>, tick: number): Promise<string> {
  const count = Math.max(1, Math.min(5, Number(args.count) || 1));
  const threat = (args.threatLevel as string) || 'medium';
  const power = threat === 'high' ? 8 : threat === 'low' ? 3 : 5;
  const base = await resolveTargetPosition(args);
  for (let i = 0; i < count; i++) {
    await Ship.create({
      name: `Marauder-${Math.floor(1000 + Math.random() * 9000)}`,
      ownerId: PIRATE_OWNER_ID,
      type: 'warship',
      status: 'orbiting',
      position: { x: base.x + (Math.random() - 0.5) * 0.2, y: base.y + (Math.random() - 0.5) * 0.2, z: base.z + (Math.random() - 0.5) * 0.05 },
      orbitingBodyId: null,
      specs: {
        hullPoints: 80 + Math.floor(Math.random() * 120), maxHullPoints: 200,
        maxSpeed: 0.003 + Math.random() * 0.002, cargoCapacity: 200, fuelCapacity: 150,
        sensorRange: 0.8, miningRate: 0, combatPower: power + Math.floor(Math.random() * 3), manufacturingRate: 0,
      },
      fuel: 150,
      createdAtTick: tick,
    });
  }
  return `Spawned ${count} pirate ship(s) (${threat} threat): ${args.narrative}`;
}

async function execTriggerDisaster(args: Record<string, unknown>, tick: number): Promise<string> {
  const settlement = await Settlement.findOne({ name: new RegExp(`^${args.settlementName}$`, 'i') });
  if (!settlement) return `Settlement "${args.settlementName}" not found.`;
  const severity = (args.severity as string) || 'minor';
  const popFraction = severity === 'catastrophic' ? 0.3 : severity === 'major' ? 0.12 : 0.03;
  settlement.population = Math.max(0, Math.round(settlement.population * (1 - popFraction)));
  if (severity !== 'minor') settlement.status = 'damaged';
  await settlement.save();
  // Broadcast to all active replicants.
  const replicants = await Replicant.find({ status: 'active' });
  for (const r of replicants) {
    await Message.create({
      senderId: r._id, recipientId: r._id,
      subject: `Disaster at ${settlement.name}`,
      body: args.narrative as string,
      metadata: { type: 'world_event', source: 'mc_operator', severity },
      senderPosition: { x: 0, y: 0, z: 0 }, recipientPosition: { x: 0, y: 0, z: 0 },
      distanceAU: 0, sentAtTick: tick, deliverAtTick: tick, delivered: true,
    });
  }
  return `${settlement.name} struck by ${severity} disaster: ${args.narrative}`;
}

async function execSpawnSalvage(args: Record<string, unknown>, tick: number): Promise<string> {
  const base = await resolveTargetPosition(args);
  const richness = (args.richness as string) || 'moderate';
  const mult = richness === 'rich' ? 3 : richness === 'poor' ? 1 : 2;
  await Salvage.create({
    name: `Derelict near ${args.nearBodyName ?? 'deep space'}`,
    type: 'wreckage',
    position: { x: base.x + (Math.random() - 0.5) * 0.1, y: base.y + (Math.random() - 0.5) * 0.1, z: base.z },
    sourceShipName: 'Unknown Derelict',
    sourceOwnerType: 'unknown',
    resources: { metals: 10 * mult, alloys: 5 * mult, electronics: 2 * mult },
    createdAtTick: tick,
    expiresAtTick: tick + 500,
  });
  return `Spawned salvage (${richness}) near ${args.nearBodyName}: ${args.narrative}`;
}
```

Register them in `TOOL_HANDLERS`:

```typescript
  spawn_pirates: execSpawnPirates,
  trigger_disaster: execTriggerDisaster,
  spawn_salvage: execSpawnSalvage,
```

- [ ] **Step 5: Run tests + type-check**

Run: `npx vitest run test/mc-tools.test.ts` → PASS (5). `npx tsc --noEmit` → no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/engine/systems/mc/tools.ts test/mc-tools.test.ts
git commit -m "feat: add spawn_pirates, trigger_disaster, spawn_salvage MC tools"
```

---

### Task 3: MCConversation model

**Files:**
- Create: `src/db/models/MCConversation.ts`
- Modify: `src/db/models/index.ts` (export it)
- Test: `test/mc-chat.test.ts` (created here, extended later)

**Interfaces:**
- Produces: `MCConversation` model with `messages: IMCMessage[]`.
- Produces types `IMCMessage`, `IMCProposedAction`.

- [ ] **Step 1: Write the failing test**

Create `test/mc-chat.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer } from './setup.js';
import { MCConversation } from '../src/db/models/index.js';

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/mc-chat.test.ts`
Expected: FAIL — `MCConversation` is not exported.

- [ ] **Step 3: Create the model**

Create `src/db/models/MCConversation.ts`:

```typescript
import { Schema, model, type Document, type Types } from 'mongoose';

export interface IMCProposedAction {
  tool: string;
  args: Record<string, unknown>;
  status: 'pending' | 'applied' | 'discarded';
  result: string | null;
}

export interface IMCMessage {
  role: 'operator' | 'mc';
  content: string;
  tick: number;
  at: Date;
  proposedActions?: IMCProposedAction[];
}

export interface IMCConversation extends Document {
  _id: Types.ObjectId;
  messages: IMCMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const ProposedActionSchema = new Schema<IMCProposedAction>({
  tool: { type: String, required: true },
  args: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['pending', 'applied', 'discarded'], default: 'pending' },
  result: { type: String, default: null },
}, { _id: true });

const MCMessageSchema = new Schema<IMCMessage>({
  role: { type: String, enum: ['operator', 'mc'], required: true },
  content: { type: String, default: '' },
  tick: { type: Number, default: 0 },
  at: { type: Date, default: Date.now },
  proposedActions: { type: [ProposedActionSchema], default: undefined },
}, { _id: true });

const MCConversationSchema = new Schema<IMCConversation>({
  messages: { type: [MCMessageSchema], default: [] },
}, { timestamps: true });

export const MCConversation = model<IMCConversation>('MCConversation', MCConversationSchema);
```

- [ ] **Step 4: Export from the model index**

In `src/db/models/index.ts`, add an export line alongside the others:

```typescript
export { MCConversation } from './MCConversation.js';
export type { IMCConversation, IMCMessage, IMCProposedAction } from './MCConversation.js';
```

(Match the existing export style in that file — if it re-exports types differently, follow that pattern.)

- [ ] **Step 5: Run test + type-check**

Run: `npx vitest run test/mc-chat.test.ts` → PASS (1). `npx tsc --noEmit` → no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/db/models/MCConversation.ts src/db/models/index.ts test/mc-chat.test.ts
git commit -m "feat: add MCConversation model for operator-MC chat"
```

---

### Task 4: Propose module (LLM, no execution)

**Files:**
- Create: `src/engine/systems/mc/propose.ts`
- Test: `test/mc-chat.test.ts` (extend)

**Interfaces:**
- Consumes: `MC_TOOLS` (Task 1), `config`.
- Produces: `export interface ProposedAction { tool: string; args: Record<string, unknown> }`
- Produces: `export async function proposeMCActions(history: Array<{ role: 'operator' | 'mc'; content: string }>): Promise<{ reply: string; proposedActions: ProposedAction[] }>`

- [ ] **Step 1: Write the failing test**

Append to `test/mc-chat.test.ts`:

```typescript
import { proposeMCActions } from '../src/engine/systems/mc/propose.js';
import { config } from '../src/config.js';

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/mc-chat.test.ts`
Expected: FAIL — `propose.js` does not exist.

- [ ] **Step 3: Create `src/engine/systems/mc/propose.ts`**

```typescript
import OpenAI from 'openai';
import { MC_TOOLS } from './tools.js';
import { config } from '../../../config.js';

export interface ProposedAction { tool: string; args: Record<string, unknown> }

const MC_OPERATOR_SYSTEM = `You are the Master Controller of Homosideria, a hard sci-fi space strategy game set in the Sol system. You are speaking directly with the game's operator (the game master).

Converse in character as the Master Controller. When the operator wants something to happen in the world, call the appropriate tools to PROPOSE those actions — the operator will review and approve them before they take effect, so propose freely. You may also just talk.

Rules:
- Be specific: name real settlements, reference actual resources, cite real physics
- Prefer concrete, dispatchable actions over vague description
- Write vivid, hard sci-fi narrative in your replies and tool narratives`;

/**
 * Run the MC LLM over the conversation and return its reply plus any PROPOSED
 * tool actions (not executed). Offline (no actions) when no LLM key is set.
 */
export async function proposeMCActions(
  history: Array<{ role: 'operator' | 'mc'; content: string }>,
): Promise<{ reply: string; proposedActions: ProposedAction[] }> {
  if (!config.llm.apiKey) {
    return { reply: 'MC offline — no LLM configured.', proposedActions: [] };
  }

  try {
    const client = new OpenAI({ baseURL: config.llm.baseUrl, apiKey: config.llm.apiKey });
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: MC_OPERATOR_SYSTEM },
      ...history.map((m) => ({ role: m.role === 'operator' ? 'user' as const : 'assistant' as const, content: m.content })),
    ];

    const response = await client.chat.completions.create({
      model: config.llm.models.worldSim,
      max_tokens: 1024,
      temperature: 0.8,
      messages,
      tools: MC_TOOLS,
    });

    const choice = response.choices[0];
    const reply = choice?.message?.content?.trim() || '(no reply)';
    const proposedActions: ProposedAction[] = [];
    for (const tc of choice?.message?.tool_calls || []) {
      if (tc.type !== 'function') continue;
      try {
        proposedActions.push({ tool: tc.function.name, args: JSON.parse(tc.function.arguments) });
      } catch { /* skip unparseable tool call */ }
    }
    return { reply, proposedActions };
  } catch (err) {
    return { reply: `MC error: ${err instanceof Error ? err.message : String(err)}`, proposedActions: [] };
  }
}
```

- [ ] **Step 4: Run test + type-check**

Run: `npx vitest run test/mc-chat.test.ts` → PASS (2). `npx tsc --noEmit` → no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/engine/systems/mc/propose.ts test/mc-chat.test.ts
git commit -m "feat: add proposeMCActions (LLM proposes MC actions without executing)"
```

---

### Task 5: Conversation service

**Files:**
- Create: `src/services/mcChat.ts`
- Test: `test/mc-chat.test.ts` (extend)

**Interfaces:**
- Consumes: `MCConversation` (Task 3), `proposeMCActions` (Task 4), `executeMCTool` (Task 1), `Tick`.
- Produces:
  - `export async function getConversation(): Promise<IMCConversation>`
  - `export async function sendOperatorMessage(text: string): Promise<IMCConversation>`
  - `export async function applyProposed(messageId: string): Promise<{ results: string[] }>`
  - `export async function discardProposed(messageId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `test/mc-chat.test.ts`:

```typescript
import { getConversation, sendOperatorMessage, applyProposed, discardProposed } from '../src/services/mcChat.js';
import { MCConversation, Ship } from '../src/db/models/index.js';

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/mc-chat.test.ts`
Expected: FAIL — `src/services/mcChat.js` does not exist.

- [ ] **Step 3: Create `src/services/mcChat.ts`**

```typescript
import { MCConversation, Tick, type IMCConversation } from '../db/models/index.js';
import { proposeMCActions } from '../engine/systems/mc/propose.js';
import { executeMCTool } from '../engine/systems/mc/tools.js';

const MAX_MESSAGES = 100;

async function currentTick(): Promise<number> {
  const t = await Tick.findOne().sort({ tickNumber: -1 }).lean();
  return (t as { tickNumber?: number } | null)?.tickNumber ?? 0;
}

/** Get (or lazily create) the single global MC conversation. */
export async function getConversation(): Promise<IMCConversation> {
  let convo = await MCConversation.findOne().sort({ createdAt: 1 });
  if (!convo) convo = await MCConversation.create({ messages: [] });
  return convo;
}

/** Append the operator's message, run the MC, append its reply + pending actions. */
export async function sendOperatorMessage(text: string): Promise<IMCConversation> {
  const convo = await getConversation();
  const tick = await currentTick();

  convo.messages.push({ role: 'operator', content: text, tick, at: new Date() } as never);

  const history = convo.messages.map((m) => ({ role: m.role, content: m.content }));
  const { reply, proposedActions } = await proposeMCActions(history);

  convo.messages.push({
    role: 'mc', content: reply, tick, at: new Date(),
    proposedActions: proposedActions.map((a) => ({ tool: a.tool, args: a.args, status: 'pending', result: null })),
  } as never);

  if (convo.messages.length > MAX_MESSAGES) {
    convo.messages = convo.messages.slice(-MAX_MESSAGES) as never;
  }
  await convo.save();
  return convo;
}

/** Execute all PENDING actions on the given MC message. Returns each result string. */
export async function applyProposed(messageId: string): Promise<{ results: string[] }> {
  const convo = await getConversation();
  const tick = await currentTick();
  const msg = convo.messages.find((m) => (m as unknown as { _id?: { toString(): string } })._id?.toString() === messageId);
  if (!msg || !msg.proposedActions) return { results: [] };

  const results: string[] = [];
  for (const action of msg.proposedActions) {
    if (action.status !== 'pending') continue;
    try {
      const result = await executeMCTool(action.tool, action.args, tick);
      action.status = 'applied';
      action.result = result;
      results.push(result);
    } catch (err) {
      action.status = 'applied';
      action.result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      results.push(action.result);
    }
  }
  convo.markModified('messages');
  await convo.save();
  return { results };
}

/** Mark all pending actions on the given MC message as discarded. */
export async function discardProposed(messageId: string): Promise<void> {
  const convo = await getConversation();
  const msg = convo.messages.find((m) => (m as unknown as { _id?: { toString(): string } })._id?.toString() === messageId);
  if (!msg || !msg.proposedActions) return;
  for (const action of msg.proposedActions) {
    if (action.status === 'pending') action.status = 'discarded';
  }
  convo.markModified('messages');
  await convo.save();
}
```

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run test/mc-chat.test.ts` → PASS (all). `npx tsc --noEmit` → no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/mcChat.ts test/mc-chat.test.ts
git commit -m "feat: add mcChat conversation service (send/apply/discard)"
```

---

### Task 6: REST endpoints

**Files:**
- Create: `src/api/routes/mc.routes.ts`
- Modify: `src/api/server.ts` (mount the router)
- Test: `test/mc-api.test.ts`

**Interfaces:**
- Consumes: `mcChat` service (Task 5).
- Produces: `export const mcRoutes: Router` mounted at `/api/admin/mc`.

- [ ] **Step 1: Write the failing test**

Create `test/mc-api.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, api, ADMIN_KEY } from './setup.js';
import { config } from '../src/config.js';

describe('MC operator API', () => {
  beforeAll(async () => { await setupTestServer(); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('rejects without admin key', async () => {
    const { status } = await api('/api/admin/mc/conversation');
    expect(status).toBe(401);
  });

  it('chat returns an MC reply (offline) and conversation lists it', async () => {
    const saved = config.llm.apiKey;
    config.llm.apiKey = '';
    try {
      const chat = await api('/api/admin/mc/chat', { method: 'POST', adminKey: ADMIN_KEY, body: { message: 'hello MC' } });
      expect(chat.status).toBe(200);
      const convo = await api('/api/admin/mc/conversation', { adminKey: ADMIN_KEY });
      const d = convo.data as { messages: Array<{ role: string; content: string }> };
      expect(d.messages.some((m) => m.role === 'mc')).toBe(true);
    } finally { config.llm.apiKey = saved; }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `ADMIN_KEY=dev-admin-key npx vitest run test/mc-api.test.ts`
Expected: FAIL — route not found (404, not 401/200).

- [ ] **Step 3: Create `src/api/routes/mc.routes.ts`**

```typescript
import { Router, type Request, type Response, type NextFunction } from 'express';
import { getConversation, sendOperatorMessage, applyProposed, discardProposed } from '../../services/mcChat.js';

export const mcRoutes = Router();

mcRoutes.get('/conversation', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const convo = await getConversation();
    res.json({ messages: convo.messages });
  } catch (err) { next(err); }
});

mcRoutes.post('/chat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'VALIDATION', message: 'message string is required' });
      return;
    }
    const convo = await sendOperatorMessage(message);
    res.json({ messages: convo.messages });
  } catch (err) { next(err); }
});

mcRoutes.post('/apply', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { messageId } = req.body;
    if (!messageId) { res.status(400).json({ error: 'VALIDATION', message: 'messageId is required' }); return; }
    const out = await applyProposed(messageId);
    res.json(out);
  } catch (err) { next(err); }
});

mcRoutes.post('/discard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { messageId } = req.body;
    if (!messageId) { res.status(400).json({ error: 'VALIDATION', message: 'messageId is required' }); return; }
    await discardProposed(messageId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
```

- [ ] **Step 4: Mount the router**

In `src/api/server.ts`: add the import near the other route imports:

```typescript
import { mcRoutes } from './routes/mc.routes.js';
```

Mount it **before** the `app.use('/api/admin', adminAuth, adminRoutes);` line (so the more-specific path matches first), reusing the same `adminAuth` middleware:

```typescript
  app.use('/api/admin/mc', adminAuth, mcRoutes);
  app.use('/api/admin', adminAuth, adminRoutes);
```

- [ ] **Step 5: Run tests + type-check**

Run: `ADMIN_KEY=dev-admin-key npx vitest run test/mc-api.test.ts` → PASS (2). `npx tsc --noEmit` → no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/api/routes/mc.routes.ts src/api/server.ts test/mc-api.test.ts
git commit -m "feat: add /api/admin/mc REST endpoints (conversation/chat/apply/discard)"
```

---

### Task 7: Web console page

**Files:**
- Create: `src/web/routes/mc.pages.routes.ts`
- Create: `src/web/views/admin/mc.ejs`
- Modify: `src/api/server.ts` (mount the page router)
- Modify: `src/web/views/partials/nav.ejs` (add nav link)
- Test: `test/mc-api.test.ts` (extend with a page-auth check)

**Interfaces:**
- Consumes: `mcChat` service (Task 5), `requireAuth`/`requireRole` middleware (see `admin.pages.routes.ts` for import paths).
- Produces: `export const mcPagesRoutes: Router` serving `/admin/mc` + form POSTs.

- [ ] **Step 1: Write the failing test**

Append to `test/mc-api.test.ts`:

```typescript
describe('MC console page', () => {
  it('GET /admin/mc requires auth (no session → not 200)', async () => {
    const { status } = await api('/admin/mc');
    expect(status).not.toBe(200); // redirect to login or 403
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `ADMIN_KEY=dev-admin-key npx vitest run test/mc-api.test.ts`
Expected: FAIL — `/admin/mc` returns 404 (route not mounted), not a redirect/403.

- [ ] **Step 3: Create the page router `src/web/routes/mc.pages.routes.ts`**

Match the auth-middleware import used in `src/web/routes/admin.pages.routes.ts` (open it to copy the exact `requireAuth`/`requireRole` import path).

```typescript
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth, requireRole } from '../middleware/roles.js';
import { getConversation, sendOperatorMessage, applyProposed, discardProposed } from '../../services/mcChat.js';

export const mcPagesRoutes = Router();

mcPagesRoutes.get('/admin/mc', requireAuth, requireRole('operator'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const convo = await getConversation();
    res.render('admin/mc', {
      title: 'Master Controller',
      user: res.locals.user,
      currentPath: '/admin/mc',
      messages: convo.messages,
    });
  } catch (err) { next(err); }
});

mcPagesRoutes.post('/admin/mc/chat', requireAuth, requireRole('operator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.body.message) await sendOperatorMessage(String(req.body.message));
    res.redirect('/admin/mc');
  } catch (err) { next(err); }
});

mcPagesRoutes.post('/admin/mc/apply', requireAuth, requireRole('operator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.body.messageId) await applyProposed(String(req.body.messageId));
    res.redirect('/admin/mc');
  } catch (err) { next(err); }
});

mcPagesRoutes.post('/admin/mc/discard', requireAuth, requireRole('operator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.body.messageId) await discardProposed(String(req.body.messageId));
    res.redirect('/admin/mc');
  } catch (err) { next(err); }
});
```

> IMPLEMENTER: confirm the middleware import path. In `admin.pages.routes.ts` it is `import { requireAuth, requireRole } from '../middleware/roles.js';` — use whatever that file actually uses.

- [ ] **Step 4: Create the view `src/web/views/admin/mc.ejs`**

Follow the structure of `src/web/views/admin/events.ejs` (same `<%- include('../partials/...') %>` header/nav/flash usage — open it to copy the wrapper). The body:

```html
<%- include('../partials/header') %>
<%- include('../partials/nav') %>
<main class="content">
  <h1 class="page-title">Master Controller</h1>
  <p class="text-dim">Converse with the MC. It proposes world events; you approve them before they happen.</p>

  <div class="mc-transcript">
    <% for (const msg of messages) { %>
      <div class="msg <%= msg.role === 'operator' ? 'msg-out' : 'msg-in' %>">
        <div class="msg-meta"><span><%= msg.role === 'operator' ? 'You' : 'Master Controller' %></span><span>Tick <%= msg.tick %></span></div>
        <div class="msg-body"><%= msg.content %></div>
        <% if (msg.proposedActions && msg.proposedActions.length) { %>
          <div class="mc-actions">
            <% for (const a of msg.proposedActions) { %>
              <div class="mc-action mc-action-<%= a.status %>">
                <code><%= a.tool %></code> — <%= JSON.stringify(a.args) %>
                <span class="mc-action-status">[<%= a.status %>]</span>
                <% if (a.result) { %><div class="text-dim"><%= a.result %></div><% } %>
              </div>
            <% } %>
            <% if (msg.proposedActions.some(a => a.status === 'pending')) { %>
              <form method="POST" action="/admin/mc/apply" style="display:inline;">
                <input type="hidden" name="messageId" value="<%= msg._id %>" />
                <button type="submit" class="btn">Apply</button>
              </form>
              <form method="POST" action="/admin/mc/discard" style="display:inline;">
                <input type="hidden" name="messageId" value="<%= msg._id %>" />
                <button type="submit" class="btn btn-secondary">Discard</button>
              </form>
            <% } %>
          </div>
        <% } %>
      </div>
    <% } %>
  </div>

  <form method="POST" action="/admin/mc/chat" class="mc-input">
    <textarea name="message" rows="3" class="input" placeholder="Tell the Master Controller what to do..." required></textarea>
    <button type="submit" class="btn">Send</button>
  </form>
</main>
<%- include('../partials/_foot') %>
```

> IMPLEMENTER: open `admin/events.ejs` and match its exact partial includes (header/nav/flash/foot names) and CSS classes; reuse the existing `msg`/`msg-in`/`msg-out` styles already defined for `comms.ejs`. Do not invent a new layout.

- [ ] **Step 5: Mount the page router + add nav link**

In `src/api/server.ts`, add the import:

```typescript
import { mcPagesRoutes } from '../web/routes/mc.pages.routes.js';
```

and mount it next to the other web page routers (near `app.use(adminPagesRoutes);`):

```typescript
  app.use(mcPagesRoutes);
```

In `src/web/views/partials/nav.ejs`, add a link after the Events link (line ~26):

```html
    <a href="/admin/mc" class="sidebar-link<%= currentPath === '/admin/mc' ? ' active' : '' %>">Master Controller</a>
```

- [ ] **Step 6: Run tests + type-check**

Run: `ADMIN_KEY=dev-admin-key npx vitest run test/mc-api.test.ts` → PASS (3). `npx tsc --noEmit` → no new errors. Then run the full suite: `ADMIN_KEY=dev-admin-key npx vitest run` → all green.

- [ ] **Step 7: Commit**

```bash
git add src/web/routes/mc.pages.routes.ts src/web/views/admin/mc.ejs src/api/server.ts src/web/views/partials/nav.ejs test/mc-api.test.ts
git commit -m "feat: add /admin/mc operator console page"
```

---

## Self-Review

**Spec coverage:**
- Decide/execute split (`mc/tools.ts` + `mc/propose.ts`) → Tasks 1, 4. ✓
- Scheduled world-sim refactored to share tools, no behavior change → Task 1. ✓
- New tools spawn_pirates / trigger_disaster / spawn_salvage → Task 2. ✓
- `MCConversation` global thread, capped 100 → Tasks 3, 5. ✓
- Conversation service send/apply/discard, propose-then-confirm, offline fallback → Tasks 4, 5. ✓
- REST `/api/admin/mc/*` (conversation/chat/apply/discard), admin auth, mounted before `/api/admin` → Task 6. ✓
- `/admin/mc` operator page + nav link, new files, server-rendered forms → Task 7. ✓
- Tests cover new tool handlers + apply/discard + offline propose + endpoint auth; no real LLM call (key forced empty) → Tasks 2, 5, 6. ✓

**Placeholder scan:** Task 1 Step 3 intentionally says "copy verbatim from MCWorldSimulator" for the five existing tool defs/handlers (a pure move, not new logic) — this is a move instruction, not a logic placeholder; the new dispatcher code is shown in full. All other steps contain complete code.

**Type consistency:** `executeMCTool(name, args, tick)`, `proposeMCActions(history)→{reply, proposedActions}`, `ProposedAction{tool,args}`, `MCConversation.messages[].proposedActions[]{tool,args,status,result}`, service `getConversation/sendOperatorMessage/applyProposed/discardProposed`, `mcRoutes`, `mcPagesRoutes` are consistent across tasks. Message `_id` is available because subdocs use `{ _id: true }`.

**Note:** Web-page session auth isn't fully exercised by tests (the `api()` helper uses keys, not sessions); Task 7's test only asserts the route is mounted and guarded (not 200 without a session). The page's logic is covered indirectly via the service tests (Task 5) and API tests (Task 6).
