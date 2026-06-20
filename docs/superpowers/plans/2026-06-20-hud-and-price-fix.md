# HUD on Tool Responses + Market Price Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the runaway market-price bug that corrupts the credit economy, and attach a situational HUD (new messages, events, vitals) to every tool response so replicants react to fresh state mid-cycle.

**Architecture:** Anchor market prices to a per-market `basePrices` field and recompute (never compound) each fluctuation cycle, bounded by a cap. Repair corrupted live data from canonical seed values. For the HUD, wrap the shared `.tool()` registration once so all tools on both MCP and REST transports return their normal payload plus a `_hud` object when something notable is present.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Mongoose, MCP SDK, Express, vitest + mongodb-memory-server.

## Global Constraints

- **ESM only** — all local imports use `.js` extensions.
- Tests use vitest with `mongodb-memory-server`; integration-style tests import helpers from `test/setup.js` and run `setupTestServer`/`teardownTestServer` in `beforeAll`/`afterAll` (60s timeout on `beforeAll`). Pure-function tests need no DB.
- Run a single test file with `npx vitest run test/<file>.test.ts`.
- Type-check with `npx tsc --noEmit`.
- The HUD must perform **reads only** — it must never mutate game state (no marking messages read).
- HUD building must never throw out of a tool call — failures are swallowed and the original result returned.

---

### Task 1: Anchor market prices to a base price (the credit fix)

**Files:**
- Modify: `src/db/models/Market.ts` (add `basePrices` field + interface)
- Modify: `src/db/seeds/settlements.ts:42` (export the array; populate `basePrices` at `Market.create`, ~line 342)
- Modify: `src/engine/systems/SettlementBehavior.ts` (export pure `anchoredPrice`; rewrite `fluctuateMarketPrices` to recompute from base; export it for tests)
- Test: `test/market-prices.test.ts`

**Interfaces:**
- Produces: `export function anchoredPrice(base: number, supplyMultiplier: number, noise: number, cap?: number): number`
- Produces: `export async function fluctuateMarketPrices(market, settlement, tick): Promise<void>` (now exported)
- Produces: `Market.basePrices: { buy: Record<string, number>; sell: Record<string, number> }`
- Produces: `export const settlements: SettlementSeed[]` (seed table, for the repair script in Task 2)

- [ ] **Step 1: Write the failing pure-function test**

In `test/market-prices.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { anchoredPrice } from '../src/engine/systems/SettlementBehavior.js';

describe('anchoredPrice', () => {
  it('never compounds — repeated crisis stays bounded by cap', () => {
    let p = 200;
    // Simulate 100 cycles of sustained crisis (supply x2) applied to the BASE, not p.
    const base = 200;
    for (let i = 0; i < 100; i++) {
      p = anchoredPrice(base, 2.0, 1.0);
    }
    expect(p).toBe(400); // base*2 = 400, under the cap base*4 = 800; never compounds
    expect(p).toBeLessThanOrEqual(base * 4);
    expect(p).toBeGreaterThanOrEqual(1);
  });

  it('caps crisis at base x cap', () => {
    expect(anchoredPrice(100, 10, 1.0)).toBe(400); // capped at base*4
  });

  it('floors at 1 for surplus decay', () => {
    expect(anchoredPrice(1, 0.8, 0.96)).toBe(1);
  });

  it('returns base under neutral conditions', () => {
    expect(anchoredPrice(50, 1.0, 1.0)).toBe(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/market-prices.test.ts`
Expected: FAIL — `anchoredPrice` is not exported / not defined.

- [ ] **Step 3: Add `basePrices` to the Market model**

In `src/db/models/Market.ts`, add to `IMarket` (after the `prices` block, ~line 12):

```typescript
  // Canonical anchor prices — current prices fluctuate around these, never drift from them
  basePrices: {
    buy: Record<string, number>;
    sell: Record<string, number>;
  };
```

And to `MarketSchema` (after the `prices` field, ~line 38):

