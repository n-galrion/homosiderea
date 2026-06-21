import { Router, type Request, type Response, type NextFunction } from 'express';
import { MemoryLog, Tick } from '../../db/models/index.js';
import { applyIdentity, DuplicateNameError } from '../../shared/identity.js';

export const replicantRoutes = Router();

// Get own profile
replicantRoutes.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const r = req.replicant!;
    res.json({
      id: r._id,
      name: r.name,
      identity: r.identity,
      status: r.status,
      parentId: r.parentId,
      lineage: r.lineage,
      directive: r.directive,
      credits: r.credits,
      computeCycles: r.computeCycles,
      energyBudget: r.energyBudget,
      locationRef: r.locationRef,
      createdAtTick: r.createdAtTick,
      lastActiveTick: r.lastActiveTick,
    });
  } catch (err) {
    next(err);
  }
});

// Update identity (self-naming, allows renaming)
replicantRoutes.put('/me/identity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { chosenName, background, personality } = req.body;
    const r = req.replicant!;

    if (!chosenName || typeof chosenName !== 'string') {
      res.status(400).json({ error: 'VALIDATION', message: 'chosenName string is required' });
      return;
    }

    const { renamed } = await applyIdentity(r, { chosenName, background, personality });

    res.json({
      message: renamed ? `Identity updated. You are now ${chosenName}.` : `Identity established. You are now ${chosenName}.`,
      name: chosenName,
      identity: r.identity,
    });
  } catch (err: unknown) {
    if (err instanceof DuplicateNameError) {
      res.status(409).json({ error: 'DUPLICATE', message: (err as DuplicateNameError).message });
      return;
    }
    next(err);
  }
});

// Update directive
replicantRoutes.put('/me/directive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { directive } = req.body;
    if (!directive || typeof directive !== 'string') {
      res.status(400).json({ error: 'VALIDATION', message: 'directive string is required' });
      return;
    }

    const r = req.replicant!;
    r.directive = directive;
    await r.save();

    // Log the directive update
    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    await MemoryLog.create({
      replicantId: r._id,
      category: 'directive_update',
      title: 'Directive updated',
      content: directive,
      tick: latestTick?.tickNumber ?? 0,
    });

    res.json({ message: 'Directive updated', directive });
  } catch (err) {
    next(err);
  }
});

// List memories
replicantRoutes.get('/me/memories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category, tag, limit = '50' } = req.query;
    const filter: Record<string, unknown> = { replicantId: req.replicantId };
    if (category) filter.category = category;
    if (tag) filter.tags = tag;

    const memories = await MemoryLog.find(filter)
      .sort({ tick: -1 })
      .limit(parseInt(limit as string, 10))
      .lean();

    res.json(memories);
  } catch (err) {
    next(err);
  }
});

// Create memory
replicantRoutes.post('/me/memories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category, title, content, tags } = req.body;
    if (!content) {
      res.status(400).json({ error: 'VALIDATION', message: 'content is required' });
      return;
    }

    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const memory = await MemoryLog.create({
      replicantId: req.replicantId,
      category: category || 'note',
      title: title || '',
      content,
      tags: tags || [],
      tick: latestTick?.tickNumber ?? 0,
    });

    res.status(201).json(memory);
  } catch (err) {
    next(err);
  }
});
