# Coordinate & Target-Based Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let replicants navigate to raw coordinates, asteroids, and salvage — not just registered celestial bodies — and make arriving at an asteroid enable mining.

**Architecture:** A shared `resolveDestination` helper in the navigation tools turns any of four destination inputs into a position (+ optional body/asteroid id). `move_ship`/`calculate_route` use it; the queued move carries `destinationPos` (+ optional ids); `MoveAction` no longer requires a body; `Movement` arrival sets `orbitingAsteroidId` so a ship that flew to an asteroid can mine it.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Mongoose, MCP tools, vitest + mongodb-memory-server.

## Global Constraints

- **ESM only** — all local imports use `.js` extensions.
- Work on `main` (no feature branch). Commit only the files each task names — the working tree may carry unrelated WIP; never `git add -A`. Never rewrite git history.
- Type-check: `npx tsc --noEmit` (a pre-existing `src/worker/WorkerLoop.ts` ioredis error is unrelated; ignore it).
- Run a test file: `npx vitest run test/<file>.test.ts`. Full suite needs `ADMIN_KEY=dev-admin-key`.
- Physics is unchanged — reuse `distance`, `travelTimeTicks`, `fuelCost` from `src/shared/physics.js`.
- `MAX_NAV_RADIUS_AU = 60`. A destination position is valid iff x,y,z are all finite and `sqrt(x²+y²+z²) <= 60`.
- **Shared queued-move param contract** (produced by `move_ship`, consumed by `MoveAction.handleMove`):
  `{ shipId: string, destinationPos: {x,y,z}, destinationBodyId?: string, destinationAsteroidId?: string, dist?: number, travelTicks?: number, fuelCost?: number }`. `destinationPos` is always present; at most one of body/asteroid id.

---

### Task 1: Add `navigation.destinationAsteroidId` to the Ship model

**Files:**
- Modify: `src/db/models/Ship.ts` (interface ~line 13-20; schema ~line 71-84)
- Test: `test/coordinate-nav.test.ts`

**Interfaces:**
- Produces: `Ship.navigation.destinationAsteroidId: Types.ObjectId | null`

- [ ] **Step 1: Write the failing test**

Create `test/coordinate-nav.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant } from './setup.js';
import { Ship } from '../src/db/models/index.js';

describe('Ship.navigation.destinationAsteroidId', () => {
  let rep: { id: string; apiKey: string; shipId: string };
  beforeAll(async () => { await setupTestServer(); rep = await registerReplicant('NavSchemaTester'); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('persists a destinationAsteroidId on navigation', async () => {
    const ship = await Ship.findById(rep.shipId);
    const fakeId = '64b9f0000000000000000abc';
    ship!.navigation.destinationAsteroidId = fakeId as never;
    await ship!.save();
    const reloaded = await Ship.findById(rep.shipId);
    expect(reloaded!.navigation.destinationAsteroidId!.toString()).toBe(fakeId);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/coordinate-nav.test.ts`
Expected: FAIL — `destinationAsteroidId` not in schema (TS error or value not persisted).

- [ ] **Step 3: Add the field**

In `src/db/models/Ship.ts`, in the `navigation` block of the `IShip` interface (after `destinationBodyId: Types.ObjectId | null;`):

```typescript
    destinationAsteroidId: Types.ObjectId | null;
```

In the `ShipSchema` `navigation` block (after the `destinationBodyId` line ~72):

```typescript
    destinationAsteroidId: { type: Schema.Types.ObjectId, ref: 'Asteroid', default: null },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/coordinate-nav.test.ts`
