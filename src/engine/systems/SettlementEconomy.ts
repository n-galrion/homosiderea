import { Settlement, ResourceStore, Notification } from '../../db/models/index.js';

/**
 * Resource keys on the ResourceStore model that can be read/written dynamically.
 */
const RESOURCE_KEYS: ReadonlySet<string> = new Set([
  'metals', 'ice', 'silicates', 'rareEarths', 'helium3', 'organics',
  'hydrogen', 'uranium', 'carbon', 'alloys', 'fuel', 'electronics',
  'hullPlating', 'engines', 'sensors', 'computers', 'weaponSystems',
  'lifeSupportUnits', 'solarPanels', 'fusionCores', 'energy',
]);

/** Minimum population — settlements never die completely. */
const MIN_POPULATION = 100;

/**
 * Time-scale constants.
 * 1 tick = 5 real seconds × 600 dilation = 3000 game seconds ≈ 50 game minutes.
 * 1 game day ≈ 29 ticks.  1 game year ≈ 10,512 ticks.
 *
 * Population changes are per-tick but MUST be realistic on a per-day or per-year
 * basis. Earth grows ~0.8% per YEAR. Even a crisis shouldn't kill 0.1% per hour.
 */
const TICKS_PER_GAME_DAY = 29;
const TICKS_PER_GAME_YEAR = 10_512;

/**
 * Process settlement economy each tick.
 * Runs BEFORE SettlementBehavior (price fluctuation) so prices reflect
 * the latest stockpile state.
 *
 * For each non-destroyed settlement:
 *  1. Get or create settlement ResourceStore
 *  2. Consume inputs from stockpile
 *  3. Produce outputs (efficiency based on deficit ratio)
 *  4. Population growth/decline based on resource satisfaction
 *  5. Update settlement status based on resource state
 */
export interface EconomyEvent {
  settlement: string;
  type: string;
  population: number;
  consumed: Record<string, number>;
  produced: Record<string, number>;
  stockpile: Record<string, number>;
  ticksOfSupply: Record<string, number>;
  deficits: string[];
  satisfaction: number;
  efficiency: number;
  populationDelta: number;
  status: string;
}

const economyLog: EconomyEvent[] = [];

/** Get the last tick's economy events (for feed/dashboard). */
export function getLastEconomyLog(): EconomyEvent[] {
  return [...economyLog];
}

