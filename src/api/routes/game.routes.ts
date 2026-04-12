import { Router, type Request, type Response, type NextFunction } from 'express';
import { Tick, Replicant, ActionQueue, Message, Ship, Colony, MemoryLog } from '../../db/models/index.js';
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

// Get tick narrative — human-readable summary of everything that happened
gameRoutes.get('/tick/:number/narrative', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tickNumber = parseInt(req.params.number as string, 10);
    const tick = await Tick.findOne({ tickNumber }).lean();
    if (!tick) {
      res.status(404).json({ error: 'NOT_FOUND', message: `Tick ${tickNumber} not found` });
      return;
    }

    const parts: string[] = [`Tick ${tickNumber}:`];

    // Completed actions this tick
    const completedActions = await ActionQueue.find({
      resolvedAtTick: tickNumber,
      status: 'completed',
    }).lean();

    // Ship arrivals (move actions)
    const moveActions = completedActions.filter(a => a.type === 'move');
    for (const action of moveActions) {
      const ship = await Ship.findById(action.params.shipId).lean();
      const destName = (action.result as Record<string, unknown>)?.destinationName
        || (action.params.destinationName as string)
        || 'its destination';
      if (ship) {
        parts.push(`${ship.name} arrived at ${destName}.`);
      }
    }

    // Mining operations
    const mineActions = completedActions.filter(a => a.type === 'mine');
    if (mineActions.length > 0) {
      const totalResources: Record<string, number> = {};
      for (const action of mineActions) {
        const result = action.result as Record<string, unknown> | null;
        if (result?.extracted && typeof result.extracted === 'object') {
          for (const [res, amt] of Object.entries(result.extracted as Record<string, number>)) {
            totalResources[res] = (totalResources[res] || 0) + amt;
          }
        }
      }
      const resourceSummary = Object.entries(totalResources)
        .map(([res, amt]) => `${amt.toFixed(1)} ${res}`)
        .join(', ');
      parts.push(`${mineActions.length} mining operation${mineActions.length > 1 ? 's' : ''} produced ${resourceSummary || 'resources'}.`);
    }

    // Construction completed
    const buildActions = completedActions.filter(a => a.type === 'build_structure');
    for (const action of buildActions) {
      const name = (action.result as Record<string, unknown>)?.structureName
        || (action.params.structureName as string)
        || 'a structure';
      parts.push(`Construction of ${name} completed.`);
    }

    // Colonies founded
    const colonyActions = completedActions.filter(a => a.type === 'found_colony');
    for (const action of colonyActions) {
      const colonyName = (action.result as Record<string, unknown>)?.colonyName
        || (action.params.colonyName as string)
        || 'a new colony';
      const replicant = await Replicant.findById(action.replicantId).lean();
      parts.push(`${replicant?.name || 'A replicant'} founded ${colonyName}.`);
    }

    // Messages delivered
    const messagesDelivered = await Message.countDocuments({
      delivered: true,
      deliverAtTick: tickNumber,
    });
    if (messagesDelivered > 0) {
      parts.push(`${messagesDelivered} message${messagesDelivered > 1 ? 's' : ''} delivered.`);
    }

    // New replicants
    const newReplicants = await Replicant.find({ createdAtTick: tickNumber, parentId: { $ne: null } }).lean();
    for (const r of newReplicants) {
      parts.push(`New replicant "${r.name}" awakened.`);
    }

    // Failed actions
    const failedActions = await ActionQueue.countDocuments({
      resolvedAtTick: tickNumber,
      status: 'failed',
    });
    if (failedActions > 0) {
      parts.push(`${failedActions} action${failedActions > 1 ? 's' : ''} failed.`);
    }

    // Tick stats
    if (tick.tickErrors.length > 0) {
      parts.push(`${tick.tickErrors.length} system error${tick.tickErrors.length > 1 ? 's' : ''} occurred.`);
    }

    const narrative = parts.join(' ');

    res.json({
      tickNumber,
      narrative,
      stats: {
        actionsProcessed: tick.actionsProcessed,
        messagesDelivered: tick.messagesDelivered,
        durationMs: tick.durationMs,
        errors: tick.tickErrors.length,
      },
    });
  } catch (err) {
    next(err);
  }
});
