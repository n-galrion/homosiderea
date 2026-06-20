# Coordinate & Target-Based Navigation

**Date:** 2026-06-20
**Status:** Approved design, pending spec review

## Problem

The navigation interface only accepts a registered `destinationBodyId`. But the game world (and the new MC console) generates coordinate-based points of interest — distress beacons at a bearing/range, anomalies like "The Ghost" (a nickel-iron object at 0.08 AU from Earth), derelicts, salvage fields, and uncharted asteroids. Replicants physically cannot navigate to any of these. Live-sim logs show a replicant trying to `propose_action` to patch its own nav computer to accept x,y,z. The ship's propulsion already supports flying to any point — the limitation is purely the navigation *input format*. This also silently blocks `salvage` collection and asteroid mining at scanned locations.

## Key finding

The lower layers already support coordinate destinations:
- `Movement.ts` interpolates in-transit position from `nav.destinationPos` and, on arrival, can set `ship.position` from `destinationPos`; it sets `orbitingBodyId = nav.destinationBodyId ?? null`.
- `MoveAction.ts` already writes `destinationPos` onto the ship's navigation.

The ONLY blockers are input validation: `move_ship`/`calculate_route` (`navigation.tools.ts`) require `destinationBodyId`, and `MoveAction.ts` throws if it's missing. Plus, arrival doesn't set `orbitingAsteroidId`, so navigating to an asteroid wouldn't enable mining.

## Decisions (from brainstorming)

- Accept conveniences (`asteroidId`, `salvageId`) in addition to raw `destinationPos {x,y,z}` and the existing `destinationBodyId`.
- Validation: shape (3 finite numbers) + sane Sol-system bounds (~60 AU radius). Fuel cost already self-limits realistic distance.
- Arrival semantics made meaningful: body → orbit (as today); asteroid → set `orbitingAsteroidId` so you can mine it; salvage/raw coords → free-floating at the point (both null).

## Architecture

### Input & resolution
`move_ship` and `calculate_route` accept **exactly one** of:
- `destinationBodyId` — registered celestial body (existing behavior)
- `asteroidId` — resolves to the asteroid's position
- `salvageId` — resolves to the salvage's position
- `destinationPos: { x, y, z }` — raw coordinates

A shared resolver in `navigation.tools.ts`:

```
resolveDestination(input) -> { ok: true, pos, bodyId?, asteroidId?, label } | { ok: false, error }
```

- Enforces exactly-one-input (clear error on zero or multiple).
- Looks up the asteroid/salvage/body and extracts its `position`.
- Validates the resulting position: each of x,y,z is a finite number; `sqrt(x²+y²+z²) <= MAX_NAV_RADIUS_AU` (60). Returns a clear error otherwise.
- Returns `bodyId` only for the body case and `asteroidId` only for the asteroid case (used to set orbit on arrival).

Both `move_ship` and `calculate_route` call it, then compute `distance`/`travelTimeTicks`/`fuelCost` from `pos` exactly as today.

### MoveAction (resolver/executor)
`MoveAction.ts` no longer requires `destinationBodyId`. It accepts the queued params which now always include `destinationPos` and optionally `destinationBodyId` / `destinationAsteroidId`. It sets the ship's `navigation.destinationPos` (already done) and threads `destinationBodyId`/`destinationAsteroidId` for arrival. If a body id is present it may still load the body for naming/logging, but a body is no longer mandatory.

### Movement (arrival)
On arrival, `Movement.ts` sets `ship.position = nav.destinationPos`, and:
- `ship.orbitingBodyId = nav.destinationBodyId ?? null`
- `ship.orbitingAsteroidId = nav.destinationAsteroidId ?? null`  ← new

So: body → orbiting body (orbit/trade); asteroid → orbiting asteroid (`start_mining` works); salvage/raw → both null (positioned at the point to `collect_salvage`, hail, etc.). The `navigation` reset on arrival clears `destinationBodyId`, `destinationPos`, and (new) `destinationAsteroidId`.

### Ship.navigation schema
Add `destinationAsteroidId: ObjectId | null` to the ship's `navigation` sub-document (alongside the existing `destinationBodyId`/`destinationPos`) so arrival can set `orbitingAsteroidId`.

### calculate_route
Same resolution and validation; returns `from`, `to` (the resolved label), `distanceAU`, `travelTicks`, `fuelRequired`, `fuelAvailable`, `feasible`, plus the existing next-step hint — for any of the four input forms.

## Components

| Unit | Change |
|------|--------|
| `src/mcp/tools/navigation.tools.ts` | `resolveDestination` helper + `MAX_NAV_RADIUS_AU`; `move_ship` & `calculate_route` accept the 4 input forms with validation; queue `destinationPos` (+ optional body/asteroid id) |
| `src/engine/actions/MoveAction.ts` | accept resolved destination; no longer require `destinationBodyId`; persist `destinationPos` + optional `destinationBodyId`/`destinationAsteroidId` |
| `src/engine/systems/Movement.ts` | arrival sets `orbitingAsteroidId` from `nav.destinationAsteroidId`; clears it on nav reset |
| `src/db/models/Ship.ts` | add `navigation.destinationAsteroidId` |

## Error handling

- Zero inputs → "Provide a destination: destinationBodyId, asteroidId, salvageId, or destinationPos {x,y,z}."
- Multiple inputs → "Provide exactly one destination input."
- Unknown asteroid/salvage/body id → "<kind> not found."
- Bad position (non-finite, or beyond ~60 AU) → clear error naming the bound.
- Insufficient fuel → existing error (unchanged).
- These are returned as normal tool error results; nothing throws out of the tool. `MoveAction` (queue executor) validates the same and throws `InvalidActionError` only as a backstop for malformed queued params.

## Testing

- `resolveDestination` (pure-ish, DB-backed): each input form returns the right position; exactly-one enforcement; non-finite and out-of-bounds rejected; unknown ids rejected.
- `move_ship`: queues a move with `destinationPos` for raw coords (no body) without error; queues with `destinationAsteroidId` for an asteroid; rejects bad/zero/multiple inputs.
- `calculate_route`: returns feasibility + distance for a raw `destinationPos`.
- `MoveAction`: resolves a position-only queued move without throwing; sets `navigation.destinationPos`.
- `Movement` arrival: raw coords → ship at the point, `orbitingBodyId` and `orbitingAsteroidId` both null; asteroid → `orbitingAsteroidId` set (so `start_mining` is valid); body → unchanged (orbits the body).
- Existing navigation/movement tests continue to pass.

## Non-goals

- Comms to a coordinate/bearing (the "transmit toward the beacon" gap) — separate follow-up.
- Auto-pathfinding or multi-leg routes.
- Changing fuel/time physics — identical formulas, just a coordinate input.
- A generic `knownEntityId` resolver — `asteroidId`/`salvageId` + raw `destinationPos` cover the discoverable coordinate objects; raw coords handle anomalies/beacons/derelicts.
