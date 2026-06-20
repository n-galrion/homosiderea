# HUD on Tool Responses + Market Price Glitch Fix

**Date:** 2026-06-20
**Status:** Approved design, pending spec review

## Problem

Two issues addressed together:

1. **Replicants act blind mid-cycle.** When a replicant (e.g. the managed agent GUPPE) calls a tool, it gets only that tool's result. New messages, world events, and changing vitals are invisible until the next think-cycle. The worker (`AgentRunner`) builds its context **once** per cycle and never refreshes it across its 20-round tool loop, so anything that arrives mid-cycle is missed entirely. Replicants should be told about new comms/events/state alongside every result so they act on them.

2. **Market prices have diverged to absurd values** in the running sim (e.g. Shanghai buying `ice` at 4.27×10⁴⁰, `uranium` at 5.28×10⁴², while most resources collapsed to the floor of 1). This breaks the credit economy — a single sale mints astronomical credits.

## Root Cause (price glitch)

`fluctuateMarketPrices` in `src/engine/systems/SettlementBehavior.ts` (runs every 10 ticks) does:

```ts
buyPrices[resource] = Math.max(1, Math.round(buyPrices[resource] * supplyMultiplier * noise * 10) / 10);
sellPrices[resource] = Math.max(1, Math.round(sellPrices[resource] * supplyMultiplier * noise * 10) / 10);
```

This **compounds** the multiplier onto the *stored* price every cycle with no anchor — a multiplicative random walk. A resource held in "crisis" (`supplyMultiplier = 2.0`) doubles roughly every 10 ticks → exponential explosion; one in "surplus" (`0.8`) decays to the floor of 1. The attitude-adjustment block below it has the same compounding flaw. By tick ~500 the data is garbage.

Credits are mutated in exactly one place — `src/mcp/tools/trade.tools.ts` (`buy`: `credits -= totalCost`, `sell`: `credits += totalRevenue`) — so corrupted market prices are the sole source of the credit glitch.

## Part 1 — Price Model Fix

### Anchor to base prices

- Add `basePrices: { buy: Record<string, number>; sell: Record<string, number> }` to the `Market` model (`src/db/models/Market.ts`), mirroring the `prices` shape.
- Populate `basePrices` from the seed values at market creation in `src/db/seeds/settlements.ts` (`Market.create({ ..., basePrices: { buy: seed.market.buy, sell: seed.market.sell } })`). Base = the canonical seed price.

### Recompute, don't compound

Rewrite `fluctuateMarketPrices` so each cycle derives the current price **from base**, never from the previous current value:

```
current = clamp(round1(base × supplyMultiplier × noise), 1, base × PRICE_CAP)
```

- `supplyMultiplier` keeps its existing stockpile-driven tiers (0.8 / 0.9 / 1.0 / 1.5 / 2.0).
- `noise` keeps the ±2% jitter.
- `PRICE_CAP = 4` — a crisis can at most quadruple a base price; floor stays at 1.
- The market-spread guarantee (`sell ≥ buy × 1.3` when they cross) is applied after, on the recomputed values.
- The **attitude adjustment** (hostile settlements charge more / pay less) is applied to the freshly-recomputed current price each cycle. Because we always start from base, attitude no longer compounds either.

Result: price is a bounded function of stockpile + attitude + small noise. Drift is impossible.

### Repair live data

One-off script (`scripts/repair-market-prices.ts`, runnable via `npx tsx` / `node`):

- For each `Market`, look up canonical buy/sell from the exported seed table (matched by settlement name).
- Set `market.basePrices` to those canonical values and reset `market.prices` to the same (a clean re-anchor; the next fluctuation tick will apply supply/attitude).
- Log per-market before/after for verification.

The seed array in `settlements.ts` must be exported so the repair script and tests can import the canonical table without re-seeding.

## Part 2 — HUD on Tool Responses

### Injection point

Both transports register tools through `registerAllTools(serverLike, replicantId)`:
- **MCP:** `createGameServer` in `src/mcp/server.ts` passes a real `McpServer`.
- **REST:** `buildToolRegistry` in `src/tools/registry.ts` passes a `ToolCapture` proxy.

A single helper wraps the server-like object's `.tool()` method so every registered handler is decorated once — covering all ~65 tools and both transports with zero per-tool edits.

```ts
// src/tools/hud.ts
export function withHud<T extends { tool: Function }>(target: T, replicantId: string): T
```

