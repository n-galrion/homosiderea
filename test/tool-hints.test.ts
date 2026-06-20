import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant } from './setup.js';
import { CelestialBody } from '../src/db/models/index.js';
import { buildToolRegistry } from '../src/tools/registry.js';

describe('per-tool next-step hints', () => {
  let rep: { id: string; apiKey: string; shipId: string };

  beforeAll(async () => {
    await setupTestServer();
    rep = await registerReplicant('HintTester');
  }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('get_position includes a next-step hint', async () => {
    const reg = buildToolRegistry(rep.id);
    const parsed = JSON.parse((await reg.get('get_position')!.handler({})).content[0].text);
    expect(typeof parsed.hint).toBe('string');
    expect(parsed.hint).toMatch(/move_ship|calculate_route/);
  });

  it('calculate_route includes a next-step hint', async () => {
    const mars = await CelestialBody.findOne({ name: 'Mars' });
    expect(mars).toBeTruthy();
    const reg = buildToolRegistry(rep.id);
    const parsed = JSON.parse(
      (await reg.get('calculate_route')!.handler({ shipId: rep.shipId, destinationBodyId: mars!._id.toString() })).content[0].text,
    );
    expect(parsed.feasible).toBeDefined();
    expect(typeof parsed.hint).toBe('string');
    expect(parsed.hint).toMatch(/move_ship|fuel/);
  });
});
