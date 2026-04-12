import { ResourceStore, Ship, Structure } from '../../db/models/index.js';
import type { IActionQueue } from '../../db/models/index.js';
import { InvalidActionError, NotFoundError, InsufficientResourcesError } from '../../shared/errors.js';

/**
 * Transfer resources between two ResourceStores at the same location.
 * Supports Ship<->Ship, Ship<->Structure, Structure<->Structure transfers.
 */
export async function handleTransferResources(action: IActionQueue, tick: number): Promise<Record<string, unknown>> {
  const { sourceKind, sourceId, targetKind, targetId, transfers } = action.params as {
    sourceKind?: 'Ship' | 'Structure';
    sourceId?: string;
    targetKind?: 'Ship' | 'Structure';
    targetId?: string;
    transfers?: Array<{ resource: string; amount: number }>;
  };

  if (!sourceKind || !sourceId || !targetKind || !targetId) {
    throw new InvalidActionError('Must specify sourceKind, sourceId, targetKind, and targetId');
  }
  if (!transfers || transfers.length === 0) {
    throw new InvalidActionError('Must specify at least one resource transfer');
  }

  // Validate ownership — at least one entity must belong to the replicant
  const sourceOwned = await verifyOwnership(sourceKind, sourceId, action.replicantId.toString());
  const targetOwned = await verifyOwnership(targetKind, targetId, action.replicantId.toString());

  if (!sourceOwned && !targetOwned) {
    throw new InvalidActionError('At least one entity must belong to the replicant');
  }

  // Validate same location (both must be at the same celestial body or position)
  await validateSameLocation(sourceKind, sourceId, targetKind, targetId);

  // Find resource stores
  const sourceStore = await ResourceStore.findOne({
    'ownerRef.kind': sourceKind,
    'ownerRef.item': sourceId,
  });
  if (!sourceStore) {
    throw new NotFoundError('ResourceStore', `${sourceKind}:${sourceId}`);
  }

  const targetStore = await ResourceStore.findOne({
    'ownerRef.kind': targetKind,
    'ownerRef.item': targetId,
  });
  if (!targetStore) {
    throw new NotFoundError('ResourceStore', `${targetKind}:${targetId}`);
  }

  // Execute transfers
  const transferred: Array<{ resource: string; amount: number }> = [];
  const srcAny = sourceStore as unknown as Record<string, number>;
  const tgtAny = targetStore as unknown as Record<string, number>;

  for (const { resource, amount } of transfers) {
    if (amount <= 0) continue;

    const available = srcAny[resource] ?? 0;
    if (available < amount) {
      throw new InsufficientResourcesError(resource, amount, available);
    }

    srcAny[resource] -= amount;

    if (typeof tgtAny[resource] === 'number') {
      tgtAny[resource] += amount;
    } else {
      tgtAny[resource] = amount;
    }

    transferred.push({ resource, amount });
  }

  await sourceStore.save();
  await targetStore.save();

  return {
    sourceKind,
    sourceId,
    targetKind,
    targetId,
    transferred,
  };
}

async function verifyOwnership(kind: string, id: string, replicantId: string): Promise<boolean> {
  if (kind === 'Ship') {
    const ship = await Ship.findById(id);
    return ship?.ownerId.toString() === replicantId;
  } else if (kind === 'Structure') {
    const structure = await Structure.findById(id);
    return structure?.ownerId.toString() === replicantId;
  }
  return false;
}

async function validateSameLocation(
  sourceKind: string, sourceId: string,
  targetKind: string, targetId: string,
): Promise<void> {
  const sourceBodyId = await getEntityBodyId(sourceKind, sourceId);
  const targetBodyId = await getEntityBodyId(targetKind, targetId);

  // Both must be at a celestial body, and the same one
  if (!sourceBodyId || !targetBodyId) {
    throw new InvalidActionError('Both entities must be at a celestial body to transfer resources');
  }
  if (sourceBodyId !== targetBodyId) {
    throw new InvalidActionError('Both entities must be at the same location to transfer resources');
  }
}

async function getEntityBodyId(kind: string, id: string): Promise<string | null> {
  if (kind === 'Ship') {
    const ship = await Ship.findById(id);
    return ship?.orbitingBodyId?.toString() ?? null;
  } else if (kind === 'Structure') {
    const structure = await Structure.findById(id);
    return structure?.bodyId?.toString() ?? null;
  }
  return null;
}
