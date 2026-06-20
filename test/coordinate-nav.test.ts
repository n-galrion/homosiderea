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
