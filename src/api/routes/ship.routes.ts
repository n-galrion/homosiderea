import { Router, type Request, type Response, type NextFunction } from 'express';
import { Ship, ResourceStore } from '../../db/models/index.js';

export const shipRoutes = Router();

// List own ships
shipRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, type } = req.query;
    const filter: Record<string, unknown> = { ownerId: req.replicantId };
    if (status) filter.status = status;
    if (type) filter.type = type;

    const ships = await Ship.find(filter).lean();
    res.json(ships);
  } catch (err) {
    next(err);
  }
});

// Get specific ship
shipRoutes.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ship = await Ship.findOne({ _id: req.params.id, ownerId: req.replicantId }).lean();
    if (!ship) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Ship not found' });
      return;
    }
    res.json(ship);
  } catch (err) {
    next(err);
  }
});

// Get ship inventory
shipRoutes.get('/:id/inventory', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ship = await Ship.findOne({ _id: req.params.id, ownerId: req.replicantId }).lean();
    if (!ship) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Ship not found' });
      return;
    }

    const store = await ResourceStore.findOne({
      'ownerRef.kind': 'Ship',
      'ownerRef.item': ship._id,
    }).lean();

    res.json(store || { message: 'No inventory' });
  } catch (err) {
    next(err);
  }
});
