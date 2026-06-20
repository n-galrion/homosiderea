/** Sentinel sender IDs for non-replicant message origins. */
export const MISSION_CONTROL_ID = '000000000000000000000002';
const NPC_OWNER_ID = '000000000000000000000000';
const PIRATE_OWNER_ID = '000000000000000000000001';

/**
 * Resolve a message's senderId into a human-readable label.
 * Sentinel IDs map to fixed labels; everything else uses the resolved
 * replicant name (from a populate/lookup) or falls back to 'Unknown'.
 */
export function senderLabel(senderId: string | null | undefined, resolvedName?: string | null): string {
  switch (senderId) {
    case MISSION_CONTROL_ID: return 'Mission Control';
    case NPC_OWNER_ID: return 'NPC Traffic';
    case PIRATE_OWNER_ID: return 'Pirate';
    default: return resolvedName || 'Unknown';
  }
}
