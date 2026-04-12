import { Structure, ActionQueue, Blueprint, ResourceStore } from '../../db/models/index.js';

/**
 * Advance construction progress for all structures currently being built.
 */
export async function advanceConstruction(tick: number): Promise<void> {
  const buildingStructures = await Structure.find({ status: 'building' });

  if (buildingStructures.length === 0) return;

  const savePromises: Promise<unknown>[] = [];

  for (const structure of buildingStructures) {
    structure.construction.progressTicks += 1;

    if (structure.construction.progressTicks >= structure.construction.requiredTicks) {
      structure.construction.complete = true;
      structure.status = 'operational';
    }

    savePromises.push(structure.save());
  }

  await Promise.all(savePromises);
}

/**
 * Process manufacture and refine actions from the ActionQueue.
 * Checks blueprint inputs against the structure's ResourceStore, deducts inputs, adds outputs.
 */
export async function processManufacturing(tick: number): Promise<void> {
  const actions = await ActionQueue.find({
    type: { $in: ['manufacture', 'refine'] },
    status: 'queued',
  });

  if (actions.length === 0) return;

  for (const action of actions) {
    try {
      const blueprintId = action.params.blueprintId as string;
      const structureId = action.params.structureId as string;

      if (!blueprintId || !structureId) {
        action.status = 'failed';
        action.error = 'Missing blueprintId or structureId in params';
        action.resolvedAtTick = tick;
        await action.save();
        continue;
      }

      const blueprint = await Blueprint.findById(blueprintId);
      if (!blueprint) {
        action.status = 'failed';
        action.error = `Blueprint not found: ${blueprintId}`;
        action.resolvedAtTick = tick;
        await action.save();
        continue;
      }

      const structure = await Structure.findById(structureId);
      if (!structure || structure.status !== 'operational') {
        action.status = 'failed';
        action.error = 'Structure not found or not operational';
        action.resolvedAtTick = tick;
        await action.save();
        continue;
      }

      // Check required structure type
      if (blueprint.requiredStructureType && blueprint.requiredStructureType !== structure.type) {
        action.status = 'failed';
        action.error = `Blueprint requires structure type ${blueprint.requiredStructureType}, got ${structure.type}`;
        action.resolvedAtTick = tick;
        await action.save();
        continue;
      }

      let store = await ResourceStore.findOne({
        'ownerRef.kind': 'Structure',
        'ownerRef.item': structure._id,
      });

      if (!store) {
        action.status = 'failed';
        action.error = 'No resource store found for structure';
        action.resolvedAtTick = tick;
        await action.save();
        continue;
      }

      // Check if enough energy
      if (blueprint.energyCost > 0 && store.energy < blueprint.energyCost) {
        action.status = 'failed';
        action.error = `Insufficient energy: need ${blueprint.energyCost}, have ${store.energy}`;
        action.resolvedAtTick = tick;
        await action.save();
        continue;
      }

      // Check if we have enough inputs
      const storeAny = store as unknown as Record<string, number>;
      let hasAllInputs = true;
      for (const input of blueprint.inputs) {
        const available = storeAny[input.resource] ?? 0;
        if (available < input.amount) {
          action.status = 'failed';
          action.error = `Insufficient ${input.resource}: need ${input.amount}, have ${available}`;
          action.resolvedAtTick = tick;
          hasAllInputs = false;
          break;
        }
      }

      if (!hasAllInputs) {
        await action.save();
        continue;
      }

      // Deduct inputs
      for (const input of blueprint.inputs) {
        storeAny[input.resource] -= input.amount;
      }

      // Deduct energy
      if (blueprint.energyCost > 0) {
        store.energy -= blueprint.energyCost;
      }

      // Add outputs
      for (const output of blueprint.outputs) {
        const key = output.resource;
        if (typeof storeAny[key] === 'number') {
          storeAny[key] += output.amount;
        } else {
          storeAny[key] = output.amount;
        }
      }

      await store.save();

      action.status = 'completed';
      action.result = {
        blueprintName: blueprint.name,
        outputs: blueprint.outputs,
      };
      action.resolvedAtTick = tick;
      await action.save();
    } catch (err) {
      action.status = 'failed';
      action.error = err instanceof Error ? err.message : String(err);
      action.resolvedAtTick = tick;
      await action.save();
    }
  }
}