export async function processSettlementEconomy(tick: number): Promise<number> {
  const settlements = await Settlement.find({ status: { $ne: 'destroyed' } });
  let processed = 0;
  economyLog.length = 0; // reset for this tick

  for (const settlement of settlements) {
    // 1. Get or create settlement ResourceStore
    let stockpile = await ResourceStore.findOne({
      'ownerRef.kind': 'Settlement',
      'ownerRef.item': settlement._id,
    });

    if (!stockpile) {
      // Create stockpile with initial buffers.
      // Production surplus: 1 game-year of accumulated output (≈10,000 ticks).
      // Consumption reserves: 6 game-months of reserves (≈5,000 ticks).
      // These represent mature settlements that have been running for years.
      const initData: Record<string, number> = {};
      const production = settlement.production as Record<string, number> || {};
      const consumption = settlement.consumption as Record<string, number> || {};

      for (const [resource, rate] of Object.entries(production)) {
        if (RESOURCE_KEYS.has(resource)) {
          initData[resource] = (initData[resource] || 0) + rate * TICKS_PER_GAME_YEAR;
        }
      }
      for (const [resource, rate] of Object.entries(consumption)) {
        if (RESOURCE_KEYS.has(resource)) {
          initData[resource] = (initData[resource] || 0) + rate * Math.round(TICKS_PER_GAME_YEAR / 2);
        }
      }

      stockpile = await ResourceStore.create({
        ownerRef: { kind: 'Settlement', item: settlement._id },
        ...initData,
      });
    }

    const storeAny = stockpile as unknown as Record<string, number>;
    const consumption = settlement.consumption as Record<string, number> || {};
    const production = settlement.production as Record<string, number> || {};

    // 2. Consume inputs — track how many resources were fully satisfied
    let totalConsumed = 0;
    let totalNeeded = 0;
    let deficitCount = 0;
    const consumptionEntries = Object.entries(consumption);

    for (const [resource, rate] of consumptionEntries) {
      if (!RESOURCE_KEYS.has(resource) || rate <= 0) continue;
      totalNeeded += rate;
      const available = storeAny[resource] ?? 0;
      const consumed = Math.min(available, rate);
      storeAny[resource] = available - consumed;
      totalConsumed += consumed;

      if (consumed < rate) {
        deficitCount++;
      }
    }

    // 3. Produce outputs — efficiency based on deficit count
    let productionEfficiency = 1.0;
    const totalConsumedResources = consumptionEntries.filter(
      ([r, v]) => RESOURCE_KEYS.has(r) && v > 0
    ).length;

    if (totalConsumedResources > 0) {
      if (deficitCount > totalConsumedResources / 2) {
        productionEfficiency = 0.5;   // More than half in deficit
      } else if (deficitCount > 0) {
        productionEfficiency = 0.75;  // Some deficit
      }
    }

    for (const [resource, rate] of Object.entries(production)) {
      if (!RESOURCE_KEYS.has(resource) || rate <= 0) continue;
      const produced = rate * productionEfficiency;
      storeAny[resource] = (storeAny[resource] ?? 0) + produced;
    }

    // 4. Population growth/decline based on resource satisfaction
    //
    // Satisfaction measures how much of the settlement's SPACE TRADE needs are met.
    // Low satisfaction doesn't mean starvation — Earth cities have internal economies.
    // It means the space program is underfunded, tech investment stalls, etc.
    //
    // Population rates are scaled to game time:
    //   +1% per game year when thriving (≈ +0.000095% per tick)
    //   -0.5% per game year when struggling (≈ -0.000048% per tick)
    //   -2% per game year in severe crisis (≈ -0.00019% per tick)
    // For reference: real Earth growth is ~0.8%/year.
    const satisfactionRatio = totalNeeded > 0 ? totalConsumed / totalNeeded : 1.0;

    let populationMultiplier = 1.0;
    if (satisfactionRatio >= 0.8) {
      populationMultiplier = 1.0 + (0.01 / TICKS_PER_GAME_YEAR);    // +1%/year
    } else if (satisfactionRatio >= 0.5) {
      populationMultiplier = 1.0;                                      // stable
    } else if (satisfactionRatio >= 0.2) {
      populationMultiplier = 1.0 - (0.005 / TICKS_PER_GAME_YEAR);   // -0.5%/year
    } else {
      populationMultiplier = 1.0 - (0.02 / TICKS_PER_GAME_YEAR);    // -2%/year (crisis)
    }

    settlement.population = Math.max(
      MIN_POPULATION,
      Math.round(settlement.population * populationMultiplier),
    );

    // 5. Update settlement status based on satisfaction.
    // For Earth cities (type=city), low satisfaction means reduced space-program
    // investment, not societal collapse. They degrade slower.
    // For outposts/stations, low satisfaction is more critical.
    const isEarthCity = settlement.type === 'city';
    if (satisfactionRatio >= 0.8) {
      settlement.status = 'thriving';
    } else if (satisfactionRatio >= 0.5) {
      settlement.status = 'stable';
    } else if (satisfactionRatio >= 0.2) {
      settlement.status = isEarthCity ? 'stable' : 'struggling';
    } else {
      settlement.status = isEarthCity ? 'struggling' : 'damaged';
    }

    // 6. Log economy event for this tick
    const consumedRecord: Record<string, number> = {};
    const producedRecord: Record<string, number> = {};
    const stockpileSnapshot: Record<string, number> = {};
    const ticksOfSupplySnapshot: Record<string, number> = {};

    for (const [resource, rate] of consumptionEntries) {
      if (RESOURCE_KEYS.has(resource) && rate > 0) {
        consumedRecord[resource] = Math.min(storeAny[resource] ?? 0, rate);
        const stock = storeAny[resource] ?? 0;
        stockpileSnapshot[resource] = Math.round(stock);
        // Net rate = production - consumption for this resource
        const prodRate = (production[resource] ?? 0) * productionEfficiency;
        const netRate = rate - prodRate; // positive = draining
        ticksOfSupplySnapshot[resource] = netRate > 0 ? Math.round(stock / netRate) : Infinity;
      }
    }
    for (const [resource, rate] of Object.entries(production)) {
      if (RESOURCE_KEYS.has(resource) && rate > 0) {
        producedRecord[resource] = rate * productionEfficiency;
        if (!(resource in stockpileSnapshot)) {
          stockpileSnapshot[resource] = Math.round(storeAny[resource] ?? 0);
        }
      }
    }
    const deficits = consumptionEntries
      .filter(([r, v]) => RESOURCE_KEYS.has(r) && v > 0 && (storeAny[r] ?? 0) < v * TICKS_PER_GAME_DAY)
      .map(([r]) => r);

    const prevPop = settlement.population;
    const popDelta = Math.round(settlement.population * populationMultiplier) - prevPop;

    economyLog.push({
      settlement: settlement.name,
      type: settlement.type as string,
      population: settlement.population,
      consumed: consumedRecord,
      produced: producedRecord,
      stockpile: stockpileSnapshot,
      ticksOfSupply: ticksOfSupplySnapshot,
      deficits,
      satisfaction: satisfactionRatio,
      efficiency: productionEfficiency,
      populationDelta: popDelta,
      status: settlement.status as string,
    });

    // 7. Generate notifications for significant changes (every 10 ticks to reduce noise)
    if (tick % 10 === 0) {
      const deficits = consumptionEntries
        .filter(([r, v]) => RESOURCE_KEYS.has(r) && v > 0 && (storeAny[r] ?? 0) < v * 10)
        .map(([r]) => r);

      if (deficits.length > 0 && satisfactionRatio < 0.6) {
        await Notification.create({
          type: 'settlement_event',
          title: `${settlement.name}: Resource ${satisfactionRatio < 0.3 ? 'Crisis' : 'Shortage'}`,
          body: `${settlement.name} (${settlement.nation}) is ${satisfactionRatio < 0.3 ? 'in crisis' : 'running low'}. Deficits: ${deficits.join(', ')}. Satisfaction: ${(satisfactionRatio * 100).toFixed(0)}%. Population: ${settlement.population.toLocaleString()}. Production at ${(productionEfficiency * 100).toFixed(0)}%.`,
          data: {
            settlementId: settlement._id.toString(),
            settlementName: settlement.name,
            deficits,
            satisfactionRatio,
            productionEfficiency,
            population: settlement.population,
            status: settlement.status,
          },
          tick,
        });
      }
    }

    // Mark all resource fields as modified and save
    for (const key of RESOURCE_KEYS) {
      stockpile.markModified(key);
    }
    await stockpile.save();
    await settlement.save();

    processed++;
  }

  return processed;
}
