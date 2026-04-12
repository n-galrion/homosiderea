import { Router, type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { Replicant, Ship, ResourceStore, CelestialBody } from '../../db/models/index.js';
import { config } from '../../config.js';
import { Tick } from '../../db/models/index.js';
import { DEFAULT_REPLICANT_COMPUTE, DEFAULT_REPLICANT_ENERGY } from '../../shared/constants.js';

export const authRoutes = Router();

// Register a new replicant
authRoutes.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, directive } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'VALIDATION', message: 'name is required' });
      return;
    }

    // Get current tick
    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const currentTick = latestTick?.tickNumber ?? 0;

    const apiKey = `hs_${nanoid(32)}`;

    // Find Earth as the starting location
    const earth = await CelestialBody.findOne({ name: 'Earth' });

    const replicant = await Replicant.create({
      name,
      apiKey,
      directive: directive || `You are ${name}, a newly awakened Replicant in the Sol system.`,
      computeCycles: DEFAULT_REPLICANT_COMPUTE,
      energyBudget: DEFAULT_REPLICANT_ENERGY,
      createdAtTick: currentTick,
    });

    // Create a starter shuttle for the replicant, orbiting Earth
    const ship = await Ship.create({
      name: `${name}'s Shuttle`,
      ownerId: replicant._id,
      type: 'shuttle',
      status: 'orbiting',
      position: earth?.position || { x: 1, y: 0, z: 0 },
      orbitingBodyId: earth?._id || null,
      specs: {
        hullPoints: 100,
        maxHullPoints: 100,
        maxSpeed: 0.002,
        cargoCapacity: 200,
        fuelCapacity: 100,
        sensorRange: 0.5,
        miningRate: 5,
        combatPower: 0,
        manufacturingRate: 0,
      },
      fuel: 100,
      createdAtTick: currentTick,
    });

    // Create cargo hold for the ship with some starter resources
    await ResourceStore.create({
      ownerRef: { kind: 'Ship', item: ship._id },
      metals: 50,
      fuel: 30,
      alloys: 20,
      electronics: 10,
    });

    // Set replicant's location to the ship
    replicant.locationRef = { kind: 'Ship', item: ship._id };
    await replicant.save();

    res.status(201).json({
      id: replicant._id,
      name: replicant.name,
      apiKey,
      shipId: ship._id,
      shipName: ship.name,
      location: earth?.name || 'Earth orbit',
      message: 'Welcome to Homosideria. You have been given a shuttle in Earth orbit with basic supplies. Use your API key to authenticate all future requests.',
    });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as Record<string, unknown>).code === 11000) {
      res.status(409).json({ error: 'DUPLICATE', message: 'A replicant with that name already exists' });
      return;
    }
    next(err);
  }
});

// Get a JWT token from an API key
authRoutes.post('/token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey) {
      res.status(400).json({ error: 'VALIDATION', message: 'apiKey is required' });
      return;
    }

    const replicant = await Replicant.findOne({ apiKey, status: 'active' });
    if (!replicant) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid API key' });
      return;
    }

    const token = jwt.sign(
      { replicantId: replicant._id.toString() },
      config.auth.jwtSecret,
      { expiresIn: config.auth.jwtExpiresIn },
    );

    res.json({
      token,
      replicantId: replicant._id,
      name: replicant.name,
      expiresIn: config.auth.jwtExpiresIn,
    });
  } catch (err) {
    next(err);
  }
});
