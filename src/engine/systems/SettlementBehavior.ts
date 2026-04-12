import { Settlement, Market, Replicant, Ship } from '../../db/models/index.js';

/**
 * Simulate human settlement behavior each tick.
 * Settlements are not static — they produce, consume, adjust prices,
 * shift attitudes, and occasionally generate events.
 */
export async function simulateSettlements(tick: number): Promise<number> {
  const settlements = await Settlement.find({ status: { $ne: 'destroyed' } });
  let updated = 0;

  for (const settlement of settlements) {
    // 1. Population growth/decline
    const growthRate = settlement.status === 'thriving' ? 0.0001
      : settlement.status === 'stable' ? 0.00005
      : settlement.status === 'struggling' ? -0.0001
      : settlement.status === 'damaged' ? -0.001
      : 0;
    settlement.population = Math.max(0, Math.round(settlement.population * (1 + growthRate)));

    // 2. Attitude drift — slowly regress toward neutral
    if (settlement.attitude.general > 0.5) {
      settlement.attitude.general -= 0.001;
    } else if (settlement.attitude.general < 0.5) {
      settlement.attitude.general += 0.001;
    }
    settlement.attitude.general = Math.max(-1, Math.min(1, settlement.attitude.general));

    // 3. Status updates based on population
    if (settlement.population <= 0) {
      settlement.status = 'destroyed';
    } else if (settlement.status === 'damaged' && tick % 100 === 0) {
      // Damaged settlements slowly recover
      settlement.status = 'struggling';
    }

    settlement.markModified('attitude');
    await settlement.save();

    // 4. Market price fluctuation
    const market = await Market.findOne({ settlementId: settlement._id });
    if (market) {
      await fluctuateMarketPrices(market, settlement, tick);
    }

    updated++;
  }

  return updated;
}

/**
 * Fluctuate market prices based on supply, demand, and randomness.
 * Prices shift slightly each tick to create trading opportunities.
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

  for (const resource of market.availableResources) {
    // Random walk: ±5% per fluctuation period
    const volatility = 0.05;
    const change = 1 + (Math.random() - 0.5) * 2 * volatility;

    if (resource in buyPrices) {
      buyPrices[resource] = Math.max(1, Math.round(buyPrices[resource] * change * 10) / 10);
    }
    if (resource in sellPrices) {
      sellPrices[resource] = Math.max(1, Math.round(sellPrices[resource] * change * 10) / 10);
    }

    // Ensure buy > sell (market spread)
    if (resource in buyPrices && resource in sellPrices) {
      if (buyPrices[resource] <= sellPrices[resource]) {
        buyPrices[resource] = sellPrices[resource] * 1.2;
      }
    }
  }

  // Attitude affects prices — hostile settlements charge more, pay less
  if (settlement.attitude.general < 0) {
    const penalty = Math.abs(settlement.attitude.general);
    for (const resource of Object.keys(buyPrices)) {
      buyPrices[resource] *= (1 + penalty * 0.5); // They charge more
    }
    for (const resource of Object.keys(sellPrices)) {
      sellPrices[resource] *= (1 - penalty * 0.3); // They pay less
    }
  }

  market.prices.buy = buyPrices;
  market.prices.sell = sellPrices;
  market.markModified('prices');
  market.lastUpdatedTick = tick;
  await market.save();
}
