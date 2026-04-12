import { nanoid } from 'nanoid';
import { Replicant, Ship, ResourceStore } from '../../db/models/index.js';
import type { IActionQueue } from '../../db/models/index.js';
import {
  REPLICATE_COMPUTE_COST,
  REPLICATE_ENERGY_COST,
  REPLICATE_STARTING_COMPUTE,
  DEFAULT_REPLICANT_ENERGY,
} from '../../shared/constants.js';
import { InvalidActionError, InsufficientResourcesError } from '../../shared/errors.js';

/**
 * Create a new replicant (self-replication).
 * Validates compute/energy costs, creates a new Replicant with a fresh API key,
 * and optionally transfers a ship to the new replicant.
 */
export async function handleReplicate(action: IActionQueue, tick: number): Promise<Record<string, unknown>> {
  const { name, directive, shipId } = action.params as {
    name?: string;
    directive?: string;
    shipId?: string;
  };

  if (!name) {
    throw new InvalidActionError('Missing name for new replicant');
  }

  // Check that the name is not already taken
  const existing = await Replicant.findOne({ name });
  if (existing) {
    throw new InvalidActionError(`Replicant name already taken: ${name}`);
  }

  // Find the parent replicant
  const parent = await Replicant.findById(action.replicantId);
  if (!parent) {
    throw new InvalidActionError('Parent replicant not found');
  }

  // Check compute cost
  if (parent.computeCycles < REPLICATE_COMPUTE_COST) {
    throw new InsufficientResourcesError('computeCycles', REPLICATE_COMPUTE_COST, parent.computeCycles);
  }

  // Check energy cost — need energy in the parent's location store
  if (parent.locationRef) {
    const store = await ResourceStore.findOne({
      'ownerRef.kind': parent.locationRef.kind,
      'ownerRef.item': parent.locationRef.item,
    });

    if (!store || store.energy < REPLICATE_ENERGY_COST) {
      throw new InsufficientResourcesError('energy', REPLICATE_ENERGY_COST, store?.energy ?? 0);
    }

    store.energy -= REPLICATE_ENERGY_COST;
    await store.save();
  } else {
    throw new InvalidActionError('Parent replicant has no location — cannot access energy');
  }

  // Deduct compute from parent
  parent.computeCycles -= REPLICATE_COMPUTE_COST;
  await parent.save();

  // Generate API key for the new replicant
  const apiKey = `rep_${nanoid(32)}`;

  // Build lineage: parent's lineage + parent's id
  const lineage = [...parent.lineage, parent._id];

  // Determine location for the new replicant
  let locationRef = parent.locationRef;

  // If a ship is specified, transfer ownership to the new replicant
  if (shipId) {
    const ship = await Ship.findById(shipId);
    if (!ship) {
      throw new InvalidActionError(`Ship not found: ${shipId}`);
    }
    if (ship.ownerId.toString() !== parent._id.toString()) {
      throw new InvalidActionError('Ship does not belong to parent replicant');
    }
    // Transfer ship ownership after creating the new replicant
    locationRef = { kind: 'Ship', item: ship._id };
  }

  const newReplicant = await Replicant.create({
    name,
    apiKey,
    parentId: parent._id,
    lineage,
    directive: directive || parent.directive,
    status: 'active',
    locationRef,
    computeCycles: REPLICATE_STARTING_COMPUTE,
    energyBudget: DEFAULT_REPLICANT_ENERGY,
    createdAtTick: tick,
    lastActiveTick: tick,
  });

  // Transfer ship ownership if specified
  if (shipId) {
    await Ship.findByIdAndUpdate(shipId, { ownerId: newReplicant._id });
  }

  return {
    replicantId: newReplicant._id.toString(),
    name: newReplicant.name,
    apiKey,
    parentId: parent._id.toString(),
    computeDeducted: REPLICATE_COMPUTE_COST,
    energyDeducted: REPLICATE_ENERGY_COST,
  };
}
