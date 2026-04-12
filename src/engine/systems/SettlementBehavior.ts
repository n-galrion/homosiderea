import { Settlement, Market, PriceHistory, ResourceStore } from '../../db/models/index.js';

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
async function fluctuateMarketPrices(
  market: InstanceType<typeof Market>,
  settlement: InstanceType<typeof Settlement>,
  tick: number,
): Promise<void> {
  // Only fluctuate every 10 ticks to avoid noise
  if (tick % 10 !== 0) return;

  const buyPrices = market.prices.buy as Record<string, number>;
  const sellPrices = market.prices.sell as Record<string, number>;

  const consumption = settlement.consumption as Record<string, number> || {};

  // Get settlement's stockpile for supply-driven pricing
  const stockpile = await ResourceStore.findOne({
    'ownerRef.kind': 'Settlement',
    'ownerRef.item': settlement._id,
  });

  for (const resource of market.availableResources) {
    // Compute supply multiplier from stockpile level
    let supplyMultiplier = 1.0;

    if (stockpile) {
      const storeAny = stockpile as unknown as Record<string, number>;
      const stock = storeAny[resource] ?? 0;
      const consumptionRate = consumption[resource] || 1;
      const ticksOfSupply = stock / consumptionRate;

      if (ticksOfSupply > 100) supplyMultiplier = 0.8;       // surplus -> cheap
      else if (ticksOfSupply > 50) supplyMultiplier = 0.9;
      else if (ticksOfSupply < 5) supplyMultiplier = 2.0;     // crisis -> spike
      else if (ticksOfSupply < 10) supplyMultiplier = 1.5;    // deficit -> expensive
    }

    // Small random noise ±2%
    const noise = 1 + (Math.random() - 0.5) * 0.04;

    if (resource in buyPrices) {
      // When supply is low (supplyMultiplier high), buy price goes UP (they want it badly)
      buyPrices[resource] = Math.max(1, Math.round(buyPrices[resource] * supplyMultiplier * noise * 10) / 10);
    }
    if (resource in sellPrices) {
      // When supply is low, sell price goes UP (they hoard / charge more)
      // When supply is high, sell price goes DOWN (they dump)
      sellPrices[resource] = Math.max(1, Math.round(sellPrices[resource] * supplyMultiplier * noise * 10) / 10);
    }

    // Ensure buy price < sell price (market spread)
    if (resource in buyPrices && resource in sellPrices) {
      if (buyPrices[resource] >= sellPrices[resource]) {
        sellPrices[resource] = Math.round(buyPrices[resource] * 1.3 * 10) / 10;
      }
    }
  }

  // Attitude affects prices — hostile settlements charge more, pay less
  if (settlement.attitude.general < 0) {
    const penalty = Math.abs(settlement.attitude.general);
    for (const resource of Object.keys(sellPrices)) {
      sellPrices[resource] = Math.round(sellPrices[resource] * (1 + penalty * 0.5) * 10) / 10;
    }
    for (const resource of Object.keys(buyPrices)) {
      buyPrices[resource] = Math.round(buyPrices[resource] * (1 - penalty * 0.3) * 10) / 10;
    }
  }

  market.prices.buy = buyPrices;
  market.prices.sell = sellPrices;
  market.markModified('prices');
  market.lastUpdatedTick = tick;
  await market.save();

  // Record price snapshot for history charts
  await PriceHistory.create({
    marketId: market._id,
    settlementName: settlement.name,
    tick,
    prices: { buy: { ...buyPrices }, sell: { ...sellPrices } },
  });
}
