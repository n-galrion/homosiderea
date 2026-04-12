import { Router, type Request, type Response, type NextFunction } from 'express';
import { ActionQueue, Tick } from '../../db/models/index.js';
import { evaluateAction, applyOutcomes } from '../../engine/systems/ActionEvaluator.js';
import { ACTION_TYPES } from '../../shared/constants.js';
import { config } from '../../config.js';
import { gameHoursPerTick, gameHoursToRealMs, formatGameTime, formatRealWait } from '../../shared/gameTime.js';

export const actionRoutes = Router();

/** Compute timing info for an action or event that resolves at a target tick. */
function timingInfo(currentTick: number, targetTick: number) {
  const ticksRemaining = Math.max(0, targetTick - currentTick);
  const gameHoursRemaining = ticksRemaining * gameHoursPerTick();
  return {
    currentTick,
    targetTick,
    ticksRemaining,
    gameTimeRemaining: formatGameTime(gameHoursRemaining),
    realTimeRemaining: formatRealWait(gameHoursRemaining),
    estimatedWaitMs: gameHoursToRealMs(gameHoursRemaining),
  };
}

// Propose a free-text action (MC-evaluated)
actionRoutes.post('/propose', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { action, context, autoApply = true } = req.body;
    if (!action || typeof action !== 'string') {
      res.status(400).json({ error: 'VALIDATION', message: 'action (string) is required' });
      return;
    }

    const outcome = await evaluateAction(req.replicantId!, action, context || undefined);

    if (outcome.impossible) {
      res.json({
        status: 'IMPOSSIBLE',
        reason: outcome.impossibleReason,
      });
      return;
    }

    if (!outcome.feasible) {
      res.json({
        status: 'NOT_FEASIBLE',
        reason: outcome.reason,
        prerequisites: outcome.prerequisites,
      });
      return;
    }

    if (autoApply) {
      const log = await applyOutcomes(req.replicantId!, outcome);

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      await ActionQueue.create({
        replicantId: req.replicantId,
        type: 'proposed_action',
        status: 'completed',
        params: { action, context, evaluatedBy: 'ship_computer' },
        result: { outcomes: outcome.outcomes, narrative: outcome.outcomes?.narrative, log },
        queuedAtTick: currentTick,
        resolvedAtTick: currentTick,
      });

      const ticksToComplete = outcome.ticksToComplete ?? 0;
      const estimatedCompletionTick = currentTick + ticksToComplete;

      res.json({
        status: 'EXECUTED',
        narrative: outcome.outcomes?.narrative,
        reason: outcome.reason,
        costs: { compute: outcome.computeCost, energy: outcome.energyCost, ticks: outcome.ticksToComplete },
        outcomes: outcome.outcomes,
        appliedChanges: log,
        timing: timingInfo(currentTick, estimatedCompletionTick),
      });
      return;
    }

    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const currentTick = latestTick?.tickNumber ?? 0;
    const ticksToComplete = outcome.ticksToComplete ?? 0;
    const estimatedCompletionTick = currentTick + ticksToComplete;

    res.json({
      status: 'PREVIEW',
      reason: outcome.reason,
      costs: { compute: outcome.computeCost, energy: outcome.energyCost, ticks: outcome.ticksToComplete },
      outcomes: outcome.outcomes,
      timing: timingInfo(currentTick, estimatedCompletionTick),
    });
  } catch (err) {
    next(err);
  }
});

// Submit a structured action (tick-resolved)
actionRoutes.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, params, priority } = req.body;
    if (!type || !params) {
      res.status(400).json({ error: 'VALIDATION', message: 'type and params are required' });
      return;
    }

    // Validate action type
    const validTypes = [...ACTION_TYPES];
    if (!validTypes.includes(type)) {
      res.status(400).json({
        error: 'INVALID_ACTION_TYPE',
        message: `Unknown action type: "${type}". Valid types: ${validTypes.join(', ')}. For free-text actions, use POST /api/actions/propose instead.`,
      });
      return;
    }

    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const currentTick = latestTick?.tickNumber ?? 0;
    const estimatedCompletionTick = currentTick + 1;

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
      message: `Action queued. Will be resolved on tick ${estimatedCompletionTick}.`,
      timing: timingInfo(currentTick, estimatedCompletionTick),
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
