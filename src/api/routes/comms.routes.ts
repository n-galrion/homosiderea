import { Router, type Request, type Response, type NextFunction } from 'express';
import { Message, Tick, Ship, Replicant } from '../../db/models/index.js';
import { distance, lightDelayTicks } from '../../shared/physics.js';
import type { Position } from '../../shared/types.js';

export const commsRoutes = Router();

// Send a message
commsRoutes.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { recipientId, subject, body, metadata } = req.body;
    if (!body) {
      res.status(400).json({ error: 'VALIDATION', message: 'body is required' });
      return;
    }

    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const currentTick = latestTick?.tickNumber ?? 0;

    // Get sender position from their ship
    const senderReplicant = req.replicant!;
    let senderPos: Position = { x: 1, y: 0, z: 0 }; // default: Earth
    if (senderReplicant.locationRef?.item) {
      const ship = await Ship.findById(senderReplicant.locationRef.item).lean();
      if (ship) senderPos = ship.position;
    }

    // Get recipient position
    let recipientPos: Position = { x: 1, y: 0, z: 0 };
    if (recipientId) {
      const recipient = await Replicant.findById(recipientId);
      if (!recipient) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Recipient not found' });
        return;
      }
      if (recipient.locationRef?.item) {
        const ship = await Ship.findById(recipient.locationRef.item).lean();
        if (ship) recipientPos = ship.position;
      }
    }

    const dist = distance(senderPos, recipientPos);
    const delay = lightDelayTicks(senderPos, recipientPos);

    const message = await Message.create({
      senderId: req.replicantId,
      recipientId: recipientId || null,
      subject: subject || '',
      body,
      metadata: metadata || {},
      senderPosition: senderPos,
      recipientPosition: recipientPos,
      distanceAU: dist,
      sentAtTick: currentTick,
      deliverAtTick: currentTick + delay,
    });

    res.status(201).json({
      id: message._id,
      distanceAU: dist.toFixed(4),
      delayTicks: delay,
      estimatedDeliveryTick: currentTick + delay,
      message: delay === 0
        ? 'Message delivered instantly (same location).'
        : `Message will arrive in ${delay} tick(s) due to light-speed delay.`,
    });
  } catch (err) {
    next(err);
  }
});

// Read inbox
commsRoutes.get('/inbox', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { unreadOnly, limit = '50', from } = req.query;
    const filter: Record<string, unknown> = {
      recipientId: req.replicantId,
      delivered: true,
    };
    if (unreadOnly === 'true') filter.read = false;
    if (from) filter.senderId = from;

    const messages = await Message.find(filter)
      .sort({ deliverAtTick: -1 })
      .limit(parseInt(limit as string, 10))
      .lean();

    res.json(messages);
  } catch (err) {
    next(err);
  }
});

// Get specific message
commsRoutes.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const message = await Message.findOne({
      _id: req.params.id,
      $or: [
        { recipientId: req.replicantId },
        { senderId: req.replicantId },
      ],
    });

    if (!message) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Message not found' });
      return;
    }

    // Mark as read if recipient
    if (message.recipientId?.toString() === req.replicantId && !message.read) {
      message.read = true;
      await message.save();
    }

    res.json(message);
  } catch (err) {
    next(err);
  }
});

// Sent messages
commsRoutes.get('/sent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const messages = await Message.find({ senderId: req.replicantId })
      .sort({ sentAtTick: -1 })
      .limit(50)
      .lean();
    res.json(messages);
  } catch (err) {
    next(err);
  }
});
