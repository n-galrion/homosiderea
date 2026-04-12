import {
  Ship, Structure, ActionQueue, Message, MemoryLog, Replicant, Colony, Tick,
} from '../../db/models/index.js';

interface LogEntry {
  replicantId: string;
  title: string;
  content: string;
}

/**
 * Auto-generate FACTUAL log entries for significant events each tick.
 * These are system-level data entries — the replicant writes their own
 * captain's log interpretation via the write_memory tool.
 *
 * Tagged 'system' to distinguish from the replicant's own 'log' entries.
 */
export async function generateCaptainsLog(tick: number): Promise<number> {
  const entries: LogEntry[] = [];

  // Ship arrivals
  const completedMoves = await ActionQueue.find({
    type: 'move', status: 'completed', resolvedAtTick: tick,
  }).lean();

  for (const action of completedMoves) {
    const ship = await Ship.findById(action.params.shipId).lean();
    if (!ship) continue;
    const dest = (action.result as Record<string, unknown>)?.destinationName
      || (action.params.destinationName as string) || 'destination';
    entries.push({
      replicantId: action.replicantId.toString(),
      title: `Arrival: ${dest}`,
      content: `${ship.name} entered orbit at ${dest}. Fuel: ${ship.fuel}/${ship.specs.fuelCapacity}. Hull: ${ship.specs.hullPoints.toFixed(0)}/${ship.specs.maxHullPoints}.`,
    });
  }

  // Mining completions
  const completedMines = await ActionQueue.find({
    type: 'mine', status: 'completed', resolvedAtTick: tick,
  }).lean();
  for (const action of completedMines) {
    const result = action.result as Record<string, unknown> | null;
    entries.push({
      replicantId: action.replicantId.toString(),
      title: 'Mining operation',
      content: `Mining action resolved. ${result ? JSON.stringify(result) : 'No yield data.'}`,
    });
  }

  // Structure completions
  const completedBuilds = await ActionQueue.find({
    type: 'build_structure', status: 'completed', resolvedAtTick: tick,
  }).lean();
  for (const action of completedBuilds) {
    const name = (action.result as Record<string, unknown>)?.structureName
      || (action.params.name as string) || 'structure';
    entries.push({
      replicantId: action.replicantId.toString(),
      title: `Built: ${name}`,
      content: `Construction of ${name} (${action.params.structureType}) completed.`,
    });
  }

  // Messages delivered
  const deliveredMessages = await Message.find({
    delivered: true, deliverAtTick: tick,
    'metadata.type': { $nin: ['system_event', 'system_suggestion', 'planted_message', 'npc_conversation', 'npc_ship_conversation', 'world_event', 'rumor', 'security_alert', 'pirate_threat'] },
  }).lean();
  for (const msg of deliveredMessages) {
    if (msg.recipientId) {
      entries.push({
        replicantId: msg.recipientId.toString(),
        title: 'Message received',
        content: `From: ${msg.subject || 'unknown'}. Subject: "${msg.subject || '(none)'}".`,
      });
    }
  }

  // New replicants
  const newReplicants = await Replicant.find({
    createdAtTick: tick, parentId: { $ne: null },
  }).lean();
  for (const child of newReplicants) {
    if (child.parentId) {
      entries.push({
        replicantId: child.parentId.toString(),
        title: `Spawned: ${child.name}`,
        content: `New replicant "${child.name}" created from your consciousness. They have their own API credentials and autonomy.`,
      });
    }
  }

  if (entries.length > 0) {
    await MemoryLog.insertMany(
      entries.map(e => ({
        replicantId: e.replicantId,
        category: 'log',
        title: e.title,
        content: e.content,
        tags: ['system', 'auto'],
        tick,
      })),
    );
  }

  return entries.length;
}
