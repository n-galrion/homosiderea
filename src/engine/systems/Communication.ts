import { Message } from '../../db/models/index.js';

/**
 * Deliver all messages whose delivery tick has been reached.
 * Returns the count of messages delivered this tick.
 */
export async function deliverMessages(tick: number): Promise<number> {
  const result = await Message.updateMany(
    {
      delivered: false,
      deliverAtTick: { $lte: tick },
    },
    {
      $set: { delivered: true },
    },
  );

  return result.modifiedCount;
}
