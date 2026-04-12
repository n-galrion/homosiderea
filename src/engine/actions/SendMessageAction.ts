import { Replicant, Ship, Structure, Message } from '../../db/models/index.js';
import type { IActionQueue } from '../../db/models/index.js';
import type { Position } from '../../shared/types.js';
import { distance, lightDelayTicks } from '../../shared/physics.js';
import { InvalidActionError, NotFoundError } from '../../shared/errors.js';

/**
 * Send a message to another replicant with realistic light-speed delay.
 */
export async function handleSendMessage(action: IActionQueue, tick: number): Promise<Record<string, unknown>> {
  const { recipientId, subject, body, metadata } = action.params as {
    recipientId?: string;
    subject?: string;
    body?: string;
    metadata?: Record<string, unknown>;
  };

  if (!body) {
    throw new InvalidActionError('Missing message body');
  }

  // Find sender and determine position
  const sender = await Replicant.findById(action.replicantId);
  if (!sender) {
    throw new NotFoundError('Replicant', action.replicantId.toString());
  }

  const senderPos = await resolveReplicantPosition(sender);

  // Determine recipient and their position
  let recipientPos: Position = { x: 0, y: 0, z: 0 };
  let recipientObjId = null;

  if (recipientId) {
    const recipient = await Replicant.findById(recipientId);
    if (!recipient) {
      throw new NotFoundError('Replicant', recipientId);
    }
    recipientObjId = recipient._id;
    recipientPos = await resolveReplicantPosition(recipient);
  }
  // If no recipientId, it's a broadcast — deliver to origin (no delay)

  const dist = distance(senderPos, recipientPos);
  const delay = lightDelayTicks(senderPos, recipientPos);
  const deliverAtTick = tick + Math.max(delay, 1); // Minimum 1 tick delay

  const message = await Message.create({
    senderId: sender._id,
    recipientId: recipientObjId,
    subject: subject || '',
    body,
    metadata: metadata || {},
    senderPosition: senderPos,
    recipientPosition: recipientPos,
    distanceAU: dist,
    sentAtTick: tick,
    deliverAtTick,
    delivered: false,
    read: false,
  });

  return {
    messageId: message._id.toString(),
    distanceAU: dist,
    delayTicks: delay,
    deliverAtTick,
  };
}

/**
 * Resolve the position of a replicant based on their locationRef (Ship or Structure).
 */
async function resolveReplicantPosition(replicant: { locationRef: { kind: string; item: unknown } | null }): Promise<Position> {
  if (!replicant.locationRef) {
    return { x: 0, y: 0, z: 0 };
  }

  const { kind, item } = replicant.locationRef;

  if (kind === 'Ship') {
    const ship = await Ship.findById(item);
    if (ship) return ship.position;
  } else if (kind === 'Structure') {
    const structure = await Structure.findById(item);
    if (structure) {
      // Structures are on celestial bodies, so we need to look up the body's position
      const { CelestialBody } = await import('../../db/models/index.js');
      const body = await CelestialBody.findById(structure.bodyId);
      if (body) return body.position;
    }
  }

  return { x: 0, y: 0, z: 0 };
}
