import { Router, type Request, type Response, type NextFunction } from 'express';
import { Colony, LandingSite, CelestialBody, Structure, ResourceStore } from '../../db/models/index.js';

export const colonyRoutes = Router();

// List own colonies
colonyRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const colonies = await Colony.find({ ownerId: req.replicantId }).lean();
    res.json(colonies);
  } catch (err) {
    next(err);
  }
});

// Get specific colony
colonyRoutes.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const colony = await Colony.findOne({ _id: req.params.id, ownerId: req.replicantId }).lean();
    if (!colony) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Colony not found' });
      return;
    }

    const body = await CelestialBody.findById(colony.bodyId).lean();
    const site = await LandingSite.findById(colony.siteId).lean();
    const structures = await Structure.find({ colonyId: colony._id }).lean();
    const store = await ResourceStore.findOne({
      'ownerRef.kind': 'Colony',
      'ownerRef.item': colony._id,
    }).lean();

    res.json({ colony, body: body?.name, site, structures, inventory: store });
  } catch (err) {
    next(err);
  }
});

// List landing sites on a body
colonyRoutes.get('/sites/:bodyId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sites = await LandingSite.find({
      bodyId: req.params.bodyId,
      discovered: true,
    }).lean();
    res.json(sites);
  } catch (err) {
    next(err);
  }
});
