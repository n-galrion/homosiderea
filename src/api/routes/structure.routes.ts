import { Router, type Request, type Response, type NextFunction } from 'express';
import { Structure, ResourceStore, Tick } from '../../db/models/index.js';
import { config } from '../../config.js';
import { gameHoursPerTick, gameHoursToRealMs, formatGameTime, formatRealWait } from '../../shared/gameTime.js';

export const structureRoutes = Router();

/** Enrich a structure document with construction progress info if building. */
function enrichStructure(structure: Record<string, unknown>, currentTick: number): Record<string, unknown> {
  const enriched = { ...structure };

  if (structure.status === 'building') {
    const construction = structure.construction as { complete: boolean; progressTicks: number; requiredTicks: number } | undefined;
    if (construction) {
      const ticksRemaining = Math.max(0, construction.requiredTicks - construction.progressTicks);
      const percentComplete = construction.requiredTicks > 0
        ? Math.min(100, (construction.progressTicks / construction.requiredTicks) * 100)
        : 100;
      const gameHoursRemaining = ticksRemaining * gameHoursPerTick();

      enriched.constructionProgress = {
        percentComplete: parseFloat(percentComplete.toFixed(1)),
        ticksRemaining,
        gameTimeRemaining: formatGameTime(gameHoursRemaining),
        realTimeRemaining: formatRealWait(gameHoursRemaining),
        estimatedCompletionMs: gameHoursToRealMs(gameHoursRemaining),
        estimatedCompletionTick: currentTick + ticksRemaining,
      };
    }
  }

  return enriched;
}

// List own structures
structureRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, type, bodyId } = req.query;
    const filter: Record<string, unknown> = { ownerId: req.replicantId };
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (bodyId) filter.bodyId = bodyId;

    const structures = await Structure.find(filter).lean();

    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const currentTick = latestTick?.tickNumber ?? 0;

    const enriched = structures.map(s =>
      enrichStructure(s as unknown as Record<string, unknown>, currentTick)
    );

    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

// Get specific structure
structureRoutes.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const structure = await Structure.findOne({
      _id: req.params.id,
      ownerId: req.replicantId,
    }).lean();
    if (!structure) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Structure not found' });
      return;
    }

    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const currentTick = latestTick?.tickNumber ?? 0;

    res.json(enrichStructure(structure as unknown as Record<string, unknown>, currentTick));
  } catch (err) {
    next(err);
  }
});

// Get structure inventory
structureRoutes.get('/:id/inventory', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const structure = await Structure.findOne({
      _id: req.params.id,
      ownerId: req.replicantId,
    }).lean();
    if (!structure) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Structure not found' });
      return;
    }

    const store = await ResourceStore.findOne({
      'ownerRef.kind': 'Structure',
      'ownerRef.item': structure._id,
    }).lean();

    res.json(store || { message: 'No inventory' });
  } catch (err) {
    next(err);
  }
});
