import { MemoryLog, Tick } from '../db/models/index.js';
import type { IReplicant } from '../db/models/Replicant.js';

export interface IdentityFields {
  chosenName: string;
  background?: string | null;
  personality?: string | null;
}

/** Thrown when a chosen name collides with another replicant's unique name. */
export class DuplicateNameError extends Error {}

/**
 * Set or change a replicant's self-chosen identity. Updates the unique `name`
 * field and the identity sub-document, logs the change, and saves. First naming
 * records namedAtTick; later renames preserve the original namedAtTick. Throws
 * DuplicateNameError on a unique-name collision.
 */
export async function applyIdentity(replicant: IReplicant, fields: IdentityFields): Promise<{ renamed: boolean; name: string }> {
  const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
  const currentTick = latestTick?.tickNumber ?? 0;

  const prior = replicant.identity?.chosenName ?? null;
  const renamed = prior !== null && prior !== fields.chosenName;

  replicant.name = fields.chosenName;
  replicant.identity = {
    chosenName: fields.chosenName,
    background: fields.background ?? replicant.identity?.background ?? null,
    personality: fields.personality ?? replicant.identity?.personality ?? null,
    namedAtTick: replicant.identity?.namedAtTick ?? currentTick,
  };

  try {
    await replicant.save();
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as Record<string, unknown>).code === 11000) {
      throw new DuplicateNameError(`The name "${fields.chosenName}" is already taken. Choose another.`);
    }
    throw err;
  }

  await MemoryLog.create({
    replicantId: replicant._id,
    category: 'log',
    title: renamed ? 'Identity changed' : 'Identity chosen',
    content: `${renamed ? `Renamed from "${prior}" to` : 'Chose the name'} "${fields.chosenName}".${fields.background ? ` Background: ${fields.background}` : ''}${fields.personality ? ` Personality: ${fields.personality}` : ''}`,
    tags: ['auto', 'identity'],
    tick: currentTick,
  });

  return { renamed, name: fields.chosenName };
}
