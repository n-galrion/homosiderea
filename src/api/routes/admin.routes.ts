import { Router, type Request, type Response, type NextFunction } from 'express';
import { Tick, Replicant, CelestialBody, Settlement, Market, Ship, ActionQueue, Colony, Technology, Message } from '../../db/models/index.js';

// GameLoop reference will be set at startup
let gameLoopRef: { forceTick: () => Promise<unknown>; getCurrentTick: () => number } | null = null;

export function setGameLoopRef(gl: typeof gameLoopRef) {
  gameLoopRef = gl;
}

export const adminRoutes = Router();

// Force an immediate tick
adminRoutes.post('/tick/force', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!gameLoopRef) {
      res.status(503).json({ error: 'NOT_READY', message: 'Game loop not initialized' });
      return;
    }

    const result = await gameLoopRef.forceTick();
    res.json({ message: 'Tick forced', result });
  } catch (err) {
    next(err);
  }
});

// Get tick history
adminRoutes.get('/ticks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit = '20' } = req.query;
    const ticks = await Tick.find()
      .sort({ tickNumber: -1 })
      .limit(parseInt(limit as string, 10))
      .lean();
    res.json(ticks);
  } catch (err) {
    next(err);
  }
});

// List all replicants (admin view)
adminRoutes.get('/replicants', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const replicants = await Replicant.find()
      .select('-apiKey')
      .lean();
    res.json(replicants);
  } catch (err) {
    next(err);
  }
});

// List all settlements
adminRoutes.get('/settlements', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const settlements = await Settlement.find().lean();
    res.json(settlements);
  } catch (err) {
    next(err);
  }
});

// List all markets
adminRoutes.get('/markets', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const markets = await Market.find().populate('settlementId', 'name nation').lean();
    res.json(markets);
  } catch (err) {
    next(err);
  }
});

// List all ships
adminRoutes.get('/ships', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const ships = await Ship.find({ status: { $ne: 'destroyed' } }).lean();
    res.json(ships);
  } catch (err) {
    next(err);
  }
});

// Recent actions across all replicants
adminRoutes.get('/actions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit = '50' } = req.query;
    const actions = await ActionQueue.find()
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string, 10))
      .populate('replicantId', 'name')
      .lean();
    res.json(actions);
  } catch (err) {
    next(err);
  }
});

// All colonies
adminRoutes.get('/colonies', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const colonies = await Colony.find().populate('bodyId', 'name').lean();
    res.json(colonies);
  } catch (err) {
    next(err);
  }
});

// All technologies
adminRoutes.get('/technologies', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const technologies = await Technology.find()
      .populate('inventedBy', 'name')
      .populate('knownBy', 'name')
      .lean();
    res.json(technologies);
  } catch (err) {
    next(err);
  }
});

// All messages
adminRoutes.get('/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit = '50' } = req.query;
    const messages = await Message.find()
      .sort({ sentAtTick: -1 })
      .limit(parseInt(limit as string, 10))
      .populate('senderId', 'name')
      .populate('recipientId', 'name')
      .lean();
    res.json(messages);
  } catch (err) {
    next(err);
  }
});

// Game status overview
adminRoutes.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [replicants, bodies, ticks] = await Promise.all([
      Replicant.countDocuments({ status: 'active' }),
      CelestialBody.countDocuments(),
      Tick.findOne().sort({ tickNumber: -1 }).lean(),
    ]);

    res.json({
      currentTick: ticks?.tickNumber ?? 0,
      activeReplicants: replicants,
      celestialBodies: bodies,
      gameLoopActive: !!gameLoopRef,
    });
  } catch (err) {
    next(err);
  }
});
