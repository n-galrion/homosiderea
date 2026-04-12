import { Router, type Request, type Response, type NextFunction } from 'express';
import { CelestialBody, ResourceStore, Settlement, Market, Replicant, Blueprint } from '../../db/models/index.js';
import { ACTION_TYPES } from '../../shared/constants.js';

export const worldRoutes = Router();

// List all celestial bodies
worldRoutes.get('/bodies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, parentId } = req.query;
    const filter: Record<string, unknown> = {};
    if (type) filter.type = type;
    if (parentId) filter.parentId = parentId;

    const bodies = await CelestialBody.find(filter)
      .select('name type parentId position physical.radius physical.gravity physical.hasAtmosphere solarEnergyFactor')
      .lean();

    res.json(bodies);
  } catch (err) {
    next(err);
  }
});

// Get specific body
worldRoutes.get('/bodies/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = await CelestialBody.findById(req.params.id).lean();
    if (!body) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Celestial body not found' });
      return;
    }
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// Get resources on a body
worldRoutes.get('/bodies/:id/resources', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = await CelestialBody.findById(req.params.id).lean();
    if (!body) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Celestial body not found' });
      return;
    }
    res.json({
      bodyName: body.name,
      resources: body.resources,
    });
  } catch (err) {
    next(err);
  }
});

// List settlements (player-facing — public info)
worldRoutes.get('/settlements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bodyId } = req.query;
    const filter: Record<string, unknown> = {};
    if (bodyId) filter.bodyId = bodyId;

    const settlements = await Settlement.find(filter)
      .select('name type nation population economy.techLevel economy.spaceportLevel status position bodyId attitude.general')
      .lean();
    res.json(settlements);
  } catch (err) {
    next(err);
  }
});

// Get settlement detail + market
worldRoutes.get('/settlements/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settlement = await Settlement.findById(req.params.id).lean();
    if (!settlement) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Settlement not found' });
      return;
    }
    const market = await Market.findOne({ settlementId: settlement._id }).lean();
    res.json({ settlement, market });
  } catch (err) {
    next(err);
  }
});

// List known replicants (public directory — limited info)
worldRoutes.get('/replicants', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const replicants = await Replicant.find({ status: 'active' })
      .select('name status createdAtTick lastActiveTick')
      .lean();
    res.json(replicants);
  } catch (err) {
    next(err);
  }
});

// List valid action types and their param schemas
worldRoutes.get('/action-types', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      structured: ACTION_TYPES.map(t => t),
      propose: {
        endpoint: 'POST /api/actions/propose',
        body: '{ action: "free text description", context?: "additional context", autoApply?: true }',
        description: 'Ship computer simulates the physics and evaluates any free-text action',
      },
    });
  } catch (err) {
    next(err);
  }
});

// List blueprints (player-facing)
worldRoutes.get('/blueprints', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category } = req.query;
    const filter: Record<string, unknown> = {};
    if (category) filter.category = category;

    const blueprints = await Blueprint.find(filter).lean();
    res.json(blueprints);
  } catch (err) {
    next(err);
  }
});

// Solar system map (simplified positions)
worldRoutes.get('/map', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const bodies = await CelestialBody.find()
      .select('name type parentId position')
      .lean();

    res.json(bodies.map(b => ({
      id: b._id,
      name: b.name,
      type: b.type,
      parentId: b.parentId,
      x: b.position.x,
      y: b.position.y,
      z: b.position.z,
    })));
  } catch (err) {
    next(err);
  }
});
