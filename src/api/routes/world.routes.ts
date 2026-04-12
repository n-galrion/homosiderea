import { Router, type Request, type Response, type NextFunction } from 'express';
import { CelestialBody, ResourceStore, Settlement, Market, Replicant, Blueprint } from '../../db/models/index.js';
import { KnownEntity } from '../../db/models/KnownEntity.js';
import { ACTION_TYPES } from '../../shared/constants.js';

export const worldRoutes = Router();

/** Round a number to the nearest increment (e.g. 0.1 AU). */
function roundTo(value: number, increment: number): number {
  return Math.round(value / increment) * increment;
}

/** Shape a celestial body response based on intel level. */
function shapeBodyByIntel(body: Record<string, unknown>, intelLevel: string): Record<string, unknown> {
  switch (intelLevel) {
    case 'vague':
      return {
        _id: body._id,
        name: body.name,
        type: body.type,
        intelLevel,
        position: body.position ? {
          x: roundTo((body.position as { x: number; y: number; z: number }).x, 0.1),
          y: roundTo((body.position as { x: number; y: number; z: number }).y, 0.1),
          z: roundTo((body.position as { x: number; y: number; z: number }).z, 0.1),
        } : undefined,
      };
    case 'basic':
      return {
        _id: body._id,
        name: body.name,
        type: body.type,
        parentId: body.parentId,
        intelLevel,
        position: body.position,
        physical: body.physical ? {
          radius: (body.physical as Record<string, unknown>).radius,
          gravity: (body.physical as Record<string, unknown>).gravity,
          hasAtmosphere: (body.physical as Record<string, unknown>).hasAtmosphere,
        } : undefined,
        solarEnergyFactor: body.solarEnergyFactor,
      };
    case 'detailed':
      // Everything except exact resource remaining counts
      return {
        _id: body._id,
        name: body.name,
        type: body.type,
        parentId: body.parentId,
        intelLevel,
        position: body.position,
        physical: body.physical,
        solarEnergyFactor: body.solarEnergyFactor,
        orbit: body.orbit,
        beltConfig: body.beltConfig,
        resources: Array.isArray(body.resources)
          ? (body.resources as Array<Record<string, unknown>>).map(r => ({
              resourceType: r.resourceType,
              abundance: r.abundance,
              accessible: r.accessible,
              // Omit remaining and totalDeposit
            }))
          : undefined,
      };
    case 'complete':
    default:
      return { ...body, intelLevel };
  }
}

// List celestial bodies (fog-of-war filtered)
worldRoutes.get('/bodies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, parentId } = req.query;
    const allMode = req.query.all === 'true';
    const filter: Record<string, unknown> = {};
    if (type) filter.type = type;
    if (parentId) filter.parentId = parentId;

    // Admin / backward-compat mode: return everything
    if (allMode) {
      const bodies = await CelestialBody.find(filter)
        .select('name type parentId position physical.radius physical.gravity physical.hasAtmosphere solarEnergyFactor')
        .lean();
      res.json(bodies);
      return;
    }

    // Fog-of-war: only return bodies known to this replicant
    const replicantId = req.replicantId;
    if (!replicantId) {
      res.json([]);
      return;
    }

    const known = await KnownEntity.find({
      replicantId,
      entityType: 'celestial_body',
    }).lean();

    if (known.length === 0) {
      res.json([]);
      return;
    }

    const knownMap = new Map(known.map(k => [k.entityId.toString(), k.intelLevel]));
    const knownIds = known.map(k => k.entityId);
    filter._id = { $in: knownIds };

    const bodies = await CelestialBody.find(filter).lean();

    const shaped = bodies.map(b => {
      const intel = knownMap.get(b._id.toString()) || 'vague';
      return shapeBodyByIntel(b as unknown as Record<string, unknown>, intel);
    });

    res.json(shaped);
  } catch (err) {
    next(err);
  }
});

// Get specific body (fog-of-war filtered)
worldRoutes.get('/bodies/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allMode = req.query.all === 'true';

    if (allMode) {
      const body = await CelestialBody.findById(req.params.id).lean();
      if (!body) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Celestial body not found' });
        return;
      }
      res.json(body);
      return;
    }

    const replicantId = req.replicantId;
    if (!replicantId) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Celestial body not found' });
      return;
    }

    const knownEntry = await KnownEntity.findOne({
      replicantId,
      entityType: 'celestial_body',
      entityId: req.params.id,
    }).lean();

    if (!knownEntry) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Celestial body not found' });
      return;
    }

    const body = await CelestialBody.findById(req.params.id).lean();
    if (!body) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Celestial body not found' });
      return;
    }

    res.json(shapeBodyByIntel(body as unknown as Record<string, unknown>, knownEntry.intelLevel));
  } catch (err) {
    next(err);
  }
});

// Get resources on a body (fog-of-war filtered)
worldRoutes.get('/bodies/:id/resources', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allMode = req.query.all === 'true';
    const replicantId = req.replicantId;

    if (!allMode && replicantId) {
      const knownEntry = await KnownEntity.findOne({
        replicantId,
        entityType: 'celestial_body',
        entityId: req.params.id,
      }).lean();

      if (!knownEntry) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Celestial body not found' });
        return;
      }

      if (knownEntry.intelLevel === 'vague' || knownEntry.intelLevel === 'basic') {
        res.status(403).json({ error: 'INSUFFICIENT_INTEL', message: 'Need at least detailed intel level to see resources. Survey this body first.' });
        return;
      }
    }

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

// List settlements (fog-of-war filtered: only settlements on known bodies)
worldRoutes.get('/settlements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bodyId } = req.query;
    const allMode = req.query.all === 'true';
    const filter: Record<string, unknown> = {};
    if (bodyId) filter.bodyId = bodyId;

    if (allMode) {
      const settlements = await Settlement.find(filter)
        .select('name type nation population economy.techLevel economy.spaceportLevel status position bodyId attitude.general')
        .lean();
      res.json(settlements);
      return;
    }

    const replicantId = req.replicantId;
    if (!replicantId) {
      res.json([]);
      return;
    }

    // Get known settlement IDs
    const knownSettlements = await KnownEntity.find({
      replicantId,
      entityType: 'settlement',
    }).lean();

    if (knownSettlements.length === 0) {
      res.json([]);
      return;
    }

    const knownIds = knownSettlements.map(k => k.entityId);
    filter._id = { $in: knownIds };

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
    const allMode = req.query.all === 'true';

    if (!allMode && req.replicantId) {
      const knownEntry = await KnownEntity.findOne({
        replicantId: req.replicantId,
        entityType: 'settlement',
        entityId: req.params.id,
      }).lean();

      if (!knownEntry) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Settlement not found' });
        return;
      }
    }

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

// List known replicants (fog-of-war filtered: only encountered replicants)
worldRoutes.get('/replicants', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const allMode = req.query.all === 'true';

    if (allMode) {
      const replicants = await Replicant.find({ status: 'active' })
        .select('name status createdAtTick lastActiveTick')
        .lean();
      res.json(replicants);
      return;
    }

    const replicantId = req.replicantId;
    if (!replicantId) {
      res.json([]);
      return;
    }

    // Get known replicant IDs
    const knownReplicants = await KnownEntity.find({
      replicantId,
      entityType: 'replicant',
    }).lean();

    // Always include self
    const knownIds = knownReplicants.map(k => k.entityId.toString());
    if (!knownIds.includes(replicantId)) {
      knownIds.push(replicantId);
    }

    const replicants = await Replicant.find({ _id: { $in: knownIds }, status: 'active' })
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
