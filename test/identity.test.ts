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
