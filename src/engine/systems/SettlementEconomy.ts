import { Settlement, ResourceStore } from '../../db/models/index.js';

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
export async function processSettlementEconomy(tick: number): Promise<number> {
  const settlements = await Settlement.find({ status: { $ne: 'destroyed' } });
  let processed = 0;

  for (const settlement of settlements) {
    // 1. Get or create settlement ResourceStore
    let stockpile = await ResourceStore.findOne({
      'ownerRef.kind': 'Settlement',
      'ownerRef.item': settlement._id,
    });

    if (!stockpile) {
      // Create stockpile with initial buffers
      const initData: Record<string, number> = {};
      const production = settlement.production as Record<string, number> || {};
      const consumption = settlement.consumption as Record<string, number> || {};

      // Production outputs: 100 ticks of surplus buffer
      for (const [resource, rate] of Object.entries(production)) {
        if (RESOURCE_KEYS.has(resource)) {
          initData[resource] = (initData[resource] || 0) + rate * 100;
        }
      }
      // Consumption inputs: 50 ticks of working buffer
      for (const [resource, rate] of Object.entries(consumption)) {
        if (RESOURCE_KEYS.has(resource)) {
          initData[resource] = (initData[resource] || 0) + rate * 50;
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
    const satisfactionRatio = totalNeeded > 0 ? totalConsumed / totalNeeded : 1.0;

    let populationMultiplier = 1.0;
    if (satisfactionRatio >= 0.8) {
      populationMultiplier = 1.0001;   // +0.01% per tick
    } else if (satisfactionRatio >= 0.5) {
      populationMultiplier = 1.0;      // stable
    } else if (satisfactionRatio >= 0.2) {
      populationMultiplier = 0.9998;   // -0.02% per tick
    } else {
      populationMultiplier = 0.999;    // -0.1% per tick (crisis)
    }

    settlement.population = Math.max(
      MIN_POPULATION,
      Math.round(settlement.population * populationMultiplier),
    );

    // 5. Update settlement status based on satisfaction
    if (satisfactionRatio >= 0.8) {
      settlement.status = 'thriving';
    } else if (satisfactionRatio >= 0.6) {
      settlement.status = 'stable';
    } else if (satisfactionRatio >= 0.3) {
      settlement.status = 'struggling';
    } else {
      settlement.status = 'damaged';
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
