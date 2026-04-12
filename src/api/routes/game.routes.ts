import { Router, type Request, type Response, type NextFunction } from 'express';
import { Tick, Replicant } from '../../db/models/index.js';
import { config } from '../../config.js';

export const gameRoutes = Router();

// Get current game state
gameRoutes.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const replicantCount = await Replicant.countDocuments({ status: 'active' });

    res.json({
      game: 'Homosideria: To the Stars',
      version: '0.1.0',
      currentTick: latestTick?.tickNumber ?? 0,
      tickIntervalMs: config.game.tickIntervalMs,
      gameTimePerTick: `${config.game.gameTimePerTick}s (1 hour)`,
      activeReplicants: replicantCount,
      lastTickAt: latestTick?.completedAt ?? null,
      lastTickDurationMs: latestTick?.durationMs ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// Get specific tick data
gameRoutes.get('/tick/:number', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tickNumber = parseInt(req.params.number as string, 10);
    const tick = await Tick.findOne({ tickNumber }).lean();
    if (!tick) {
      res.status(404).json({ error: 'NOT_FOUND', message: `Tick ${tickNumber} not found` });
      return;
    }
    res.json(tick);
  } catch (err) {
    next(err);
  }
});
