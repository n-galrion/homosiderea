import { ResourceStore, Ship, Structure } from '../../db/models/index.js';
import type { IActionQueue } from '../../db/models/index.js';
import { InvalidActionError, NotFoundError, InsufficientResourcesError } from '../../shared/errors.js';

/**
 * Transfer resources between two ResourceStores at the same location.
 * Supports Ship<->Ship, Ship<->Structure, Structure<->Structure transfers.
 */
export async function handleTransferResources(action: IActionQueue, tick: number): Promise<Record<string, unknown>> {
  const p = action.params as Record<string, unknown>;

  // Accept both naming conventions
  const sourceKind = (p.sourceKind || p.fromType) as 'Ship' | 'Structure' | undefined;
  const sourceId = (p.sourceId || p.fromId) as string | undefined;
  const targetKind = (p.targetKind || p.toType) as 'Ship' | 'Structure' | undefined;
  const targetId = (p.targetId || p.toId) as string | undefined;

  // Accept transfers as array [{resource, amount}] or object {resource: amount}
  let transfers: Array<{ resource: string; amount: number }> | undefined;
  if (Array.isArray(p.transfers)) {
    transfers = p.transfers as Array<{ resource: string; amount: number }>;
  } else if (p.resources && typeof p.resources === 'object') {
    transfers = Object.entries(p.resources as Record<string, number>)
      .filter(([, v]) => v > 0)
      .map(([resource, amount]) => ({ resource, amount }));
  }

  if (!sourceKind || !sourceId || !targetKind || !targetId) {
    throw new InvalidActionError(
      'Transfer requires: fromId + fromType + toId + toType + resources. ' +
      'fromType/toType must be "Ship" or "Structure". ' +
      'resources is an object like { "metals": 50, "fuel": 20 }. ' +
      'Example: { "fromId": "shipId", "fromType": "Ship", "toId": "structureId", "toType": "Structure", "resources": { "metals": 50 } }'
    );
  }
  if (!transfers || transfers.length === 0) {
    throw new InvalidActionError(
      'Must specify resources to transfer. Use: resources: { "metals": 50, "fuel": 20 }'
    );
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
