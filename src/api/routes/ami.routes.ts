import { Router, type Request, type Response, type NextFunction } from 'express';
import { AMI } from '../../db/models/index.js';

export const amiRoutes = Router();

// List own AMIs
amiRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, type } = req.query;
    const filter: Record<string, unknown> = { ownerId: req.replicantId };
    if (status) filter.status = status;
    if (type) filter.type = type;

    const amis = await AMI.find(filter).lean();
    res.json(amis);
  } catch (err) {
    next(err);
  }
});

// Get specific AMI
amiRoutes.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ami = await AMI.findOne({ _id: req.params.id, ownerId: req.replicantId }).lean();
    if (!ami) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'AMI not found' });
      return;
    }
    res.json(ami);
  } catch (err) {
    next(err);
  }
});

// Update AMI script
amiRoutes.put('/:id/script', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { customRules } = req.body;
    if (!customRules || !Array.isArray(customRules)) {
      res.status(400).json({ error: 'VALIDATION', message: 'customRules array is required' });
      return;
    }

    const ami = await AMI.findOne({ _id: req.params.id, ownerId: req.replicantId });
    if (!ami) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'AMI not found' });
      return;
    }

    ami.script = { type: 'custom', customRules };
    await ami.save();

    res.json({ message: 'AMI script updated', script: ami.script });
  } catch (err) {
    next(err);
  }
});
