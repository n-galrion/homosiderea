# Settlement Simulation Engine — Design Spec

## Context

Settlements currently have production/consumption numbers that only affect market pricing. There's no actual resource flow — Shanghai doesn't actually consume metals or produce electronics. NPC ships move randomly. Pirates spawn and attack but have no economic motivation. The MC generates narrative events but the world has no mechanical underpinning.

This spec adds a 4X simulation layer where settlements are real economies, NPCs act on goals, and the MC sets strategic direction.

## Core Concept

Each tick, every settlement:
1. **Consumes** input resources from its stockpile
2. **Produces** output resources based on available inputs + industrial capacity
3. **Grows or shrinks** population based on whether needs are met
4. **Dispatches NPCs** to acquire missing resources
5. **Updates prices** based on actual surplus/deficit

The MC doesn't micromanage — it sets faction-level goals ("Pacific Commerce Alliance prioritizes rare earth acquisition"). A deterministic AI layer executes those goals through NPC behavior.

## 1. Settlement Stockpile

Each settlement gets a ResourceStore (already supported — `ownerRef.kind: 'Settlement'`).

On first boot / seed, each settlement's stockpile is initialized based on their production:
- 100 ticks worth of their production outputs (starting surplus)
- 50 ticks worth of their consumption inputs (starting buffer)

Each tick:
```
for each resource in settlement.consumption:
  consume min(consumption_rate, stockpile[resource])
  if stockpile[resource] < consumption_rate * 10:  // running low
    mark as DEFICIT

for each resource in settlement.production:
  if all input resources available:
    produce at full rate
  else:
    produce at reduced rate (proportional to missing inputs)
  add to stockpile
```

## 2. Population Mechanics

Population is driven by resource satisfaction:
- **Food** (organics): required. 1 unit per 10,000 population per tick.
- **Energy**: required. 1 unit per 5,000 population per tick.
- **Water** (ice): required for growth. Not lethal if missing.

Each tick:
```
foodNeeded = population / 10000
energyNeeded = population / 5000

if stockpile.organics >= foodNeeded AND stockpile.energy >= energyNeeded:
  // Needs met — small growth
  population *= 1.0001  (0.01% per tick)
  if stockpile.ice > 0:
    population *= 1.0001  // bonus growth with water
else:
  // Needs NOT met — decline
  if organics < foodNeeded:
    population *= 0.9999  // starvation
  if energy < energyNeeded:
    population *= 0.9998  // infrastructure collapse
```

Population affects:
- Industrial capacity (more workers = more production, up to a cap)
- Market demand (bigger population = more consumption)
- Military strength (proportional to population)
- Tax revenue → credits flowing to the settlement's faction

## 3. Buildings

Settlements already have a `type` and `economy.industrialCapacity`. For v1, we don't need individual building models — we derive capability from the settlement's type and economy stats:

- `industrialCapacity` = how many production units run per tick
- `techLevel` = efficiency multiplier (higher tech = more output per input)
- `spaceportLevel` = how many NPC ships can be dispatched

Future: individual building models within settlements (factories, farms, power plants). For now, aggregate stats are enough.

## 4. NPC Dispatch AI

Each settlement has an NPC controller that runs each tick:

```
for each DEFICIT resource:
  if no ship already dispatched for this resource:
    find nearest settlement that PRODUCES this resource (has surplus)
    dispatch a freighter to buy it
    
for each SURPLUS resource (stockpile > 200 ticks of production):
  if no ship already dispatched to sell:
    find settlement with highest buy price for this resource
    dispatch a freighter to sell it
```

This replaces the random NPC movement with goal-driven behavior. Freighters travel trade routes because settlements actually need things.

## 5. Pirate Economics

Pirates also get goals:
- They patrol trade routes (paths between settlements with high traffic)
- They target freighters carrying valuable cargo
- They sell stolen goods at black markets (or to settlements with low attitude)
- Pirate bases can be discovered in the asteroid belt

For v1: pirates target the highest-value NPC freighters in their sensor range and try to intercept.

## 6. Price Feedback Loop

Market prices are now driven by actual stockpile levels:
```
for each resource:
  if stockpile > 100 ticks of consumption: // surplus
    buy_price decreases (they don't need it)
    sell_price decreases (they'll dump it)
  if stockpile < 20 ticks of consumption: // deficit
    buy_price increases (they're desperate)
    sell_price increases (they're hoarding)
  if stockpile < 5 ticks of consumption: // crisis
    buy_price spikes dramatically
    settlement may broadcast distress
```

This creates real opportunities for replicants: find a settlement in crisis, deliver what they need, profit.

## 7. MC as Strategic Director

The MC (LLM) no longer makes tactical decisions. Instead, every ~50 ticks it:
- Reviews faction-level resource balances
- Sets faction priorities ("Pacific Commerce needs rare earths — authorize price increase")
- Triggers political events based on actual economic state ("Ares Colony running low on fuel — Mars Independence Movement negotiates emergency trade agreement")
- Adjusts faction policies that NPCs follow

The deterministic AI handles execution. The MC provides narrative context and strategic shifts.

## 8. Implementation Phases

### Phase A: Settlement Stockpiles + Consumption/Production
- Initialize stockpiles in seed data
- Add consumption/production tick phase
- Population growth/decline from resource satisfaction

### Phase B: Price Feedback
- Replace random walk pricing with stockpile-driven pricing
- Keep random noise as ±2% on top of fundamentals

### Phase C: Goal-Driven NPC Dispatch
- NPC controller reads deficits/surpluses
- Dispatches freighters with specific cargo missions
- Freighters buy at source, travel, sell at destination

### Phase D: Pirate Targeting
- Pirates read NPC traffic patterns
- Target high-value freighters
- Intercept and steal cargo

### Phase E: MC Strategic Layer
- MC reviews economic state
- Sets faction priorities via tool calls
- Generates narrative events from actual economic conditions

## Files to Create/Modify
- `src/engine/systems/SettlementEconomy.ts` — NEW: consumption, production, population, stockpile management
- `src/engine/systems/NPCDispatch.ts` — NEW: goal-driven NPC freighter dispatch (replaces random movement in NPCTraffic.ts)
- `src/engine/systems/SettlementBehavior.ts` — MODIFY: price fluctuation uses stockpile data
- `src/engine/systems/PirateActivity.ts` — MODIFY: target high-value trade routes
- `src/engine/systems/MCWorldSimulator.ts` — MODIFY: MC reads economic state, sets faction priorities
- `src/engine/TickProcessor.ts` — MODIFY: add settlement economy phase
- `src/db/seeds/settlements.ts` — MODIFY: initialize stockpiles
