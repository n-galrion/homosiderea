import { Router, type Request, type Response, type NextFunction } from 'express';
import { CelestialBody, ResourceStore } from '../../db/models/index.js';

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