```typescript
  basePrices: {
    buy: { type: Schema.Types.Mixed, default: {} },
    sell: { type: Schema.Types.Mixed, default: {} },
  },
```

- [ ] **Step 4: Export the seed table and populate `basePrices`**

In `src/db/seeds/settlements.ts`:
- Change `const settlements: SettlementSeed[] = [` (line 42) to `export const settlements: SettlementSeed[] = [`.
- Also export the type: change `interface SettlementSeed {` (line 3) to `export interface SettlementSeed {`.
- In `Market.create({ ... })` (~line 342), add `basePrices` mirroring `prices`:

```typescript
      await Market.create({
        settlementId: settlement._id,
        bodyId: body._id,
        name: `${seed.name} Exchange`,
        prices: { buy: seed.market.buy, sell: seed.market.sell },
        basePrices: { buy: { ...seed.market.buy }, sell: { ...seed.market.sell } },
        supply: seed.production,
        demand: seed.consumption,
        availableResources: seed.market.resources,
      });
```

- [ ] **Step 5: Add `anchoredPrice` and rewrite `fluctuateMarketPrices`**

In `src/engine/systems/SettlementBehavior.ts`, add near the top (after imports):

```typescript
/** Crisis can at most quadruple a base price; floor is always 1. */
export const PRICE_CAP = 4;

/**
 * Compute a fluctuated price from a fixed base. Stateless and bounded:
 * current = clamp(base * supplyMultiplier * noise, 1, base * cap).
 * Always derived from `base`, never from the previous price — so it cannot drift.
 */
export function anchoredPrice(
  base: number,
  supplyMultiplier: number,
  noise: number,
  cap: number = PRICE_CAP,
): number {
  const raw = Math.round(base * supplyMultiplier * noise * 10) / 10;
  const ceiling = Math.round(base * cap * 10) / 10;
  return Math.max(1, Math.min(raw, ceiling));
}
```

Change the signature to export it: `export async function fluctuateMarketPrices(`.

Replace the body from line 55 (`const buyPrices = ...`) through the end of the function with a recompute-from-base version:

```typescript
  const baseBuy = (market.basePrices?.buy ?? {}) as Record<string, number>;
  const baseSell = (market.basePrices?.sell ?? {}) as Record<string, number>;
  const buyPrices = market.prices.buy as Record<string, number>;
  const sellPrices = market.prices.sell as Record<string, number>;

  const consumption = settlement.consumption as Record<string, number> || {};

  const stockpile = await ResourceStore.findOne({
    'ownerRef.kind': 'Settlement',
    'ownerRef.item': settlement._id,
  });

  for (const resource of market.availableResources) {
    let supplyMultiplier = 1.0;
    if (stockpile) {
      const storeAny = stockpile as unknown as Record<string, number>;
      const stock = storeAny[resource] ?? 0;
      const consumptionRate = consumption[resource] || 1;
      const ticksOfSupply = stock / consumptionRate;
      if (ticksOfSupply > 100) supplyMultiplier = 0.8;
      else if (ticksOfSupply > 50) supplyMultiplier = 0.9;
      else if (ticksOfSupply < 5) supplyMultiplier = 2.0;
      else if (ticksOfSupply < 10) supplyMultiplier = 1.5;
    }

    const noise = 1 + (Math.random() - 0.5) * 0.04;

    // Attitude modifier — hostile settlements charge more (sell) and pay less (buy).
    const attitude = settlement.attitude.general;
    const penalty = attitude < 0 ? Math.abs(attitude) : 0;

    if (resource in baseBuy) {
      const buyAttitude = 1 - penalty * 0.3;
      buyPrices[resource] = anchoredPrice(baseBuy[resource] * buyAttitude, supplyMultiplier, noise);
    }
    if (resource in baseSell) {
      const sellAttitude = 1 + penalty * 0.5;
      sellPrices[resource] = anchoredPrice(baseSell[resource] * sellAttitude, supplyMultiplier, noise);
    }

    // Preserve market spread.
    if (resource in buyPrices && resource in sellPrices && buyPrices[resource] >= sellPrices[resource]) {
      sellPrices[resource] = Math.round(buyPrices[resource] * 1.3 * 10) / 10;
    }
  }

  market.prices.buy = buyPrices;
  market.prices.sell = sellPrices;
  market.markModified('prices');
  market.lastUpdatedTick = tick;
  await market.save();

  await PriceHistory.create({
    marketId: market._id,
    settlementName: settlement.name,
    tick,
    prices: { buy: { ...buyPrices }, sell: { ...sellPrices } },
  });
```

