import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant } from './setup.js';
import { Ship, ActionQueue, Asteroid, CelestialBody, Salvage } from '../src/db/models/index.js';
import { buildToolRegistry } from '../src/tools/registry.js';

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
    const asteroid = await Asteroid.create({
      name: 'TestRock-1',
      beltZoneId: belt!._id,
      position: { x: 2.6, y: 0.1, z: 0 },
      physical: { radius: 1, mass: 1e12, composition: 'metallic' },
      orbit: { semiMajorAxis: 2.6, eccentricity: 0.1, inclination: 0, orbitalPeriod: 4.2 },
    });
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

  it('queues a move to a salvage field', async () => {
    const salvage = await Salvage.create({
      name: 'Derelict-X',
      type: 'wreckage',
      position: { x: 1.4, y: 0.5, z: 0 },
      sourceShipName: 'Ghost',
      sourceOwnerType: 'unknown',
      resources: { metals: 10 },
      createdAtTick: 1,
    });
    const reg = buildToolRegistry(rep.id);
    const out = JSON.parse((await reg.get('move_ship')!.handler({ shipId: rep.shipId, salvageId: salvage._id.toString() })).content[0].text);
    const action = await ActionQueue.findById(out.actionId);
    expect(action!.params.destinationPos).toEqual({ x: 1.4, y: 0.5, z: 0 });
    expect(action!.params.destinationBodyId).toBeFalsy();
    expect(action!.params.destinationAsteroidId).toBeFalsy();
  });

  it('rejects an unknown asteroid id', async () => {
    const reg = buildToolRegistry(rep.id);
    const out = (await reg.get('move_ship')!.handler({ shipId: rep.shipId, asteroidId: '64b9f0000000000000000fff' })).content[0].text;
    expect(out.toLowerCase()).toContain('not found');
  });
});

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
