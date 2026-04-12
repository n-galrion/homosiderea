import {
  Ship, Structure, ActionQueue, Message, MemoryLog, Replicant, Colony, Tick,
} from '../../db/models/index.js';

interface LogEntry {
  replicantId: string;
  title: string;
  content: string;
}

/**
 * Auto-generate captain's log entries for significant events each tick.
 * These are stored as MemoryLog entries with category 'log' and tag 'auto'.
 */
export async function generateCaptainsLog(tick: number): Promise<number> {
  const entries: LogEntry[] = [];

  // 1. Ships that arrived at destination this tick
  //    (status changed to 'orbiting' and navigation was just cleared)
  const arrivedShips = await Ship.find({
    status: 'orbiting',
    'navigation.arrivalTick': null,  // navigation cleared = just arrived
    createdAtTick: { $lt: tick },    // not a brand new ship
  }).lean();

  // To detect arrivals, we look for completed move actions this tick
  const completedMoves = await ActionQueue.find({
    type: 'move',
    status: 'completed',
    resolvedAtTick: tick,
  }).lean();

  for (const action of completedMoves) {
    const ship = await Ship.findById(action.params.shipId).lean();
    if (!ship) continue;
    const destinationName = (action.result as Record<string, unknown>)?.destinationName
      || (action.params.destinationName as string)
      || 'unknown destination';
    entries.push({
      replicantId: action.replicantId.toString(),
      title: 'Ship arrived',
      content: `${ship.name} arrived at ${destinationName}.`,
    });
  }

  // 2. Mining yielded resources — summarize completed mine actions
  const completedMines = await ActionQueue.find({
    type: 'mine',
    status: 'completed',
    resolvedAtTick: tick,
  }).lean();

  for (const action of completedMines) {
    const result = action.result as Record<string, unknown> | null;
    if (result) {
      entries.push({
        replicantId: action.replicantId.toString(),
        title: 'Mining complete',
        content: `Mining operation completed. ${JSON.stringify(result)}`,
      });
    }
  }

  // 3. Structure construction completed
  const completedBuilds = await ActionQueue.find({
    type: 'build_structure',
    status: 'completed',
    resolvedAtTick: tick,
  }).lean();

  for (const action of completedBuilds) {
    const structureName = (action.result as Record<string, unknown>)?.structureName
      || (action.params.structureName as string)
      || 'a new structure';
    entries.push({
      replicantId: action.replicantId.toString(),
      title: 'Construction completed',
      content: `Construction of ${structureName} has been completed.`,
    });
  }

  // Also check structures that became operational this tick
  const newlyOperational = await Structure.find({
    status: 'operational',
    'construction.complete': true,
  }).lean();

  // 4. Research completed
  const completedResearch = await ActionQueue.find({
    type: { $in: ['proposed_action'] },
    status: 'completed',
    resolvedAtTick: tick,
  }).lean();

  // 5. Messages delivered this tick
  const deliveredMessages = await Message.find({
    delivered: true,
    deliverAtTick: tick,
  }).lean();

  for (const msg of deliveredMessages) {
    if (msg.recipientId) {
      entries.push({
        replicantId: msg.recipientId.toString(),
        title: 'Message received',
        content: `Message received from another replicant. Subject: "${msg.subject || '(no subject)'}"`,
      });
    }
  }

  // 6. New replicants spawned this tick
  const newReplicants = await Replicant.find({
    createdAtTick: tick,
    parentId: { $ne: null },
  }).lean();

  for (const child of newReplicants) {
    if (child.parentId) {
      entries.push({
        replicantId: child.parentId.toString(),
        title: 'Replicant spawned',
        content: `A new replicant "${child.name}" has been spawned from your consciousness.`,
      });
    }
    entries.push({
      replicantId: child._id.toString(),
      title: 'Awakening',
      content: `You have awakened as a new replicant. Your parent passed on their knowledge.`,
    });
  }

  // 7. Colony stats changed significantly — check for status changes
  const coloniesChangedStatus = await Colony.find({
    status: 'active',
    updatedAt: { $gte: new Date(Date.now() - 60000) }, // recently updated
  }).lean();

  // Write all log entries
  if (entries.length > 0) {
    await MemoryLog.insertMany(
      entries.map(e => ({
        replicantId: e.replicantId,
        category: 'log',
        title: e.title,
        content: e.content,
        tags: ['auto'],
        tick,
      })),
    );
  }

  return entries.length;
}
