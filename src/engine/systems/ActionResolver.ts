import { ActionQueue } from '../../db/models/index.js';
import type { IActionQueue } from '../../db/models/index.js';
import { actionHandlers } from '../actions/index.js';

/**
 * Resolve all queued actions in priority order.
 * Returns the count of actions processed.
 */
export async function resolveAll(tick: number): Promise<number> {
  const actions = await ActionQueue.find({ status: 'queued' }).sort({ priority: -1 });

  if (actions.length === 0) return 0;

  let processed = 0;

  for (const action of actions) {
    const handler = actionHandlers[action.type];

    if (!handler) {
      action.status = 'failed';
      action.error = `Unknown action type: ${action.type}`;
      action.resolvedAtTick = tick;
      await action.save();
      processed++;
      continue;
    }

    try {
      action.status = 'processing';
      await action.save();

      const result = await handler(action, tick);

      action.status = 'completed';
      action.result = result;
      action.resolvedAtTick = tick;
      await action.save();
    } catch (err) {
      action.status = 'failed';
      action.error = err instanceof Error ? err.message : String(err);
      action.resolvedAtTick = tick;
      await action.save();
    }

    processed++;
  }

  return processed;
}
