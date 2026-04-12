import { Structure, CelestialBody, ResourceStore, Ship, AMI, Asteroid, Colony } from '../../db/models/index.js';

/**
 * Generate energy for all operational solar arrays and fusion plants.
 */
export async function generateEnergy(tick: number): Promise<void> {
  const energyStructures = await Structure.find({
    status: 'operational',
    type: { $in: ['solar_array', 'fusion_plant'] },
  });

  if (energyStructures.length === 0) return;

  const solarBodyIds = energyStructures
    .filter(s => s.type === 'solar_array')
    .map(s => s.bodyId);

  const bodies = await CelestialBody.find({ _id: { $in: solarBodyIds } }).lean();
  const bodyMap = new Map<string, number>();
  for (const body of bodies) {
    bodyMap.set(body._id.toString(), body.solarEnergyFactor);
  }

  for (const structure of energyStructures) {
    // Energy goes to colony storage if structure is part of a colony
    const storeRef = structure.colonyId
      ? { kind: 'Colony' as const, item: structure.colonyId }
      : { kind: 'Structure' as const, item: structure._id };

    let store = await ResourceStore.findOne({
      'ownerRef.kind': storeRef.kind,
      'ownerRef.item': storeRef.item,
    });

    if (!store) {
      store = await ResourceStore.create({ ownerRef: storeRef });
    }

    if (structure.type === 'solar_array') {
      const factor = bodyMap.get(structure.bodyId.toString()) ?? 1.0;
      const energy = structure.specs.energyOutput * factor;
      store.energy += energy;
      await store.save();
    } else if (structure.type === 'fusion_plant') {
      const energyOutput = structure.specs.energyOutput;
      if (store.helium3 >= 1) {
        store.helium3 -= 1;
        store.energy += energyOutput;
        await store.save();
      } else if (store.hydrogen >= 1) {
        store.hydrogen -= 1;
        store.energy += energyOutput * 0.5;
        await store.save();
      }
    }
  }
}

/**
 * Helper: extract from a body's finite resource deposit.
 * Returns the actual amount extracted (may be less than requested if depleting).
 */
async function extractFromBody(
  body: InstanceType<typeof CelestialBody>,
  resourceType: string,
  requestedAmount: number,
): Promise<number> {
  const resource = body.resources.find(r => r.resourceType === resourceType);
  if (!resource || !resource.accessible || resource.remaining <= 0) return 0;

  const extracted = Math.min(requestedAmount, resource.remaining);
  resource.remaining -= extracted;

  if (resource.remaining <= 0) {
    resource.remaining = 0;
    resource.accessible = false;
  }

  await body.save();
  return extracted;
}

/**
 * Helper: extract from an asteroid's finite resource deposit.
 */
async function extractFromAsteroid(
  asteroid: InstanceType<typeof Asteroid>,
  resourceType: string,
  requestedAmount: number,
): Promise<number> {
  const resource = asteroid.resources.find(r => r.resourceType === resourceType);
  if (!resource || !resource.accessible || resource.remaining <= 0) return 0;

  const extracted = Math.min(requestedAmount, resource.remaining);
  resource.remaining -= extracted;

  if (resource.remaining <= 0) {
    resource.remaining = 0;
    resource.accessible = false;
  }

  // Check if asteroid is fully depleted
  const allDepleted = asteroid.resources.every(r => r.remaining <= 0);
  if (allDepleted) {
    asteroid.depleted = true;
  }

  await asteroid.save();
  return extracted;
}

/**
 * Execute mining for all operational mine structures and ship-based miners.
 * Resources are now FINITE — mining depletes deposits.
 */
export async function executeMining(tick: number): Promise<void> {
  // --- Structure-based mining ---
  const mines = await Structure.find({
    status: 'operational',
    type: 'mine',
  });

  for (const mine of mines) {
    const body = await CelestialBody.findById(mine.bodyId);
    if (!body || body.resources.length === 0) continue;

    // Check colony power ratio
    let powerRatio = 1.0;
    if (mine.colonyId) {
      const colony = await Colony.findById(mine.colonyId).lean();
      if (colony) powerRatio = colony.stats.powerRatio;
    }

    // Determine storage target (colony pool or structure)
    const storeRef = mine.colonyId
      ? { kind: 'Colony' as const, item: mine.colonyId }
      : { kind: 'Structure' as const, item: mine._id };

    let store = await ResourceStore.findOne({
      'ownerRef.kind': storeRef.kind,
      'ownerRef.item': storeRef.item,
    });

    if (!store) {
      store = await ResourceStore.create({ ownerRef: storeRef });
    }

    for (const res of body.resources) {
      if (!res.accessible || res.remaining <= 0) continue;

      const requestedAmount = mine.specs.miningRate * res.abundance * powerRatio;
      if (requestedAmount <= 0) continue;

      const extracted = await extractFromBody(body, res.resourceType, requestedAmount);
      if (extracted <= 0) continue;

      const storeAny = store as unknown as Record<string, number>;
      if (res.resourceType in store && typeof storeAny[res.resourceType] === 'number') {
        storeAny[res.resourceType] += extracted;
      }
    }

    await store.save();
  }

  // --- Ship-based mining (ships with active miner AMIs) ---
  const minerAMIs = await AMI.find({
    type: 'miner',
    status: 'active',
    shipId: { $ne: null },
  });

  for (const ami of minerAMIs) {
    const ship = await Ship.findById(ami.shipId);
    if (!ship || ship.status !== 'orbiting') continue;
    if (ship.specs.miningRate <= 0) continue;

    let store = await ResourceStore.findOne({
      'ownerRef.kind': 'Ship',
      'ownerRef.item': ship._id,
    });

    if (!store) {
      store = await ResourceStore.create({
        ownerRef: { kind: 'Ship', item: ship._id },
      });
    }

    // Check if mining a celestial body or an asteroid
    if (ship.orbitingBodyId) {
      const body = await CelestialBody.findById(ship.orbitingBodyId);
      if (!body || body.resources.length === 0) continue;

      for (const res of body.resources) {
        if (!res.accessible || res.remaining <= 0) continue;

        const requestedAmount = ship.specs.miningRate * res.abundance;
        if (requestedAmount <= 0) continue;

        const extracted = await extractFromBody(body, res.resourceType, requestedAmount);
        if (extracted <= 0) continue;

        const storeAny = store as unknown as Record<string, number>;
        if (res.resourceType in store && typeof storeAny[res.resourceType] === 'number') {
          storeAny[res.resourceType] += extracted;
        }
      }
    } else if (ship.orbitingAsteroidId) {
      const asteroid = await Asteroid.findById(ship.orbitingAsteroidId);
      if (!asteroid || asteroid.depleted) continue;

      for (const res of asteroid.resources) {
        if (!res.accessible || res.remaining <= 0) continue;

        const requestedAmount = ship.specs.miningRate * res.abundance;
        if (requestedAmount <= 0) continue;

        const extracted = await extractFromAsteroid(asteroid, res.resourceType, requestedAmount);
        if (extracted <= 0) continue;

        const storeAny = store as unknown as Record<string, number>;
        if (res.resourceType in store && typeof storeAny[res.resourceType] === 'number') {
          storeAny[res.resourceType] += extracted;
        }
      }
    }

    await store.save();
  }
}
