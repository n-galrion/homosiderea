import { Settlement, Market, PriceHistory, ResourceStore } from '../../db/models/index.js';

/** Crisis can at most quadruple a base price; floor is always 1. */
export const PRICE_CAP = 4;

/**
 * Compute a fluctuated price from a fixed base. Stateless and bounded:
 * current = clamp(base * supplyMultiplier * noise, 1, base * cap).
 * Always derived from `base`, never from the previous price — so it cannot drift.
 */
export function anchoredPrice(
  base: number,
  supplyMultiplier: number,
  noise: number,
  cap: number = PRICE_CAP,
): number {
  const raw = Math.round(base * supplyMultiplier * noise * 10) / 10;
  const ceiling = Math.round(base * cap * 10) / 10;
  return Math.max(1, Math.min(raw, ceiling));
}

/**
 * Simulate human settlement behavior each tick.
 * Handles attitude drift, status checks, and market price updates.
 * NOTE: Population growth/decline and status updates are now handled by
 * SettlementEconomy.ts which runs before this phase. This phase focuses
 * on attitude drift and market pricing.
 */
export async function simulateSettlements(tick: number): Promise<number> {
  const settlements = await Settlement.find({ status: { $ne: 'destroyed' } });
  let updated = 0;

  for (const settlement of settlements) {
    // 1. Attitude drift — slowly regress toward neutral
    if (settlement.attitude.general > 0.5) {
      settlement.attitude.general -= 0.001;
    } else if (settlement.attitude.general < 0.5) {
      settlement.attitude.general += 0.001;
    }
    settlement.attitude.general = Math.max(-1, Math.min(1, settlement.attitude.general));

    // 2. Status: destroyed check (population handled by SettlementEconomy)
    if (settlement.population <= 0) {
      settlement.status = 'destroyed';
    }

    settlement.markModified('attitude');
    await settlement.save();

    // 3. Market price fluctuation (stockpile-driven)
    const market = await Market.findOne({ settlementId: settlement._id });
    if (market) {
      await fluctuateMarketPrices(market, settlement, tick);
    }

    updated++;
  }

  return updated;
}

/**
 * Fluctuate market prices based on actual stockpile levels.
 * Prices are driven by supply fundamentals with small random noise (±2%).
 */
export async function fluctuateMarketPrices(
  market: InstanceType<typeof Market>,
  settlement: InstanceType<typeof Settlement>,
  tick: number,
): Promise<void> {
  // Only fluctuate every 10 ticks to avoid noise
  if (tick % 10 !== 0) return;

  const baseBuy = (market.basePrices?.buy ?? {}) as Record<string, number>;
  const baseSell = (market.basePrices?.sell ?? {}) as Record<string, number>;
  const buyPrices = market.prices.buy as Record<string, number>;
  const sellPrices = market.prices.sell as Record<string, number>;

  const consumption = settlement.consumption as Record<string, number> || {};

  const stockpile = await ResourceStore.findOne({
    'ownerRef.kind': 'Settlement',
    'ownerRef.item': settlement._id,
  });

  for (const resource of market.availableResources) {
    let supplyMultiplier = 1.0;
    if (stockpile) {
      const storeAny = stockpile as unknown as Record<string, number>;
      const stock = storeAny[resource] ?? 0;
      const consumptionRate = consumption[resource] || 1;
      const ticksOfSupply = stock / consumptionRate;
      if (ticksOfSupply > 100) supplyMultiplier = 0.8;
      else if (ticksOfSupply > 50) supplyMultiplier = 0.9;
      else if (ticksOfSupply < 5) supplyMultiplier = 2.0;
      else if (ticksOfSupply < 10) supplyMultiplier = 1.5;
    }

    const noise = 1 + (Math.random() - 0.5) * 0.04;

    // Attitude modifier — hostile settlements charge more (sell) and pay less (buy).
    const attitude = settlement.attitude.general;
    const penalty = attitude < 0 ? Math.abs(attitude) : 0;

    if (resource in baseBuy) {
      const buyAttitude = 1 - penalty * 0.3;
      buyPrices[resource] = anchoredPrice(baseBuy[resource] * buyAttitude, supplyMultiplier, noise);
    }
    if (resource in baseSell) {
      const sellAttitude = 1 + penalty * 0.5;
      sellPrices[resource] = anchoredPrice(baseSell[resource] * sellAttitude, supplyMultiplier, noise);
    }

    // Preserve market spread.
    if (resource in buyPrices && resource in sellPrices && buyPrices[resource] >= sellPrices[resource]) {
      sellPrices[resource] = Math.round(buyPrices[resource] * 1.3 * 10) / 10;
    }
  }

  market.prices.buy = buyPrices;
  market.prices.sell = sellPrices;
  market.markModified('prices');
  market.lastUpdatedTick = tick;
  await market.save();

  await PriceHistory.create({
    marketId: market._id,
    settlementName: settlement.name,
    tick,
    prices: { buy: { ...buyPrices }, sell: { ...sellPrices } },
  });
}