Expected: PASS. Then `npx tsc --noEmit` — no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/db/models/Ship.ts test/coordinate-nav.test.ts
git commit -m "feat: add navigation.destinationAsteroidId to Ship model"
```

---

### Task 2: `resolveDestination` helper + `move_ship` accepts coords/asteroid/salvage

**Files:**
- Modify: `src/mcp/tools/navigation.tools.ts` (imports; add helper; rewrite `move_ship`)
- Test: `test/coordinate-nav.test.ts` (extend)

**Interfaces:**
- Produces: `MAX_NAV_RADIUS_AU = 60`
- Produces: `export async function resolveDestination(input: { destinationBodyId?: string; asteroidId?: string; salvageId?: string; destinationPos?: { x: number; y: number; z: number } }): Promise<{ ok: true; pos: { x: number; y: number; z: number }; bodyId?: string; asteroidId?: string; label: string } | { ok: false; error: string }>`
- Produces: `move_ship` queues the param contract from Global Constraints.

- [ ] **Step 1: Write the failing tests**

Append to `test/coordinate-nav.test.ts`:

```typescript
import { buildToolRegistry } from '../src/tools/registry.js';
import { ActionQueue, Asteroid, CelestialBody } from '../src/db/models/index.js';

describe('move_ship destinations', () => {
  let rep: { id: string; apiKey: string; shipId: string };
  beforeAll(async () => { await setupTestServer(); rep = await registerReplicant('MoveTester'); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('queues a move to raw coordinates (no body)', async () => {
    const reg = buildToolRegistry(rep.id);
    const out = JSON.parse((await reg.get('move_ship')!.handler({ shipId: rep.shipId, destinationPos: { x: 1.2, y: 0.3, z: 0 } })).content[0].text);
    expect(out.action).toBe('move');
    const action = await ActionQueue.findById(out.actionId);
    expect(action!.params.destinationPos).toEqual({ x: 1.2, y: 0.3, z: 0 });
    expect(action!.params.destinationBodyId).toBeFalsy();
  });

  it('queues a move to an asteroid (carries destinationAsteroidId)', async () => {
    const belt = await CelestialBody.findOne();
    const asteroid = await Asteroid.create({ name: 'TestRock-1', beltZoneId: belt!._id, position: { x: 2.6, y: 0.1, z: 0 } });
    const reg = buildToolRegistry(rep.id);
    const out = JSON.parse((await reg.get('move_ship')!.handler({ shipId: rep.shipId, asteroidId: asteroid._id.toString() })).content[0].text);
    const action = await ActionQueue.findById(out.actionId);
    expect(action!.params.destinationAsteroidId).toBe(asteroid._id.toString());
    expect(action!.params.destinationPos).toEqual({ x: 2.6, y: 0.1, z: 0 });
  });

  it('rejects zero or multiple destination inputs', async () => {
    const reg = buildToolRegistry(rep.id);
    const none = (await reg.get('move_ship')!.handler({ shipId: rep.shipId })).content[0].text;
    expect(none.toLowerCase()).toContain('destination');
    const multi = (await reg.get('move_ship')!.handler({ shipId: rep.shipId, destinationBodyId: 'x', destinationPos: { x: 1, y: 0, z: 0 } })).content[0].text;
    expect(multi.toLowerCase()).toContain('exactly one');
  });

  it('rejects an out-of-bounds position', async () => {
    const reg = buildToolRegistry(rep.id);
    const out = (await reg.get('move_ship')!.handler({ shipId: rep.shipId, destinationPos: { x: 9000, y: 0, z: 0 } })).content[0].text;
    expect(out).toMatch(/60|range|bounds/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/coordinate-nav.test.ts`
Expected: FAIL — `move_ship` doesn't accept `destinationPos`/`asteroidId`.

- [ ] **Step 3: Add imports + the resolver**

In `src/mcp/tools/navigation.tools.ts`, extend the model import (currently `Ship, CelestialBody, Replicant, ActionQueue, Tick`) to add `Asteroid, Salvage`:

```typescript
import { Ship, CelestialBody, Replicant, ActionQueue, Tick, Asteroid, Salvage } from '../../db/models/index.js';
```

Add near the top of the file (after imports, before `registerNavigationTools`):

```typescript
export const MAX_NAV_RADIUS_AU = 60;

type Vec = { x: number; y: number; z: number };
function isValidPos(p: Vec | undefined | null): p is Vec {
  if (!p) return false;
  const { x, y, z } = p;
  if (![x, y, z].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  return Math.sqrt(x * x + y * y + z * z) <= MAX_NAV_RADIUS_AU;
}

interface DestinationInput {
  destinationBodyId?: string;
  asteroidId?: string;
  salvageId?: string;
  destinationPos?: Vec;
}

/**
 * Resolve one of {destinationBodyId, asteroidId, salvageId, destinationPos} to a
 * target position (+ the body/asteroid id when applicable). Enforces exactly-one
 * input and validates the resulting position (finite, within MAX_NAV_RADIUS_AU).
 */
export async function resolveDestination(
  input: DestinationInput,
): Promise<{ ok: true; pos: Vec; bodyId?: string; asteroidId?: string; label: string } | { ok: false; error: string }> {
  const provided = [input.destinationBodyId, input.asteroidId, input.salvageId, input.destinationPos].filter((v) => v != null);
  if (provided.length === 0) {
    return { ok: false, error: 'Provide a destination: destinationBodyId, asteroidId, salvageId, or destinationPos {x,y,z}.' };
  }
  if (provided.length > 1) {
    return { ok: false, error: 'Provide exactly one destination input (body, asteroid, salvage, or coordinates).' };
  }

  let pos: Vec | undefined;
  let bodyId: string | undefined;
  let asteroidId: string | undefined;
  let label: string;

  if (input.destinationBodyId) {
    const body = await CelestialBody.findById(input.destinationBodyId).lean();
    if (!body) return { ok: false, error: 'Destination body not found.' };
    pos = body.position; bodyId = body._id.toString(); label = body.name;
  } else if (input.asteroidId) {
    const ast = await Asteroid.findById(input.asteroidId).lean();
    if (!ast) return { ok: false, error: 'Asteroid not found.' };
    pos = ast.position; asteroidId = ast._id.toString(); label = ast.name;
  } else if (input.salvageId) {
    const sal = await Salvage.findById(input.salvageId).lean();
    if (!sal) return { ok: false, error: 'Salvage not found.' };
    pos = sal.position; label = sal.name;
  } else {
    pos = input.destinationPos; label = `(${pos!.x}, ${pos!.y}, ${pos!.z})`;
  }

  if (!isValidPos(pos)) {
    return { ok: false, error: `Invalid destination position: coordinates must be finite and within ${MAX_NAV_RADIUS_AU} AU of origin.` };
  }
  return { ok: true, pos, bodyId, asteroidId, label };
}
```

- [ ] **Step 4: Rewrite `move_ship`**

Replace the `move_ship` `server.tool(...)` registration (the whole call, current lines ~8-67) with:

```typescript
  server.tool(
    'move_ship',
    'Command one of your ships to travel to a destination. Provide exactly one of: destinationBodyId (a registered body), asteroidId, salvageId, or destinationPos {x,y,z} for raw coordinates (beacons, anomalies, derelicts). The ship will be in transit until arrival.',
    {
      shipId: z.string().describe('ID of the ship to move'),
      destinationBodyId: z.string().optional().describe('A registered celestial body'),
      asteroidId: z.string().optional().describe('An asteroid to fly to (enables mining on arrival)'),
      salvageId: z.string().optional().describe('A salvage field to fly to'),
      destinationPos: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional().describe('Raw coordinates {x,y,z} in AU'),
    },
    async ({ shipId, destinationBodyId, asteroidId, salvageId, destinationPos }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) return { content: [{ type: 'text', text: 'Error: Ship not found or not owned by you.' }] };
      if (ship.status === 'in_transit') return { content: [{ type: 'text', text: 'Error: Ship is already in transit.' }] };
      if (ship.status === 'destroyed') return { content: [{ type: 'text', text: 'Error: Ship is destroyed.' }] };

      const dest = await resolveDestination({ destinationBodyId, asteroidId, salvageId, destinationPos });
      if (!dest.ok) return { content: [{ type: 'text', text: `Error: ${dest.error}` }] };

      const dist = distance(ship.position, dest.pos);
      const travelTicks = travelTimeTicks(ship.position, dest.pos, ship.specs.maxSpeed);
      const fuel = fuelCost(dist);
      if (ship.fuel < fuel) {
        return { content: [{ type: 'text', text: `Error: Insufficient fuel. Need ${fuel}, have ${ship.fuel}.` }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      const action = await ActionQueue.create({
        replicantId,
        type: 'move',
        params: {
          shipId,
          destinationPos: dest.pos,
          ...(dest.bodyId ? { destinationBodyId: dest.bodyId } : {}),
          ...(dest.asteroidId ? { destinationAsteroidId: dest.asteroidId } : {}),
          dist, travelTicks, fuelCost: fuel,
        },
        queuedAtTick: currentTick,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            action: 'move',
            actionId: action._id.toString(),
            ship: ship.name,
            destination: dest.label,
            distanceAU: parseFloat(dist.toFixed(6)),
            estimatedTravelTicks: travelTicks,
            fuelCost: fuel,
            estimatedArrivalTick: currentTick + travelTicks,
            message: `${ship.name} will depart for ${dest.label} on next tick.`,
          }, null, 2),
        }],
      };
    },
  );
```

- [ ] **Step 5: Run tests + type-check**

Run: `npx vitest run test/coordinate-nav.test.ts` → PASS. `npx tsc --noEmit` → no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/navigation.tools.ts test/coordinate-nav.test.ts
git commit -m "feat: move_ship accepts coordinates, asteroid, and salvage destinations"
```

---

### Task 3: `calculate_route` accepts coords/asteroid/salvage

**Files:**
- Modify: `src/mcp/tools/navigation.tools.ts` (rewrite `calculate_route`)
- Test: `test/coordinate-nav.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveDestination` (Task 2).

- [ ] **Step 1: Write the failing test**

Append to `test/coordinate-nav.test.ts`:

```typescript
describe('calculate_route destinations', () => {
  let rep: { id: string; apiKey: string; shipId: string };
  beforeAll(async () => { await setupTestServer(); rep = await registerReplicant('RouteTester'); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('computes a route to raw coordinates', async () => {
    const reg = buildToolRegistry(rep.id);
    const out = JSON.parse((await reg.get('calculate_route')!.handler({ shipId: rep.shipId, destinationPos: { x: 1.5, y: 0, z: 0 } })).content[0].text);
    expect(out.to).toContain('1.5');
    expect(typeof out.distanceAU).toBe('number');
    expect(typeof out.feasible).toBe('boolean');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/coordinate-nav.test.ts`
Expected: FAIL — `calculate_route` rejects/ignores `destinationPos`.

- [ ] **Step 3: Rewrite `calculate_route`**

Replace the `calculate_route` `server.tool(...)` registration (current lines ~70-106) with:

```typescript
  server.tool(
    'calculate_route',
    'Preview a trip: distance, fuel, and travel time to a destination. Provide exactly one of destinationBodyId, asteroidId, salvageId, or destinationPos {x,y,z}.',
    {
      shipId: z.string().describe('ID of the ship'),
      destinationBodyId: z.string().optional(),
      asteroidId: z.string().optional(),
      salvageId: z.string().optional(),
      destinationPos: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
    },
    async ({ shipId, destinationBodyId, asteroidId, salvageId, destinationPos }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) return { content: [{ type: 'text', text: 'Error: Ship not found or not owned by you.' }] };

      const dest = await resolveDestination({ destinationBodyId, asteroidId, salvageId, destinationPos });
      if (!dest.ok) return { content: [{ type: 'text', text: `Error: ${dest.error}` }] };

      const dist = distance(ship.position, dest.pos);
      const travelTicks = travelTimeTicks(ship.position, dest.pos, ship.specs.maxSpeed);
      const fuel = fuelCost(dist);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            from: ship.name,
            to: dest.label,
            distanceAU: parseFloat(dist.toFixed(6)),
            travelTicks,
            fuelRequired: fuel,
            fuelAvailable: ship.fuel,
            feasible: ship.fuel >= fuel,
            shipSpeed: ship.specs.maxSpeed,
            hint: ship.fuel >= fuel
              ? 'Feasible — commit the trip with move_ship to this destination.'
              : 'Not enough fuel — refuel with transfer_fuel or pick a closer destination.',
          }, null, 2),
        }],
      };
    },
  );
```

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run test/coordinate-nav.test.ts` → PASS. `npx tsc --noEmit` → no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/navigation.tools.ts test/coordinate-nav.test.ts
git commit -m "feat: calculate_route accepts coordinate and target destinations"
```

---

### Task 4: `MoveAction` accepts a resolved position (no body required)

**Files:**
- Modify: `src/engine/actions/MoveAction.ts`
- Test: `test/coordinate-nav.test.ts` (extend)

**Interfaces:**
- Consumes: the queued-move param contract (Global Constraints).
- Produces: a ship in transit with `navigation.destinationPos` set and `navigation.destinationAsteroidId` when applicable.

- [ ] **Step 1: Write the failing test**

Append to `test/coordinate-nav.test.ts`:

```typescript
import { handleMove } from '../src/engine/actions/MoveAction.js';

describe('handleMove with a position destination', () => {
  let rep: { id: string; apiKey: string; shipId: string };
  beforeAll(async () => { await setupTestServer(); rep = await registerReplicant('HandleMoveTester'); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('moves to raw coordinates without requiring a body', async () => {
    const fakeAction = {
      replicantId: rep.id,
      params: { shipId: rep.shipId, destinationPos: { x: 1.1, y: 0.2, z: 0 } },
    } as never;
    const result = await handleMove(fakeAction, 10);
    expect(result.shipId).toBe(rep.shipId);
    const ship = await Ship.findById(rep.shipId);
    expect(ship!.status).toBe('in_transit');
    expect(ship!.navigation.destinationPos).toEqual({ x: 1.1, y: 0.2, z: 0 });
    expect(ship!.navigation.destinationBodyId).toBeNull();
  });

  it('carries destinationAsteroidId into navigation', async () => {
    const rep2 = await registerReplicant('HandleMoveAsteroid');
    const action = {
      replicantId: rep2.id,
      params: { shipId: rep2.shipId, destinationPos: { x: 2.5, y: 0, z: 0 }, destinationAsteroidId: '64b9f0000000000000000abc' },
    } as never;
    await handleMove(action, 10);
    const ship = await Ship.findById(rep2.shipId);
    expect(ship!.navigation.destinationAsteroidId!.toString()).toBe('64b9f0000000000000000abc');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/coordinate-nav.test.ts`
Expected: FAIL — `handleMove` throws "Missing destinationBodyId".

- [ ] **Step 3: Rewrite `handleMove`**

Replace `src/engine/actions/MoveAction.ts` lines 9-86 (the body of `handleMove`) with:

```typescript
export async function handleMove(action: IActionQueue, tick: number): Promise<Record<string, unknown>> {
  const { shipId, destinationBodyId, destinationAsteroidId, destinationPos } = action.params as {
    shipId?: string;
    destinationBodyId?: string;
    destinationAsteroidId?: string;
    destinationPos?: { x: number; y: number; z: number };
  };

  if (!shipId) {
    throw new InvalidActionError('Missing shipId in move params');
  }

  const ship = await Ship.findById(shipId);
  if (!ship) {
    throw new NotFoundError('Ship', shipId);
  }
  if (ship.ownerId.toString() !== action.replicantId.toString()) {
    throw new InvalidActionError('Ship does not belong to this replicant');
  }
  if (ship.status === 'in_transit') {
    throw new InvalidActionError('Ship is already in transit');
  }
  if (ship.status === 'destroyed') {
    throw new InvalidActionError('Ship is destroyed');
  }

  // Resolve the destination position: prefer an explicit destinationPos; otherwise
  // fall back to the body's current position (legacy callers passing only a body id).
  let destPos = destinationPos;
  let destBody = null;
  if (destinationBodyId) {
    destBody = await CelestialBody.findById(destinationBodyId);
    if (!destBody) throw new NotFoundError('CelestialBody', destinationBodyId);
    if (!destPos) destPos = { x: destBody.position.x, y: destBody.position.y, z: destBody.position.z };
  }
  if (!destPos) {
    throw new InvalidActionError('Missing destination: provide destinationPos or destinationBodyId');
  }

  const shipPos = ship.position;
  const dist = distance(shipPos, destPos);
  const speed = ship.specs.maxSpeed;
  if (speed <= 0) {
    throw new InvalidActionError('Ship has no propulsion (maxSpeed = 0)');
  }

  const travelTicks = travelTimeTicks(shipPos, destPos, speed);
  const requiredFuel = fuelCost(dist);
  if (ship.fuel < requiredFuel) {
    throw new InsufficientResourcesError('fuel', requiredFuel, ship.fuel);
  }

  ship.fuel -= requiredFuel;
  ship.status = 'in_transit';
  ship.orbitingBodyId = null;
  ship.orbitingAsteroidId = null;
  ship.dockedAtId = null;
  ship.navigation = {
    destinationBodyId: destBody?._id ?? null,
    destinationAsteroidId: (destinationAsteroidId as never) ?? null,
    destinationPos: { x: destPos.x, y: destPos.y, z: destPos.z },
    departurePos: { x: shipPos.x, y: shipPos.y, z: shipPos.z },
    departureTick: tick,
    arrivalTick: tick + travelTicks,
    speed,
  };

  await ship.save();

  return {
    shipId: ship._id.toString(),
    destinationBodyId: destBody?._id.toString() ?? null,
    destinationName: destBody?.name ?? `(${destPos.x}, ${destPos.y}, ${destPos.z})`,
    distanceAU: dist,
    travelTicks,
    arrivalTick: tick + travelTicks,
    fuelConsumed: requiredFuel,
    fuelRemaining: ship.fuel,
  };
}
```

(The imports at the top of the file already include `Ship, CelestialBody`, the physics helpers, and the error classes — no import change needed.)

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run test/coordinate-nav.test.ts` → PASS. `npx tsc --noEmit` → no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/engine/actions/MoveAction.ts test/coordinate-nav.test.ts
git commit -m "feat: MoveAction accepts a coordinate destination, no body required"
```

---

### Task 5: `Movement` arrival sets `orbitingAsteroidId`

**Files:**
- Modify: `src/engine/systems/Movement.ts` (arrival block ~line 65-91)
- Test: `test/coordinate-nav.test.ts` (extend)

**Interfaces:**
- Consumes: `navigation.destinationAsteroidId` (Task 1), set by `handleMove` (Task 4).

- [ ] **Step 1: Write the failing test**

Append to `test/coordinate-nav.test.ts`:

```typescript
import { advanceAll } from '../src/engine/systems/Movement.js';

describe('Movement arrival semantics', () => {
  let rep: { id: string; apiKey: string; shipId: string };
  beforeAll(async () => { await setupTestServer(); rep = await registerReplicant('ArrivalTester'); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('arriving at raw coordinates leaves both orbit refs null at the point', async () => {
    const ship = await Ship.findById(rep.shipId);
    ship!.status = 'in_transit';
    ship!.navigation = {
      destinationBodyId: null, destinationAsteroidId: null,
      destinationPos: { x: 1.3, y: 0.4, z: 0 },
      departurePos: { x: 1, y: 0, z: 0 }, departureTick: 1, arrivalTick: 5, speed: 0.002,
    } as never;
    await ship!.save();
    await advanceAll(5);
    const arrived = await Ship.findById(rep.shipId);
    expect(arrived!.status).toBe('orbiting');
    expect(arrived!.position).toEqual({ x: 1.3, y: 0.4, z: 0 });
    expect(arrived!.orbitingBodyId).toBeNull();
    expect(arrived!.orbitingAsteroidId).toBeNull();
  });

  it('arriving at an asteroid sets orbitingAsteroidId (so mining is valid)', async () => {
    const rep2 = await registerReplicant('ArrivalAsteroid');
    const fakeAst = '64b9f0000000000000000abc';
    const ship = await Ship.findById(rep2.shipId);
    ship!.status = 'in_transit';
    ship!.navigation = {
      destinationBodyId: null, destinationAsteroidId: fakeAst as never,
      destinationPos: { x: 2.7, y: 0.1, z: 0 },
      departurePos: { x: 1, y: 0, z: 0 }, departureTick: 1, arrivalTick: 5, speed: 0.002,
    } as never;
    await ship!.save();
    await advanceAll(5);
    const arrived = await Ship.findById(rep2.shipId);
    expect(arrived!.orbitingAsteroidId!.toString()).toBe(fakeAst);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/coordinate-nav.test.ts`
Expected: FAIL — the asteroid case: `orbitingAsteroidId` stays null (Movement doesn't set it).

- [ ] **Step 3: Update the arrival block**

In `src/engine/systems/Movement.ts`, inside the arrival branch, after the line `ship.orbitingBodyId = nav.destinationBodyId ?? null;` (~line 81), add:

```typescript
      ship.orbitingAsteroidId = nav.destinationAsteroidId ?? null;
```

And in the navigation-clear object (~lines 84-91), add the `destinationAsteroidId` field so it resets too:

```typescript
      ship.navigation = {
        destinationBodyId: null,
        destinationAsteroidId: null,
        destinationPos: null,
        departurePos: null,
        departureTick: null,
        arrivalTick: null,
        speed: null,
      };
```

- [ ] **Step 4: Run tests + type-check + full suite**

Run: `npx vitest run test/coordinate-nav.test.ts` → PASS (all). `npx tsc --noEmit` → no new errors. Then `ADMIN_KEY=dev-admin-key npx vitest run` → all green (no regressions in existing navigation/movement tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/systems/Movement.ts test/coordinate-nav.test.ts
git commit -m "feat: arriving at an asteroid sets orbitingAsteroidId for mining"
```

---

## Self-Review

**Spec coverage:**
- 4 input forms + exactly-one + validation (finite, ≤60 AU) → Task 2 (`resolveDestination`), used by Task 3. ✓
- `move_ship` / `calculate_route` accept all forms → Tasks 2, 3. ✓
- `MoveAction` no longer requires a body; persists pos + optional ids → Task 4. ✓
- `Movement` arrival sets `orbitingAsteroidId`; clears it → Task 5. ✓
- `Ship.navigation.destinationAsteroidId` schema field → Task 1. ✓
- Arrival semantics (body orbit / asteroid mineable / raw free-floating) → Tasks 4-5 + tests. ✓
- Physics unchanged (reuses distance/travelTimeTicks/fuelCost) → Tasks 2-4. ✓

**Placeholder scan:** Every code step has complete code; no TBD/TODO.

**Type consistency:** `resolveDestination` return shape (`{ok, pos, bodyId?, asteroidId?, label}`) is consumed consistently in Tasks 2/3. The queued-move param contract (`destinationPos` + optional `destinationBodyId`/`destinationAsteroidId`) is produced by `move_ship` (Task 2) and consumed by `handleMove` (Task 4) identically. `navigation.destinationAsteroidId` is added in Task 1, set in Task 4, read/cleared in Task 5 — consistent.

**Note:** Task 4's test constructs a partial `action` object cast `as never` (only `replicantId` + `params` are read by `handleMove`); this is deliberate and sufficient since `handleMove` ignores other `IActionQueue` fields.
