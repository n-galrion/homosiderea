import { Router, type Request, type Response, type NextFunction } from 'express';
import { ActionQueue, Tick } from '../../db/models/index.js';

export const actionRoutes = Router();

// Submit a new action
actionRoutes.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, params, priority } = req.body;
    if (!type || !params) {
      res.status(400).json({ error: 'VALIDATION', message: 'type and params are required' });
      return;
    }

    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const currentTick = latestTick?.tickNumber ?? 0;

    const action = await ActionQueue.create({
      replicantId: req.replicantId,
      type,
      params,
      priority: priority || 0,
      queuedAtTick: currentTick,
    });

    res.status(201).json({
      id: action._id,
      type: action.type,
      status: action.status,
      queuedAtTick: currentTick,
      message: `Action queued. Will be resolved on tick ${currentTick + 1}.`,
    });
  } catch (err) {
    next(err);
  }
});

// List own action queue
actionRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, type, limit = '50' } = req.query;
    const filter: Record<string, unknown> = { replicantId: req.replicantId };
    if (status) filter.status = status;
    if (type) filter.type = type;

    const actions = await ActionQueue.find(filter)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string, 10))
      .lean();

    res.json(actions);
  } catch (err) {
    next(err);
  }
});

// Get action status
actionRoutes.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const action = await ActionQueue.findOne({
      _id: req.params.id,
      replicantId: req.replicantId,
    }).lean();

    if (!action) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Action not found' });
      return;
    }

    res.json(action);
  } catch (err) {
    next(err);
  }
});
