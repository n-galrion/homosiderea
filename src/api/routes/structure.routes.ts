import { Router, type Request, type Response, type NextFunction } from 'express';
import { Structure, ResourceStore } from '../../db/models/index.js';

export const structureRoutes = Router();

// List own structures
structureRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, type, bodyId } = req.query;
    const filter: Record<string, unknown> = { ownerId: req.replicantId };
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (bodyId) filter.bodyId = bodyId;

    const structures = await Structure.find(filter).lean();
    res.json(structures);
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
    res.json(structure);
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
