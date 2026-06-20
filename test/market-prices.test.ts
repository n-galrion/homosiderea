import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
