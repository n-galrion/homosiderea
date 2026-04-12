import { Colony, Structure, AMI, CelestialBody, ResourceStore } from '../../db/models/index.js';

/**
 * Recompute stats for all active colonies from their structures.
 */
export async function recomputeAllColonyStats(tick: number): Promise<number> {
  const colonies = await Colony.find({ status: { $ne: 'abandoned' } });
  let updated = 0;

  for (const colony of colonies) {
    await recomputeColonyStats(colony._id.toString());
    updated++;
  }

  return updated;
}

/**
 * Recompute a single colony's stats from its structures and AMIs.
 */
export async function recomputeColonyStats(colonyId: string): Promise<void> {
  const colony = await Colony.findById(colonyId);
  if (!colony) return;

  const structures = await Structure.find({
    colonyId: colony._id,
    status: { $ne: 'destroyed' },
  }).lean();

  const operationalStructures = structures.filter(s => s.status === 'operational');
  const amis = await AMI.find({
    structureId: { $in: structures.map(s => s._id) },
    status: { $ne: 'destroyed' },
  }).lean();

  // Compute energy balance
  let energyProduction = 0;
  let energyConsumption = 0;
  let miningRate = 0;
  let manufacturingCapacity = 0;
  let storageCapacity = 0;
  let dockingSlots = 0;
  const miningOutput: Record<string, number> = {};

  for (const s of operationalStructures) {
    energyProduction += s.specs.energyOutput;
    energyConsumption += s.specs.energyConsumption;
    miningRate += s.specs.miningRate;
    manufacturingCapacity += s.specs.manufacturingRate;
    storageCapacity += s.specs.storageCapacity;
    dockingSlots += s.specs.dockingSlots;
  }

  // Power ratio: if production < consumption, everything runs at reduced efficiency
  const powerRatio = energyConsumption > 0
    ? Math.min(1.0, energyProduction / energyConsumption)
    : 1.0;

  // Compute mining output based on body resources and power ratio
  if (miningRate > 0) {
    const body = await CelestialBody.findById(colony.bodyId);
    if (body) {
      for (const res of body.resources) {
        if (res.accessible && res.remaining > 0) {
          miningOutput[res.resourceType] = parseFloat(
            (miningRate * res.abundance * powerRatio).toFixed(2)
          );
        }
      }
    }
  }

  // Update colony status
  if (colony.status === 'founding' && operationalStructures.length > 0) {
    colony.status = 'active';
  }

  colony.stats = {
    structureCount: structures.length,
    amiCount: amis.length,
    energyProduction,
    energyConsumption,
    miningOutput,
    manufacturingCapacity: parseFloat((manufacturingCapacity * powerRatio).toFixed(2)),
    storageCapacity,
    dockingSlots,
    population: amis.length,
    powerRatio: parseFloat(powerRatio.toFixed(3)),
  };

  await colony.save();
}

/**
 * Enforce power grid on colony structures.
 * When a colony's power ratio < 1, reduce mining/manufacturing rates proportionally.
 * This is informational — the actual rate reduction happens during resource production
 * by checking colony.stats.powerRatio.
 */
export async function enforceColonyPowerGrid(tick: number): Promise<void> {
  // Power ratio is already computed in recomputeAllColonyStats.
  // Systems that consume power (mining, manufacturing) should check
  // the colony's powerRatio and scale their output accordingly.
  // This function exists as a hook for future power-grid mechanics
  // (brownouts, priority systems, etc.)
}
