import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant, api, ADMIN_KEY } from './setup.js';
import { Ship, ResourceStore } from '../src/db/models/index.js';
import { buildHud } from '../src/tools/hud.js';

const CARGO_FIELDS = [
  'metals', 'ice', 'silicates', 'rareEarths', 'helium3', 'organics',
  'hydrogen', 'uranium', 'carbon', 'alloys', 'fuel', 'electronics',
  'hullPlating', 'engines', 'sensors', 'computers', 'weaponSystems',
  'lifeSupportUnits', 'solarPanels', 'fusionCores',
];

describe('Feedback Fixes', () => {
  beforeAll(async () => {
    await setupTestServer();
  }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  // Fix 1: starter cargo fits within cargo capacity
  it('Fix 1: new replicant starter cargo does not exceed ship cargo capacity', async () => {
    const rep = await registerReplicant('CargoCapTest');
    const ship = await Ship.findById(rep.shipId).lean();
    expect(ship).not.toBeNull();

    const store = await ResourceStore.findOne({
      'ownerRef.kind': 'Ship',
      'ownerRef.item': rep.shipId,
    }).lean();
    expect(store).not.toBeNull();

    const storeAny = store as unknown as Record<string, number>;
    const used = CARGO_FIELDS.reduce((sum, f) => sum + (storeAny[f] || 0), 0);
    expect(used).toBeLessThanOrEqual(ship!.specs.cargoCapacity);
  });

  // Fix 2: HUD shows OVER capacity message when cargo exceeds capacity
  it('Fix 2: HUD guidance says OVER capacity when cargo exceeds ship capacity', async () => {
    const rep = await registerReplicant('HudOverCapTest');
    const ship = await Ship.findById(rep.shipId);
    expect(ship).not.toBeNull();

    // Set cargo to exceed capacity
    await ResourceStore.findOneAndUpdate(
      { 'ownerRef.kind': 'Ship', 'ownerRef.item': ship!._id },
      { $set: { metals: ship!.specs.cargoCapacity + 50 } },
    );

    const hud = await buildHud(rep.id);
    expect(hud).not.toBeNull();
    expect(hud!.guidance.some(g => /OVER capacity/i.test(g))).toBe(true);
    // Should NOT show the "nearly full" message when over capacity
    expect(hud!.guidance.some(g => /nearly full/i.test(g))).toBe(false);
  });

  // Fix 3: get_inventory bogus id returns error naming the id
  it('Fix 3: get_inventory with bogus id returns error mentioning the id', async () => {
    const rep = await registerReplicant('GetInventoryTest');
    const bogusId = '000000000000000000000099';
    const { data } = await api(`/api/tools/get_inventory`, {
      method: 'POST',
      apiKey: rep.apiKey,
      body: { targetId: bogusId, targetType: 'Ship' },
    });
    // REST tools route returns { tool, result } where result is the parsed text payload
    const d = data as { result?: string };
    const text = d.result ?? '';
    expect(text).toMatch(bogusId);
    expect(text.toLowerCase()).toMatch(/error/i);
  });

  // Fix 4: GET /api/replicant/me includes credits
  it('Fix 4: GET /api/replicant/me returns credits: 500 for a new replicant', async () => {
    const rep = await registerReplicant('CreditsTest');
    const { status, data } = await api('/api/replicant/me', { apiKey: rep.apiKey });
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.credits).toBe(500);
  });
});
