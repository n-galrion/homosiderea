import { Settlement, Market, Replicant, Ship, PriceHistory } from '../../db/models/index.js';

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

  const production = settlement.production as Record<string, number> || {};
  const consumption = settlement.consumption as Record<string, number> || {};

  for (const resource of market.availableResources) {
    // Base random walk: ±5%
    const volatility = 0.05;
    const change = 1 + (Math.random() - 0.5) * 2 * volatility;

    // Supply/demand modifier:
    // Resources the settlement PRODUCES are cheaper to buy (surplus)
    // Resources the settlement CONSUMES they pay more for (demand)
    const produces = production[resource] || 0;
    const consumes = consumption[resource] || 0;

    if (resource in buyPrices) {
      let price = buyPrices[resource] * change;
      // They pay MORE for things they consume (high demand)
      if (consumes > 0) price *= 1 + (consumes / 500) * 0.1;
      // They pay LESS for things they produce (low demand)
      if (produces > 0) price *= 1 - (produces / 500) * 0.05;
      buyPrices[resource] = Math.max(1, Math.round(price * 10) / 10);
    }
    if (resource in sellPrices) {
      let price = sellPrices[resource] * change;
      // They charge LESS for things they produce (surplus)
      if (produces > 0) price *= 1 - (produces / 500) * 0.1;
      // They charge MORE for things they consume (scarcity)
      if (consumes > 0) price *= 1 + (consumes / 500) * 0.05;
      sellPrices[resource] = Math.max(1, Math.round(price * 10) / 10);
    }

    // Ensure buy price < sell price (market spread — they buy low, sell high)
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
      sellPrices[resource] *= (1 + penalty * 0.5);
    }
    for (const resource of Object.keys(buyPrices)) {
      buyPrices[resource] *= (1 - penalty * 0.3);
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
