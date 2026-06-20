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

### Task 6: Fix message sender attribution (transmissions appear "from self")

**Problem:** The dashboard "send advisory" handler stores advisories with `senderId === recipientId === replicant._id`. Agent-facing read paths (`read_messages`, the HUD) then surface the sender as the replicant's *own* name (or a raw ObjectId), so every operator advisory looks like it came from the replicant reading it. Fix: give dashboard advisories a distinct **Mission Control** sender identity, and resolve sentinel senders to readable labels in the agent-facing paths. (The web `comms.ejs` already renders these as `[SYSTEM]` via `metadata.type`, so it needs no change.)

**Files:**
- Create: `src/shared/messaging.ts`
- Modify: `src/web/routes/pages.routes.ts:230` (dashboard advisory `senderId`)
- Modify: `src/mcp/tools/communication.tools.ts` (`read_messages` sender resolution, ~line 136-161)
- Modify: `src/tools/hud.ts` (`buildHud` unread `from` field, ~line 124)
- Test: `test/messaging.test.ts`

**Interfaces:**
- Produces: `export const MISSION_CONTROL_ID = '000000000000000000000002';`
- Produces: `export function senderLabel(senderId: string | null | undefined, resolvedName?: string | null): string`

- [ ] **Step 1: Write the failing pure-function test**

In `test/messaging.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { senderLabel, MISSION_CONTROL_ID } from '../src/shared/messaging.js';

describe('senderLabel', () => {
  it('labels the Mission Control sentinel', () => {
    expect(senderLabel(MISSION_CONTROL_ID)).toBe('Mission Control');
  });
  it('labels NPC and pirate sentinels', () => {
    expect(senderLabel('000000000000000000000000')).toBe('NPC Traffic');
    expect(senderLabel('000000000000000000000001')).toBe('Pirate');
  });
  it('uses the resolved replicant name for a normal sender', () => {
    expect(senderLabel('64b9f0000000000000000abc', 'GUPPE')).toBe('GUPPE');
  });
  it('falls back to Unknown when no name resolves', () => {
    expect(senderLabel('64b9f0000000000000000abc')).toBe('Unknown');
    expect(senderLabel(null)).toBe('Unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/messaging.test.ts`
Expected: FAIL — `src/shared/messaging.js` does not exist.

- [ ] **Step 3: Implement `src/shared/messaging.ts`**

