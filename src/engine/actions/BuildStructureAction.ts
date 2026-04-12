import { Ship, Structure, ResourceStore, CelestialBody } from '../../db/models/index.js';
import type { IActionQueue } from '../../db/models/index.js';
import type { StructureType } from '../../shared/types.js';
import { InvalidActionError, NotFoundError, InsufficientResourcesError } from '../../shared/errors.js';

/** Default construction specs for each structure type. */
const STRUCTURE_DEFAULTS: Record<string, {
  requiredTicks: number;
  materials: Record<string, number>;
  specs: Record<string, number>;
}> = {
  habitat: {
    requiredTicks: 10,
    materials: { alloys: 50, hullPlating: 20, lifeSupportUnits: 5 },
    specs: { dockingSlots: 2, storageCapacity: 500 },
  },
  mine: {
    requiredTicks: 5,
    materials: { alloys: 20, electronics: 5 },
    specs: { miningRate: 10, storageCapacity: 200 },
  },
  refinery: {
    requiredTicks: 8,
    materials: { alloys: 30, electronics: 10, computers: 2 },
    specs: { refiningRate: 5, storageCapacity: 300, energyConsumption: 20 },
  },
  factory: {
    requiredTicks: 8,
    materials: { alloys: 30, electronics: 10, computers: 5 },
    specs: { manufacturingRate: 5, storageCapacity: 300, energyConsumption: 25 },
  },
  solar_array: {
    requiredTicks: 3,
    materials: { alloys: 10, solarPanels: 5 },
    specs: { energyOutput: 50 },
  },
  fusion_plant: {
    requiredTicks: 12,
    materials: { alloys: 40, fusionCores: 2, electronics: 15 },
    specs: { energyOutput: 200, energyConsumption: 0 },
  },
  shipyard: {
    requiredTicks: 15,
    materials: { alloys: 60, electronics: 20, computers: 5 },
    specs: { dockingSlots: 4, storageCapacity: 1000, manufacturingRate: 3 },
  },
  sensor_station: {
    requiredTicks: 4,
    materials: { alloys: 10, sensors: 5, electronics: 5 },
    specs: { sensorRange: 5 },
  },
  relay_station: {
    requiredTicks: 3,
    materials: { alloys: 5, electronics: 10, computers: 2 },
    specs: { storageCapacity: 50 },
  },
};

/**
 * Build a new structure at the ship's current location.
 * Validates materials in ship cargo, deducts them, creates Structure with status='building'.
 */
export async function handleBuildStructure(action: IActionQueue, tick: number): Promise<Record<string, unknown>> {
  const { shipId, structureType, name } = action.params as {
    shipId?: string;
    structureType?: string;
    name?: string;
  };

  if (!shipId) {
    throw new InvalidActionError('Missing shipId in build_structure params');
  }
  if (!structureType) {
    throw new InvalidActionError('Missing structureType in build_structure params');
  }

  const defaults = STRUCTURE_DEFAULTS[structureType];
  if (!defaults) {
    throw new InvalidActionError(`Unknown structure type: ${structureType}`);
  }

  const ship = await Ship.findById(shipId);
  if (!ship) {
    throw new NotFoundError('Ship', shipId);
  }

  if (ship.ownerId.toString() !== action.replicantId.toString()) {
    throw new InvalidActionError('Ship does not belong to this replicant');
  }

  if (ship.status !== 'orbiting') {
    throw new InvalidActionError('Ship must be orbiting a body to build a structure');
  }

  if (!ship.orbitingBodyId) {
    throw new InvalidActionError('Ship is not orbiting any celestial body');
  }

  const body = await CelestialBody.findById(ship.orbitingBodyId);
  if (!body) {
    throw new NotFoundError('CelestialBody', ship.orbitingBodyId.toString());
  }

  // Check ship cargo for required materials
  const shipStore = await ResourceStore.findOne({
    'ownerRef.kind': 'Ship',
    'ownerRef.item': ship._id,
  });

  if (!shipStore) {
    throw new InvalidActionError('Ship has no resource store');
  }

  // Validate all materials available
  const storeAny = shipStore as unknown as Record<string, number>;
  for (const [resource, amount] of Object.entries(defaults.materials)) {
    const available = storeAny[resource] ?? 0;
    if (available < amount) {
      throw new InsufficientResourcesError(resource, amount, available);
    }
  }

  // Deduct materials
  for (const [resource, amount] of Object.entries(defaults.materials)) {
    storeAny[resource] -= amount;
  }
  await shipStore.save();

  // Create the structure
  const structure = await Structure.create({
    name: name || `${structureType}-${body.name}-${tick}`,
    ownerId: action.replicantId,
    type: structureType as StructureType,
    status: 'building',
    bodyId: body._id,
    construction: {
      complete: false,
      progressTicks: 0,
      requiredTicks: defaults.requiredTicks,
    },
    specs: {
      miningRate: defaults.specs.miningRate ?? 0,
      refiningRate: defaults.specs.refiningRate ?? 0,
      manufacturingRate: defaults.specs.manufacturingRate ?? 0,
      energyOutput: defaults.specs.energyOutput ?? 0,
      energyConsumption: defaults.specs.energyConsumption ?? 0,
      sensorRange: defaults.specs.sensorRange ?? 0,
      dockingSlots: defaults.specs.dockingSlots ?? 0,
      storageCapacity: defaults.specs.storageCapacity ?? 500,
    },
    createdAtTick: tick,
  });

  // Create a ResourceStore for the new structure
  await ResourceStore.create({
    ownerRef: { kind: 'Structure', item: structure._id },
  });

  return {
    structureId: structure._id.toString(),
    structureType,
    name: structure.name,
    bodyId: body._id.toString(),
    bodyName: body.name,
    requiredTicks: defaults.requiredTicks,
    status: 'building',
  };
}