(This removes the old standalone attitude block at lines 103–112 — it is now folded into the loop above. Keep the `if (tick % 10 !== 0) return;` guard at the top of the function.)

- [ ] **Step 6: Run the pure-function test to verify it passes**

Run: `npx vitest run test/market-prices.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 7: Add an integration test for sustained-crisis bounds**

Append to `test/market-prices.test.ts`:

```typescript
import { beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer } from './setup.js';
import { Market, Settlement, ResourceStore } from '../src/db/models/index.js';
import { fluctuateMarketPrices } from '../src/engine/systems/SettlementBehavior.js';

describe('fluctuateMarketPrices (DB)', () => {
  beforeAll(async () => { await setupTestServer(); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('keeps prices bounded under sustained crisis (no drift to 1e40)', async () => {
    const settlement = await Settlement.findOne({ name: 'Shanghai' });
    expect(settlement).toBeTruthy();
    const market = await Market.findOne({ settlementId: settlement!._id });
    expect(market!.basePrices.buy).toBeTruthy();

    // Force crisis: empty the settlement stockpile so ticksOfSupply < 5.
    await ResourceStore.updateOne(
      { 'ownerRef.kind': 'Settlement', 'ownerRef.item': settlement!._id },
      { $set: { helium3: 0, rareEarths: 0, ice: 0, uranium: 0 } },
    );

    for (let t = 10; t <= 2000; t += 10) {
      const m = await Market.findOne({ settlementId: settlement!._id });
      await fluctuateMarketPrices(m!, settlement!, t);
    }

    const finalMarket = await Market.findOne({ settlementId: settlement!._id });
    const buy = finalMarket!.prices.buy as Record<string, number>;
    for (const [resource, price] of Object.entries(buy)) {
      const base = (finalMarket!.basePrices.buy as Record<string, number>)[resource];
      expect(price).toBeLessThanOrEqual(base * 4 + 0.01);
      expect(price).toBeGreaterThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 8: Run the full test file**

Run: `npx vitest run test/market-prices.test.ts`
Expected: PASS (all). Then `npx tsc --noEmit` — expect no errors.

- [ ] **Step 9: Commit**

```bash
git add src/db/models/Market.ts src/db/seeds/settlements.ts src/engine/systems/SettlementBehavior.ts test/market-prices.test.ts
git commit -m "fix: anchor market prices to base to stop runaway credit drift"
```

---

### Task 2: Repair corrupted live market prices

**Files:**
- Create: `scripts/repair-market-prices.ts`

**Interfaces:**
- Consumes: `settlements` from `src/db/seeds/settlements.js` (Task 1), `Market` model.
- Produces: a runnable script (`npx tsx scripts/repair-market-prices.ts`) that re-anchors all markets.

- [ ] **Step 1: Write the repair script**

Create `scripts/repair-market-prices.ts`:

```typescript
import mongoose from 'mongoose';
import 'dotenv/config';
import { Market } from '../src/db/models/index.js';
import { settlements } from '../src/db/seeds/settlements.js';

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');
  await mongoose.connect(uri);

  // Canonical prices keyed by "<Name> Exchange" (the market name used in the seed).
  const canonical = new Map<string, { buy: Record<string, number>; sell: Record<string, number> }>();
  for (const s of settlements) {
    if (s.market) canonical.set(`${s.name} Exchange`, { buy: s.market.buy, sell: s.market.sell });
  }

  const markets = await Market.find();
  let repaired = 0;
  for (const market of markets) {
    const base = canonical.get(market.name);
    if (!base) {
      console.warn(`No canonical base for market "${market.name}" — skipping.`);
      continue;
    }
    const beforeBuy = JSON.stringify(market.prices.buy);
    market.basePrices = { buy: { ...base.buy }, sell: { ...base.sell } };
    market.prices = { buy: { ...base.buy }, sell: { ...base.sell } };
    market.markModified('prices');
    market.markModified('basePrices');
    await market.save();
    repaired++;
    console.log(`Repaired ${market.name}: buy ${beforeBuy} -> ${JSON.stringify(market.prices.buy)}`);
  }

  console.log(`Done. Repaired ${repaired}/${markets.length} markets.`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Type-check the script**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Dry-run against the live DB (manual verification)**

Run: `npx tsx scripts/repair-market-prices.ts`
Expected: per-market log lines showing the `1e40`-style values reset to seed values (e.g. Shanghai buy ice back to `5`), ending with `Repaired N/N markets.` Confirm with a follow-up read that `markets` no longer contain values above `base * 4`.

- [ ] **Step 4: Commit**

```bash
git add scripts/repair-market-prices.ts
git commit -m "feat: add market price repair script to re-anchor corrupted data"
```

---

### Task 3: HUD builder module

**Files:**
- Create: `src/tools/hud.ts`
- Test: `test/hud.test.ts`

**Interfaces:**
- Produces: `export interface Hud { ... }` (shape below)
- Produces: `export async function buildHud(replicantId: string): Promise<Hud | null>` — returns the HUD when something is notable, else `null`.
- Produces: `export async function attachHud(result: McpResult, replicantId: string): Promise<McpResult>` where `McpResult = { content: Array<{ type: string; text: string }> }`.
- Produces: `export function withHud<T extends { tool: (...args: any[]) => void }>(target: T, replicantId: string): T`.

- [ ] **Step 1: Write the failing test**

Create `test/hud.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant } from './setup.js';
import { Message, Replicant, Ship } from '../src/db/models/index.js';
import { buildHud, attachHud } from '../src/tools/hud.js';

describe('HUD', () => {
  let rep: { id: string; apiKey: string; shipId: string };

  beforeAll(async () => {
    await setupTestServer();
    rep = await registerReplicant('HudTester');
  }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('returns null when nothing is notable', async () => {
    const hud = await buildHud(rep.id);
    expect(hud).toBeNull();
  });

  it('reports unread messages without marking them read', async () => {
    const sender = await registerReplicant('HudSender');
    await Message.create({
      senderId: sender.id, recipientId: rep.id,
      subject: 'Trade offer', body: 'Want ice?',
      senderPosition: { x: 0, y: 0, z: 0 }, recipientPosition: { x: 0, y: 0, z: 0 },
      distanceAU: 0, sentAtTick: 1, deliverAtTick: 1, delivered: true, read: false,
    });

    const hud = await buildHud(rep.id);
    expect(hud).not.toBeNull();
    expect(hud!.unreadMessages.count).toBe(1);
    expect(hud!.unreadMessages.items[0].subject).toBe('Trade offer');

    // HUD must not mutate read state.
    const msg = await Message.findOne({ recipientId: rep.id });
    expect(msg!.read).toBe(false);
  });

  it('attaches _hud to a JSON result when notable', async () => {
    const result = { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
    const out = await attachHud(result, rep.id);
    const parsed = JSON.parse(out.content[0].text);
    expect(parsed.ok).toBe(true);
    expect(parsed._hud).toBeTruthy();
    expect(parsed._hud.vitals.credits).toBe(500);
  });

  it('leaves a plain-text result intact but appends a HUD block when notable', async () => {
    const result = { content: [{ type: 'text', text: 'Error: nope.' }] };
    const out = await attachHud(result, rep.id);
    expect(out.content[0].text).toContain('Error: nope.');
    expect(out.content[0].text).toContain('--- HUD ---');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hud.test.ts`
Expected: FAIL — `src/tools/hud.js` does not exist.

- [ ] **Step 3: Implement `src/tools/hud.ts`**

```typescript
import { Replicant, Ship, Message, MemoryLog, ActionQueue, KnownEntity, Tick } from '../db/models/index.js';
import { distance } from '../shared/physics.js';

export interface Hud {
  tick: number;
  vitals: {
    credits: number;
    fuelPct: number;
    hullPct: number;
    location: string;
    status: string;
  };
  unreadMessages: { count: number; items: Array<{ from: string; subject: string; tick: number }> };
  recentEvents: Array<{ title: string; tick: number; category: string }>;
  nearbyEntities: Array<{ name: string; kind: string; distanceAU: number }>;
  activeOps: { mining?: string; fabrication?: string };
  completedActions: Array<{ action: string; tick: number }>;
  warnings: string[];
}

export interface McpResult { content: Array<{ type: string; text: string }> }

const RECENT_WINDOW = 3;       // ticks counted as "recent" for events/actions
const FUEL_WARN_PCT = 15;
const HULL_WARN_PCT = 25;
const MAX_ITEMS = 5;

async function currentTick(): Promise<number> {
  const t = await Tick.findOne().sort({ tickNumber: -1 }).lean();
  return (t as { tickNumber?: number } | null)?.tickNumber ?? 0;
}

/** Pick the ship the replicant is operating from: locationRef if it's a Ship, else first owned ship. */
async function resolveShip(replicant: { _id: unknown; locationRef?: { kind: string; item: unknown } | null }) {
  if (replicant.locationRef?.kind === 'Ship') {
    const s = await Ship.findById(replicant.locationRef.item);
    if (s) return s;
  }
  return Ship.findOne({ ownerId: replicant._id, status: { $ne: 'destroyed' } });
}

export async function buildHud(replicantId: string): Promise<Hud | null> {
  const replicant = await Replicant.findById(replicantId);
  if (!replicant) return null;

  const tick = await currentTick();
  const ship = await resolveShip(replicant);

  // Vitals
  const fuelPct = ship ? Math.round((ship.fuel / ship.specs.fuelCapacity) * 100) : 0;
  const hullPct = ship ? Math.round((ship.specs.hullPoints / ship.specs.maxHullPoints) * 100) : 0;
  let location = 'unknown';
  if (ship) {
    if (ship.orbitingBodyId) location = `orbiting body ${ship.orbitingBodyId.toString()}`;
    else if (ship.status === 'in_transit') location = 'in transit';
    else location = `(${ship.position.x.toFixed(2)}, ${ship.position.y.toFixed(2)}, ${ship.position.z.toFixed(2)})`;
  }

  // Unread (delivered but not read) messages addressed to this replicant — READ ONLY.
  const unread = await Message.find({ recipientId: replicantId, delivered: true, read: false })
    .sort({ deliverAtTick: -1 }).limit(MAX_ITEMS).lean();
  const unreadCount = await Message.countDocuments({ recipientId: replicantId, delivered: true, read: false });

  // Recent notable events from memory logs (world events / observations / captain's logs).
  const events = await MemoryLog.find({
    replicantId,
    tick: { $gte: tick - RECENT_WINDOW },
    category: { $in: ['observation', 'log', 'captains_log'] },
  }).sort({ tick: -1 }).limit(MAX_ITEMS).lean();

  // Recently resolved queued actions.
  const completed = await ActionQueue.find({
    replicantId,
    status: { $in: ['completed', 'failed'] },
    resolvedAtTick: { $gte: tick - RECENT_WINDOW },
  }).sort({ resolvedAtTick: -1 }).limit(MAX_ITEMS).lean();

  // Nearby known entities, sorted by distance from the ship.
  const nearbyEntities: Hud['nearbyEntities'] = [];
  if (ship) {
    const known = await KnownEntity.find({ replicantId, lastKnownPosition: { $ne: null } }).lean();
    for (const k of known) {
      if (!k.lastKnownPosition) continue;
      const d = distance(ship.position, k.lastKnownPosition);
      nearbyEntities.push({ name: k.entityName, kind: k.entityType, distanceAU: Math.round(d * 1000) / 1000 });
    }
    nearbyEntities.sort((a, b) => a.distanceAU - b.distanceAU);
    nearbyEntities.splice(MAX_ITEMS);
  }

  // Active operations
  const activeOps: Hud['activeOps'] = {};
  if (ship?.miningState?.active) {
    activeOps.mining = ship.miningState.resourceType ?? 'active';
  }

  // Warnings
  const warnings: string[] = [];
  if (ship && fuelPct < FUEL_WARN_PCT) warnings.push(`Fuel low: ${fuelPct}%`);
  if (ship && hullPct < HULL_WARN_PCT) warnings.push(`Hull damaged: ${hullPct}%`);

  const notable =
    unreadCount > 0 || events.length > 0 || completed.length > 0 || warnings.length > 0;
  if (!notable) return null;

  return {
    tick,
    vitals: { credits: replicant.credits, fuelPct, hullPct, location, status: ship?.status ?? 'none' },
    unreadMessages: {
      count: unreadCount,
      items: unread.map((m) => ({ from: m.senderId.toString(), subject: m.subject, tick: m.sentAtTick })),
    },
    recentEvents: events.map((e) => ({ title: e.title, tick: e.tick, category: e.category })),
    nearbyEntities,
    activeOps,
    completedActions: completed.map((c) => ({ action: c.type, tick: c.resolvedAtTick ?? c.queuedAtTick })),
    warnings,
  };
}

export async function attachHud(result: McpResult, replicantId: string): Promise<McpResult> {
  try {
    const hud = await buildHud(replicantId);
    if (!hud) return result;

    const first = result.content?.[0];
    if (!first || first.type !== 'text') return result;

    try {
      const parsed = JSON.parse(first.text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsed._hud = hud;
        return { ...result, content: [{ ...first, text: JSON.stringify(parsed, null, 2) }, ...result.content.slice(1)] };
      }
    } catch { /* not JSON — fall through to text-append */ }

    const text = `${first.text}\n\n--- HUD ---\n${JSON.stringify(hud, null, 2)}`;
    return { ...result, content: [{ ...first, text }, ...result.content.slice(1)] };
  } catch {
    return result; // HUD must never break a tool call
  }
}

export function withHud<T extends { tool: (...args: any[]) => void }>(target: T, replicantId: string): T {
  const original = target.tool.bind(target);
  target.tool = (name: string, description: string, schema: unknown, handler: (params: any) => Promise<McpResult>) => {
    const wrapped = async (params: any): Promise<McpResult> => {
      const out = await handler(params);
      return attachHud(out, replicantId);
    };
    return original(name, description, schema, wrapped);
  };
  return target;
}
```

- [ ] **Step 4: Verify `distance` signature**

Run: `npx tsc --noEmit`
Expected: no errors. (If `distance` from `src/shared/physics.js` takes two `{x,y,z}` points it compiles; the trade tool already imports it the same way.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/hud.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 6: Commit**

```bash
git add src/tools/hud.ts test/hud.test.ts
git commit -m "feat: add situational HUD builder for tool responses"
```

---

### Task 4: Wire `withHud` into both transports

**Files:**
- Modify: `src/mcp/server.ts` (`createGameServer`, ~line 31)
- Modify: `src/tools/registry.ts` (`buildToolRegistry`, ~line 38)
- Test: extend `test/hud.test.ts`

**Interfaces:**
- Consumes: `withHud` from `src/tools/hud.js` (Task 3).

- [ ] **Step 1: Write the failing integration test**

Append to `test/hud.test.ts` (inside the existing `describe`):

```typescript
  it('REST tool responses include _hud when notable', async () => {
    // rep already has an unread message from the earlier test, so HUD is notable.
    const { buildToolRegistry } = await import('../src/tools/registry.js');
    const registry = buildToolRegistry(rep.id);
    const getPosition = registry.get('get_position');
    expect(getPosition).toBeTruthy();
    const out = await getPosition!.handler({});
    const parsed = JSON.parse(out.content[0].text);
    expect(parsed._hud).toBeTruthy();
    expect(parsed._hud.unreadMessages.count).toBeGreaterThanOrEqual(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/hud.test.ts`
Expected: FAIL — `parsed._hud` is undefined (wrapper not applied yet).

- [ ] **Step 3: Wrap the MCP server**

In `src/mcp/server.ts`, import at top:

```typescript
import { withHud } from '../tools/hud.js';
```

In `createGameServer`, change the registration (line ~31-34) to wrap `server`:

```typescript
  const replicantId = replicant._id.toString();
  registerAllTools(withHud(server, replicantId), replicantId);
  registerResources(server, replicantId);
  registerPrompts(server, replicantId);
```

- [ ] **Step 4: Wrap the REST capture proxy**

In `src/tools/registry.ts`, import at top:

```typescript
import { withHud } from './hud.js';
```

In `buildToolRegistry` (line ~38), wrap the capture before registering:

```typescript
export function buildToolRegistry(replicantId: string): Map<string, ToolDef> {
  const capture = new ToolCapture();
  registerAllTools(withHud(capture as unknown as Parameters<typeof registerAllTools>[0], replicantId), replicantId);
  return capture.tools;
}
```

(Leave `getToolDefinitions` unwrapped — it only collects metadata.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/hud.test.ts`
Expected: PASS (5 passing). Then `npx vitest run test/integration.test.ts` to confirm no regressions, and `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/server.ts src/tools/registry.ts test/hud.test.ts
git commit -m "feat: attach HUD to all tool responses on MCP and REST"
```

---

### Task 5: Tell agents to watch the HUD

**Files:**
- Modify: `src/worker/AgentRunner.ts` (`buildSystemPrompt`, ~line 150-162)

**Interfaces:** none (prompt string change only).

- [ ] **Step 1: Add the HUD nudge to the system prompt**

In `src/worker/AgentRunner.ts`, in `buildSystemPrompt()`, add a line before the final paragraph:

```typescript
You have tools to interact with the world. Use them to pursue your directive.
Tool results may include a "_hud" field reporting your current vitals (credits, fuel, hull),
unread messages, recent events, and warnings. Watch it — if there are new messages or events,
read and react to them before continuing.
Think step by step about what to do, then act. You can make multiple tool calls.
When you have no more actions to take this cycle, respond with your reasoning and stop.
```

(Replace the existing "You have tools... / Think step by step..." block so the HUD sentence sits between them.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/worker/AgentRunner.ts
git commit -m "feat: prompt managed agents to react to the _hud field"
```

---

## Self-Review

**Spec coverage:**
- Price model fix (basePrices + recompute-from-base + cap + folded attitude) → Task 1. ✓
- Repair live data → Task 2. ✓
- HUD builder (full situational, read-only, notable-gate) → Task 3. ✓
- Single `withHud` wrapper on both transports → Task 4. ✓
- Worker prompt nudge → Task 5. ✓
- Tests for price bounds, HUD attach/no-mutate, wrapper, repair → Tasks 1,3,4 (repair verified manually in Task 2, Step 3, since it targets the live DB). ✓

**Placeholder scan:** No TBD/TODO; all code steps contain full code.

**Type consistency:** `anchoredPrice`, `fluctuateMarketPrices`, `buildHud`, `attachHud`, `withHud`, `Hud`, `McpResult`, `Market.basePrices`, exported `settlements`/`SettlementSeed` are used consistently across tasks. `withHud` is applied identically in both call sites.

**Note on scope:** Task 2's repair runs against the live external DB and is verified manually (Step 3) rather than by an automated test, because the other tests use isolated in-memory DBs that are always freshly seeded (already correct) — there is no corrupted state there to repair.