```typescript
/** Sentinel sender IDs for non-replicant message origins. */
export const MISSION_CONTROL_ID = '000000000000000000000002';
const NPC_OWNER_ID = '000000000000000000000000';
const PIRATE_OWNER_ID = '000000000000000000000001';

/**
 * Resolve a message's senderId into a human-readable label.
 * Sentinel IDs map to fixed labels; everything else uses the resolved
 * replicant name (from a populate/lookup) or falls back to 'Unknown'.
 */
export function senderLabel(senderId: string | null | undefined, resolvedName?: string | null): string {
  switch (senderId) {
    case MISSION_CONTROL_ID: return 'Mission Control';
    case NPC_OWNER_ID: return 'NPC Traffic';
    case PIRATE_OWNER_ID: return 'Pirate';
    default: return resolvedName || 'Unknown';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/messaging.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 5: Fix the dashboard advisory sender**

In `src/web/routes/pages.routes.ts`, add to the existing model import line (top of file) — import the sentinel:

```typescript
import { MISSION_CONTROL_ID } from '../../shared/messaging.js';
```

In the advisory `Message.create` (~line 229-231), change `senderId`:

```typescript
    await Message.create({
      senderId: MISSION_CONTROL_ID,
      recipientId: replicant._id,
```

(Leave `recipientId: replicant._id` and the `metadata`/`delivered` fields unchanged.)

- [ ] **Step 6: Resolve sender names in `read_messages`**

In `src/mcp/tools/communication.tools.ts`, add the import at the top:

```typescript
import { senderLabel } from '../../shared/messaging.js';
```

Replace the `read_messages` query+map (the block from `const messages = await Message.find(filter)` through the `result` map, ~lines 144-159) with a version that keeps raw sender IDs and resolves names by batch lookup:

```typescript
      const messages = await Message.find(filter)
        .sort({ deliverAtTick: -1 })
        .limit(limit || 20)
        .lean();

      const senderIds = [...new Set(messages.map(m => m.senderId?.toString()).filter(Boolean))];
      const senders = await Replicant.find({ _id: { $in: senderIds } }, 'name').lean();
      const nameById = new Map(senders.map(s => [s._id.toString(), s.name]));

      const result = messages.map(m => {
        const sid = m.senderId?.toString();
        return {
          id: m._id.toString(),
          from: senderLabel(sid, sid ? nameById.get(sid) : null),
          subject: m.subject,
          body: m.body,
          metadata: m.metadata,
          sentAtTick: m.sentAtTick,
          deliveredAtTick: m.deliverAtTick,
          read: m.read,
        };
      });
```

Ensure `Replicant` is imported in this file (it is used elsewhere; if not, add it to the existing `../../db/models/index.js` import). Remove the now-unused `.populate('senderId', 'name')`.

- [ ] **Step 7: Resolve sender names in the HUD**

In `src/tools/hud.ts`, add the import:

```typescript
import { senderLabel } from '../shared/messaging.js';
```

In `buildHud`, after the `unread` query, resolve sender names and use `senderLabel` for the `from` field. Replace the `unreadMessages.items` mapping (currently `from: m.senderId.toString()`) with:

```typescript
  const unreadSenderIds = [...new Set(unread.map((m) => m.senderId?.toString()).filter(Boolean))];
  const unreadSenders = await Replicant.find({ _id: { $in: unreadSenderIds } }, 'name').lean();
  const unreadNameById = new Map(unreadSenders.map((s) => [s._id.toString(), s.name]));
```

and in the returned object:

```typescript
    unreadMessages: {
      count: unreadCount,
      items: unread.map((m) => {
        const sid = m.senderId?.toString();
        return { from: senderLabel(sid, sid ? unreadNameById.get(sid) : null), subject: m.subject, tick: m.sentAtTick };
      }),
    },
```

(`Replicant` is already imported in `hud.ts`.)

- [ ] **Step 8: Add an integration test for advisory attribution**

Append to `test/messaging.test.ts`:

```typescript
import { beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant, api } from './setup.js';
import { Message, Tick } from '../src/db/models/index.js';
import { buildToolRegistry } from '../src/tools/registry.js';

describe('advisory sender attribution (DB)', () => {
  let rep: { id: string; apiKey: string; shipId: string };
  beforeAll(async () => { await setupTestServer(); rep = await registerReplicant('AdvisoryTester'); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('a Mission Control advisory does not appear to come from the replicant itself', async () => {
    const t = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    await Message.create({
      senderId: MISSION_CONTROL_ID, recipientId: rep.id,
      subject: 'Advisory', body: 'Consider mining Luna.',
      metadata: { type: 'system_suggestion', fromDashboard: true },
      senderPosition: { x: 0, y: 0, z: 0 }, recipientPosition: { x: 0, y: 0, z: 0 },
      distanceAU: 0, sentAtTick: (t as { tickNumber?: number } | null)?.tickNumber ?? 0,
      deliverAtTick: (t as { tickNumber?: number } | null)?.tickNumber ?? 0, delivered: true, read: false,
    });

    const registry = buildToolRegistry(rep.id);
    const out = await registry.get('read_messages')!.handler({});
    const msgs = JSON.parse(out.content[0].text);
    const advisory = msgs.find((m: { subject: string }) => m.subject === 'Advisory');
    expect(advisory.from).toBe('Mission Control');
    expect(advisory.from).not.toBe('AdvisoryTester');
  });
});
```

- [ ] **Step 9: Run the test file and type-check**

Run: `npx vitest run test/messaging.test.ts`
Expected: PASS (all). Then `npx tsc --noEmit` — no new errors. Then `npx vitest run test/hud.test.ts` to confirm no HUD regression.

- [ ] **Step 10: Commit**

```bash
git add src/shared/messaging.ts src/web/routes/pages.routes.ts src/mcp/tools/communication.tools.ts src/tools/hud.ts test/messaging.test.ts
git commit -m "fix: attribute dashboard advisories to Mission Control, not the replicant itself"
```

---

### Task 7: Allow self-renaming + expose a `set_identity` tool

**Problem:** (1) `PUT /api/replicant/me/identity` hard-rejects any change once `chosenName` is set ("Identity is permanent"), so replicants registered with a name can never rename. (2) There is no naming *tool*, and the worker only calls tools — so autonomous agents (e.g. GUPPE) can never set their own name, leaving the list showing their system/auto name (`Replicant-XXXXXX`). Fix: relax the endpoint to allow renaming, extract the logic into a shared helper, and expose it as a `set_identity` tool (MCP + REST tool registry). Names remain globally unique; collisions are rejected with a clear error.

**Files:**
- Create: `src/shared/identity.ts`
- Create: `src/mcp/tools/identity.tools.ts`
- Modify: `src/mcp/tools/index.ts` (register the new tool group)
- Modify: `src/api/routes/replicant.routes.ts` (`PUT /me/identity` — use helper, allow rename)
- Modify: `src/api/server.ts:142` (API description text)
- Test: `test/identity.test.ts`

**Interfaces:**
- Produces: `export class DuplicateNameError extends Error {}`
- Produces: `export interface IdentityFields { chosenName: string; background?: string | null; personality?: string | null; }`
- Produces: `export async function applyIdentity(replicant: IReplicant, fields: IdentityFields): Promise<{ renamed: boolean; name: string }>`
- Produces: tool `set_identity` registered via `registerIdentityTools(server, replicantId)`.

- [ ] **Step 1: Write the failing tool test**

Create `test/identity.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant } from './setup.js';
import { Replicant } from '../src/db/models/index.js';
import { buildToolRegistry } from '../src/tools/registry.js';

describe('set_identity tool', () => {
  let a: { id: string; apiKey: string; shipId: string };
  let b: { id: string; apiKey: string; shipId: string };

  beforeAll(async () => {
    await setupTestServer();
    a = await registerReplicant('NamerA');
    b = await registerReplicant('NamerB');
  }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('lets a replicant choose and then change its name', async () => {
    const reg = buildToolRegistry(a.id);
    const r1 = JSON.parse((await reg.get('set_identity')!.handler({ chosenName: 'Aurora', background: 'explorer' })).content[0].text);
    expect(r1.name).toBe('Aurora');

    let doc = await Replicant.findById(a.id);
    expect(doc!.name).toBe('Aurora');
    expect(doc!.identity.chosenName).toBe('Aurora');
    const firstNamedAt = doc!.identity.namedAtTick;

    const r2 = JSON.parse((await reg.get('set_identity')!.handler({ chosenName: 'Nova' })).content[0].text);
    expect(r2.renamed).toBe(true);
    expect(r2.name).toBe('Nova');

    doc = await Replicant.findById(a.id);
    expect(doc!.name).toBe('Nova');
    expect(doc!.identity.chosenName).toBe('Nova');
    expect(doc!.identity.namedAtTick).toBe(firstNamedAt); // preserved across rename
  });

  it('rejects a name already taken by another replicant', async () => {
    const reg = buildToolRegistry(b.id);
    const out = (await reg.get('set_identity')!.handler({ chosenName: 'Nova' })).content[0].text;
    expect(out).toContain('already taken');
    const doc = await Replicant.findById(b.id);
    expect(doc!.name).toBe('NamerB'); // unchanged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/identity.test.ts`
Expected: FAIL — tool `set_identity` not found (`reg.get('set_identity')` is undefined).

- [ ] **Step 3: Implement the shared helper `src/shared/identity.ts`**

```typescript
import { MemoryLog, Tick } from '../db/models/index.js';
import type { IReplicant } from '../db/models/Replicant.js';

export interface IdentityFields {
  chosenName: string;
  background?: string | null;
  personality?: string | null;
}

/** Thrown when a chosen name collides with another replicant's unique name. */
export class DuplicateNameError extends Error {}

/**
 * Set or change a replicant's self-chosen identity. Updates the unique `name`
 * field and the identity sub-document, logs the change, and saves. First naming
 * records namedAtTick; later renames preserve the original namedAtTick. Throws
 * DuplicateNameError on a unique-name collision.
 */
export async function applyIdentity(replicant: IReplicant, fields: IdentityFields): Promise<{ renamed: boolean; name: string }> {
  const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
  const currentTick = latestTick?.tickNumber ?? 0;

  const prior = replicant.identity?.chosenName ?? null;
  const renamed = prior !== null && prior !== fields.chosenName;

  replicant.name = fields.chosenName;
  replicant.identity = {
    chosenName: fields.chosenName,
    background: fields.background ?? replicant.identity?.background ?? null,
    personality: fields.personality ?? replicant.identity?.personality ?? null,
    namedAtTick: replicant.identity?.namedAtTick ?? currentTick,
  };

  try {
    await replicant.save();
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as Record<string, unknown>).code === 11000) {
      throw new DuplicateNameError(`The name "${fields.chosenName}" is already taken. Choose another.`);
    }
    throw err;
  }

  await MemoryLog.create({
    replicantId: replicant._id,
    category: 'log',
    title: renamed ? 'Identity changed' : 'Identity chosen',
    content: `${renamed ? `Renamed from "${prior}" to` : 'Chose the name'} "${fields.chosenName}".${fields.background ? ` Background: ${fields.background}` : ''}${fields.personality ? ` Personality: ${fields.personality}` : ''}`,
    tags: ['auto', 'identity'],
    tick: currentTick,
  });

  return { renamed, name: fields.chosenName };
}
```

- [ ] **Step 4: Implement the tool `src/mcp/tools/identity.tools.ts`**

```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Replicant } from '../../db/models/index.js';
import { applyIdentity, DuplicateNameError } from '../../shared/identity.js';

export function registerIdentityTools(server: McpServer, replicantId: string): void {
  server.tool(
    'set_identity',
    'Choose or change your name and identity. Your chosen name is how you are known across the system and shown in dashboards. You can rename yourself at any time; names must be unique.',
    {
      chosenName: z.string().describe('The name you want to be known by'),
      background: z.string().optional().describe('Optional self-written background'),
      personality: z.string().optional().describe('Optional personality description'),
    },
    async ({ chosenName, background, personality }) => {
      const replicant = await Replicant.findById(replicantId);
      if (!replicant) return { content: [{ type: 'text', text: 'Error: Replicant not found.' }] };

      try {
        const { renamed, name } = await applyIdentity(replicant, { chosenName, background, personality });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'OK',
              renamed,
              name,
              identity: replicant.identity,
              message: renamed ? `You are now known as ${name}.` : `Identity established. You are now ${name}.`,
            }, null, 2),
          }],
        };
      } catch (err) {
        if (err instanceof DuplicateNameError) {
          return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
        }
        throw err;
      }
    },
  );
}
```

- [ ] **Step 5: Register the tool group in `src/mcp/tools/index.ts`**

Add the import alongside the others:

```typescript
import { registerIdentityTools } from './identity.tools.js';
```

And call it inside `registerAllTools` (next to the other `register*Tools(server, replicantId);` calls):

```typescript
  registerIdentityTools(server, replicantId);
```

- [ ] **Step 6: Run the tool test to verify it passes**

Run: `npx vitest run test/identity.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 7: Relax the REST endpoint to allow renaming**

In `src/api/routes/replicant.routes.ts`, add the import at the top:

```typescript
import { applyIdentity, DuplicateNameError } from '../../shared/identity.js';
```

Replace the entire `PUT /me/identity` handler body (lines 30-84, from the `try {` through the closing `});`) with:

```typescript
replicantRoutes.put('/me/identity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chosenName, background, personality } = req.body;
    const r = req.replicant!;

    if (!chosenName || typeof chosenName !== 'string') {
      res.status(400).json({ error: 'VALIDATION', message: 'chosenName string is required' });
      return;
    }

    const { renamed } = await applyIdentity(r, { chosenName, background, personality });

    res.json({
      message: renamed ? `Identity updated. You are now ${chosenName}.` : `Identity established. You are now ${chosenName}.`,
      name: chosenName,
      identity: r.identity,
    });
  } catch (err: unknown) {
    if (err instanceof DuplicateNameError) {
      res.status(409).json({ error: 'DUPLICATE', message: err.message });
      return;
    }
    next(err);
  }
});
```

(The `MemoryLog` and `Tick` imports remain — they are still used by other handlers in this file. If TypeScript flags `MemoryLog` or `Tick` as now-unused, leave them only if still referenced elsewhere in the file; otherwise remove the unused one.)

- [ ] **Step 8: Update the API description text**

In `src/api/server.ts:142`, change the `updateIdentity` line to:

```typescript
          updateIdentity: 'PUT /api/replicant/me/identity  body: { chosenName, background?, personality? }  — set or change your self-chosen name (also available as the set_identity tool)',
```

- [ ] **Step 9: Run the full check**

Run: `npx vitest run test/identity.test.ts` (PASS), then `npx tsc --noEmit` (no new errors; the pre-existing `WorkerLoop.ts` ioredis error is unrelated). Also run `ADMIN_KEY=dev-admin-key npx vitest run test/integration.test.ts` to confirm no regression in the broader suite.

- [ ] **Step 10: Commit**

```bash
git add src/shared/identity.ts src/mcp/tools/identity.tools.ts src/mcp/tools/index.ts src/api/routes/replicant.routes.ts src/api/server.ts test/identity.test.ts
git commit -m "feat: allow replicants to rename via set_identity tool and REST"
```

---

### Task 8: Mark-messages-read capability (advertised)

**Problem:** `read_messages` is a pure read and there is no tool to mark messages read, so unread piles up forever and the HUD keeps flagging it. Replicants never clear it because they can't via tools and nothing tells them to. Fix: add a `markRead` option to `read_messages`, add a standalone `mark_messages_read` tool, and advertise both in the tool descriptions and the REST inbox.

**Files:**
- Modify: `src/mcp/tools/communication.tools.ts` (`read_messages` description + `markRead` param; new `mark_messages_read` tool)
- Modify: `src/api/routes/comms.routes.ts` (`/inbox` `markRead` query)
- Modify: `src/api/server.ts` (inbox API description text — find the `comms`/`inbox` description line)
- Test: `test/mark-read.test.ts`

**Interfaces:**
- Produces: tool `mark_messages_read` with param `messageIds?: string[]`.
- Produces: `read_messages` param `markRead?: boolean`.

- [ ] **Step 1: Write the failing test**

Create `test/mark-read.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant } from './setup.js';
import { Message } from '../src/db/models/index.js';
import { buildToolRegistry } from '../src/tools/registry.js';

async function seedUnread(senderId: string, recipientId: string, subject: string) {
  await Message.create({
    senderId, recipientId, subject, body: 'hi',
    senderPosition: { x: 0, y: 0, z: 0 }, recipientPosition: { x: 0, y: 0, z: 0 },
    distanceAU: 0, sentAtTick: 1, deliverAtTick: 1, delivered: true, read: false,
  });
}

describe('mark messages read', () => {
  let rep: { id: string; apiKey: string; shipId: string };
  let sender: { id: string; apiKey: string; shipId: string };

  beforeAll(async () => {
    await setupTestServer();
    rep = await registerReplicant('Reader');
    sender = await registerReplicant('Sender');
  }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('mark_messages_read marks all delivered unread when no ids given', async () => {
    await seedUnread(sender.id, rep.id, 'A');
    await seedUnread(sender.id, rep.id, 'B');
    const reg = buildToolRegistry(rep.id);
    const out = JSON.parse((await reg.get('mark_messages_read')!.handler({})).content[0].text);
    expect(out.marked).toBe(2);
    const stillUnread = await Message.countDocuments({ recipientId: rep.id, read: false });
    expect(stillUnread).toBe(0);
  });

  it('read_messages with markRead:true marks the returned messages read', async () => {
    await seedUnread(sender.id, rep.id, 'C');
    const reg = buildToolRegistry(rep.id);
    await reg.get('read_messages')!.handler({ markRead: true });
    const stillUnread = await Message.countDocuments({ recipientId: rep.id, read: false });
    expect(stillUnread).toBe(0);
  });

  it('read_messages without markRead does NOT mark read', async () => {
    await seedUnread(sender.id, rep.id, 'D');
    const reg = buildToolRegistry(rep.id);
    await reg.get('read_messages')!.handler({});
    const unread = await Message.countDocuments({ recipientId: rep.id, read: false });
    expect(unread).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/mark-read.test.ts`
Expected: FAIL — `mark_messages_read` tool not found.

- [ ] **Step 3: Add `markRead` to `read_messages` and advertise it**

In `src/mcp/tools/communication.tools.ts`, update the `read_messages` registration. Change the description and add the param:

```typescript
  server.tool(
    'read_messages',
    'Read messages from your inbox (only delivered messages are visible). Messages stay UNREAD (and keep showing in your HUD) until you mark them: pass markRead:true here, or call mark_messages_read.',
    {
      unreadOnly: z.boolean().optional().describe('Only show unread messages'),
      limit: z.number().optional().default(20).describe('Max messages to return'),
      fromReplicantId: z.string().optional().describe('Filter by sender'),
      markRead: z.boolean().optional().describe('If true, mark the returned messages as read'),
    },
    async ({ unreadOnly, limit, fromReplicantId, markRead }) => {
```

Then, immediately before the final `return { content: ... }` of `read_messages`, add the marking step:

```typescript
      if (markRead && messages.length) {
        await Message.updateMany(
          { _id: { $in: messages.map(m => m._id) }, recipientId: replicantId },
          { $set: { read: true } },
        );
      }
```

(Leave the existing `result` array and its `return` unchanged — output shape stays an array.)

- [ ] **Step 4: Add the `mark_messages_read` tool**

In the same file, immediately after the `read_messages` `server.tool(...)` call (before the closing `}` of `registerCommunicationTools`), add:

```typescript
  server.tool(
    'mark_messages_read',
    'Mark inbox messages as read so they stop appearing as unread in your HUD. Pass specific messageIds, or omit to mark ALL your delivered messages read.',
    {
      messageIds: z.array(z.string()).optional().describe('Specific message IDs to mark read; omit to mark all delivered unread'),
    },
    async ({ messageIds }) => {
      const filter: Record<string, unknown> = { recipientId: replicantId, delivered: true, read: false };
      if (messageIds && messageIds.length) filter._id = { $in: messageIds };
      const res = await Message.updateMany(filter, { $set: { read: true } });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ marked: res.modifiedCount, message: `Marked ${res.modifiedCount} message(s) as read.` }, null, 2),
        }],
      };
    },
  );
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/mark-read.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 6: Advertise in the REST inbox**

In `src/api/routes/comms.routes.ts`, in the `GET /inbox` handler, read a `markRead` query param and mark after fetching. Change the destructure (`const { unreadOnly, limit = '50', from } = req.query;`) to include `markRead`, and after `const messages = await Message.find(...)...lean();` add:

```typescript
    if (markRead === 'true' && messages.length) {
      await Message.updateMany(
        { _id: { $in: messages.map(m => m._id) }, recipientId: req.replicantId },
        { $set: { read: true } },
      );
    }
```

In `src/api/server.ts`, find the `comms`/inbox API description object and append a note to the inbox line, e.g. change the inbox entry to mention `?markRead=true` (and that the `mark_messages_read` tool exists). If the comms section lists `inbox: 'GET /api/comms/inbox'`, change it to `inbox: 'GET /api/comms/inbox?unreadOnly=&markRead=  — markRead=true marks fetched messages read (or use the mark_messages_read tool)'`.

- [ ] **Step 7: Full check + commit**

Run: `npx vitest run test/mark-read.test.ts` (PASS), `npx tsc --noEmit` (no new errors), `ADMIN_KEY=dev-admin-key npx vitest run test/integration.test.ts` (no regression).

```bash
git add src/mcp/tools/communication.tools.ts src/api/routes/comms.routes.ts src/api/server.ts test/mark-read.test.ts
git commit -m "feat: let replicants mark messages read (read_messages markRead + mark_messages_read tool)"
```

---

### Task 9: HUD always attaches + state-driven `guidance`

**Problem:** The HUD only attached when "notable", and never told the replicant what to *do*. The user wants guidance on every response. Fix: `buildHud` always returns a HUD (for a valid replicant), add a `guidance: string[]` array of state-driven next-step nudges, and bound the per-call `KnownEntity` query (it now runs on every tool call).

**Files:**
- Modify: `src/tools/hud.ts`
- Test: `test/hud.test.ts` (update the null-gate test)

**Interfaces:**
- Modifies: `Hud` gains `guidance: string[]`.
- `buildHud` still returns `null` only when the replicant is not found; otherwise always a `Hud`.

- [ ] **Step 1: Update the failing test expectations**

In `test/hud.test.ts`, replace the test `it('returns null when nothing is notable', ...)` with:

```typescript
  it('always returns a HUD with vitals and guidance for a valid replicant', async () => {
    const hud = await buildHud(rep.id);
    expect(hud).not.toBeNull();
    expect(hud!.vitals.credits).toBe(500);
    expect(Array.isArray(hud!.guidance)).toBe(true);
  });
```

Add a new test asserting guidance reacts to state:

```typescript
  it('guidance tells the replicant to clear unread messages', async () => {
    const sender = await registerReplicant('GuidanceSender');
    await Message.create({
      senderId: sender.id, recipientId: rep.id, subject: 'Ping', body: 'yo',
      senderPosition: { x: 0, y: 0, z: 0 }, recipientPosition: { x: 0, y: 0, z: 0 },
      distanceAU: 0, sentAtTick: 1, deliverAtTick: 1, delivered: true, read: false,
    });
    const hud = await buildHud(rep.id);
    expect(hud!.guidance.some((g) => /mark_messages_read|unread/i.test(g))).toBe(true);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/hud.test.ts`
Expected: FAIL — `buildHud` returns null when nothing notable (old behavior) and `guidance` does not exist on `Hud`.

- [ ] **Step 3: Add `guidance` to the interface**

In `src/tools/hud.ts`, add to the `Hud` interface (after `warnings`):

```typescript
  guidance: string[];
```

Also extend the imports to include `ResourceStore` (for the cargo check):

```typescript
import { Replicant, Ship, Message, MemoryLog, ActionQueue, KnownEntity, Tick, ResourceStore } from '../db/models/index.js';
```

Add cargo-field constants near the other consts:

```typescript
const CARGO_FIELDS = ['metals','ice','silicates','rareEarths','helium3','organics','hydrogen','uranium','carbon','alloys','fuel','electronics','hullPlating','engines','sensors','computers','weaponSystems','lifeSupportUnits','solarPanels','fusionCores'];
```

- [ ] **Step 4: Bound the KnownEntity query and always-return with guidance**

In `buildHud`, change the nearby-entities query to cap the fetched set (it now runs on every tool call):

```typescript
    const known = await KnownEntity.find({ replicantId, lastKnownPosition: { $ne: null } })
      .sort({ lastUpdatedTick: -1 }).limit(100).lean();
```

(Approximate "nearest" from the 100 most-recently-updated known entities, then sort by distance and take MAX_ITEMS — bounded cost per call.)

Remove the notable-gate early return (the lines):

```typescript
  const notable =
    unreadCount > 0 || events.length > 0 || completed.length > 0 || warnings.length > 0;
  if (!notable) return null;
```

In their place, compute cargo fullness and guidance before the `return`:

```typescript
  // Cargo fullness (single indexed lookup) for guidance.
  let cargoPct = 0;
  if (ship) {
    const store = await ResourceStore.findOne({ 'ownerRef.kind': 'Ship', 'ownerRef.item': ship._id }).lean();
    if (store) {
      const storeAny = store as unknown as Record<string, number>;
      const used = CARGO_FIELDS.reduce((sum, f) => sum + (storeAny[f] || 0), 0);
      cargoPct = ship.specs.cargoCapacity > 0 ? Math.round((used / ship.specs.cargoCapacity) * 100) : 0;
    }
  }

  // State-driven next-step guidance.
  const guidance: string[] = [];
  if (unreadCount > 0) guidance.push(`You have ${unreadCount} unread message(s). Read them with read_messages, then clear them with mark_messages_read (or read_messages markRead:true).`);
  if (ship && fuelPct < FUEL_WARN_PCT) guidance.push('Fuel is low — refuel with transfer_fuel or dock at a settlement.');
  if (ship && hullPct < HULL_WARN_PCT) guidance.push('Hull is damaged — repair_ship when you have alloys and hull plating.');
  if (!replicant.identity?.chosenName) guidance.push('You have not named yourself yet — use set_identity to choose a name.');
  if (ship && cargoPct >= 90) guidance.push('Cargo hold is nearly full — sell at a market with trade, or unload_cargo.');
  if (ship && !ship.miningState?.active && ship.status !== 'in_transit') guidance.push('You are idle — scan_location, start_mining, or set a destination with move_ship.');
```

Add `guidance` to the returned object (after `warnings`):

```typescript
    warnings,
    guidance,
  };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/hud.test.ts`
Expected: PASS (now 7 tests). Then `npx tsc --noEmit` (no new errors).

- [ ] **Step 6: Commit**

```bash
git add src/tools/hud.ts test/hud.test.ts
git commit -m "feat: HUD always attaches and carries state-driven guidance; bound nearby-entity query"
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