`withHud` rebinds `target.tool(name, desc, schema, handler)` to register a wrapped handler:

```
const result = await handler(params);
return await attachHud(result, replicantId);
```

Apply it at both call sites: wrap `server` in `createGameServer`, and wrap the `ToolCapture` instance in `buildToolRegistry`, before passing to `registerAllTools`. `getToolDefinitions` (metadata only) is left unwrapped.

### attachHud

```ts
// src/tools/hud.ts
async function buildHud(replicantId: string): Promise<Hud | null>
async function attachHud(result: McpResult, replicantId: string): Promise<McpResult>
```

- `buildHud` gathers the full situational payload (below). It performs **only reads** — it never marks messages read or mutates state, so it is idempotent and safe on every tool call.
- "Notable" gate: HUD is attached **only when** at least one of these is true — unread messages exist, a recent world event exists, a vitals warning fires, or a queued action just completed. When nothing is notable, the result is returned unchanged (keeps quiet reads lean).
- `attachHud` parses the result's `content[0].text`. If it's JSON, it merges a `_hud` field into the object and re-stringifies. If it's a plain-text result, it appends a `\n\n--- HUD ---\n<json>` block. Errors in HUD building are swallowed (HUD must never break a tool call).

### HUD payload (full situational)

```ts
interface Hud {
  tick: number;
  vitals: {
    credits: number;
    fuelPct: number;      // ship fuel / capacity
    hullPct: number;      // ship hull / max
    location: string;     // orbiting body name or coords
    status: string;       // ship status
  };
  unreadMessages: {
    count: number;
    items: Array<{ from: string; subject: string; tick: number }>;  // capped (e.g. 5 most recent)
  };
  recentEvents: Array<{ title: string; tick: number; category: string }>;  // notable MemoryLogs in last N ticks
  nearbyEntities: Array<{ name: string; kind: string; distanceAU: number }>;
  activeOps: { mining?: string; fabrication?: string };  // in-progress operations
  completedActions: Array<{ action: string; tick: number }>;  // ActionQueue resolved since recently
  warnings: string[];  // derived: "Fuel below 15%", "Hull below 25%", etc.
}
```

Data sources: `Replicant` (credits), `Ship` (fuel/hull/status/position), `Message` (delivered && !read for recipient), `MemoryLog` (recent notable categories), `ActionQueue` (recently resolved), nearby entities via existing scan/known-entity data. "Recent" window for events/actions = a small fixed number of ticks (e.g. last 3) — stateless, no per-replicant cursor.

### Worker nudge

Add one line to `AgentRunner.buildSystemPrompt()` (`src/worker/AgentRunner.ts`) instructing the agent: tool results may include a `_hud` field reporting new messages, events, and vitals — watch it and react to anything new. The `_hud` field already flows to the LLM unchanged because the worker passes raw tool results back as tool messages.

## Components & Boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `src/tools/hud.ts` | Build HUD + decorate tool handlers | DB models (read-only) |
| `Market` model + `SettlementBehavior` | Base-anchored price model | seed base prices |
| `scripts/repair-market-prices.ts` | Re-anchor corrupted live prices | exported seed table |
| `createGameServer` / `buildToolRegistry` | Apply `withHud` wrapper | `hud.ts` |
| `AgentRunner` | Tell agents to read `_hud` | prompt string only |

## Testing

- **Price model:** unit test `fluctuateMarketPrices` — drive a market through many cycles under sustained crisis and sustained surplus; assert prices stay within `[1, base × PRICE_CAP]` and never diverge. Assert recompute-from-base (a one-off crisis tick doesn't permanently shift the price once stockpile recovers).
- **HUD:** test `buildHud`/`attachHud` — unread message present ⇒ `_hud` attached with correct count; nothing notable ⇒ result unchanged; JSON result gets `_hud` merged; plain-text result gets a text block; HUD never mutates message read state.
- **Wrapper:** a wrapped tool returns the original payload plus `_hud` when notable; an unwrapped `getToolDefinitions` is unaffected.
- **Repair script:** run against a seeded test DB with deliberately corrupted prices; assert all markets reset to base.
- Existing tests (`test/`) must continue to pass (`mongodb-memory-server`, single fork).

## Non-Goals

- No change to the trade tool's credit math (it's correct; only its price inputs were bad).
- No per-replicant HUD cursor / "seen" tracking — recency window is stateless and good enough.
- No tax-rate change (the unused `market.restrictions.taxRate` is out of scope).
