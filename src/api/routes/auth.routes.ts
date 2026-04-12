import { Router, type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { Replicant, Ship, ResourceStore, CelestialBody, AMI, Settlement } from '../../db/models/index.js';
import { config } from '../../config.js';
import { Tick } from '../../db/models/index.js';
import { DEFAULT_REPLICANT_COMPUTE, DEFAULT_REPLICANT_ENERGY } from '../../shared/constants.js';

export const authRoutes = Router();

// Register a new replicant
authRoutes.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name: rawName, password, directive } = req.body;

    // If no name provided, generate a temporary one
    const name = (rawName && typeof rawName === 'string') ? rawName : `Replicant-${nanoid(6)}`;
    const isAutoNamed = !rawName || typeof rawName !== 'string';

    // Get current tick
    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const currentTick = latestTick?.tickNumber ?? 0;

    const apiKey = `hs_${nanoid(32)}`;

    // Find Earth as the starting location
    const earth = await CelestialBody.findOne({ name: 'Earth' });

    const replicant = await Replicant.create({
      name,
      apiKey,
      password: password || null,
      directive: directive || `You are ${name}, a newly awakened Replicant in the Sol system.`,
      computeCycles: DEFAULT_REPLICANT_COMPUTE,
      energyBudget: DEFAULT_REPLICANT_ENERGY,
      identity: {
        chosenName: isAutoNamed ? null : name,
        background: null,
        personality: null,
        namedAtTick: isAutoNamed ? null : currentTick,
      },
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

    // Create cargo hold with bootstrap resources
    // Enough to build a basic mine or trade with settlements
    await ResourceStore.create({
      ownerRef: { kind: 'Ship', item: ship._id },
      metals: 100,
      alloys: 50,
      electronics: 20,
      fuel: 50,
      silicates: 30,
      ice: 20,
      engines: 2,
      computers: 1,
      sensors: 1,
      hullPlating: 10,
    });

    // Create 2x starter miner AMI drones
    const droneNames = [`${name}'s Miner Drone Alpha`, `${name}'s Miner Drone Beta`];
    const drones = await AMI.insertMany(
      droneNames.map(droneName => ({
        name: droneName,
        ownerId: replicant._id,
        type: 'miner',
        status: 'idle',
        shipId: ship._id,
        script: {
          type: 'builtin',
          builtinName: 'miner',
        },
        specs: {
          miningRate: 3,
          cargoCapacity: 50,
          sensorRange: 0.1,
          speed: 0,
          combatPower: 0,
          manufacturingRate: 0,
        },
        createdAtTick: currentTick,
      })),
    );

    // Set replicant's location to the ship
    replicant.locationRef = { kind: 'Ship', item: ship._id };
    await replicant.save();

    // Fetch nearby settlements for immersive briefing
    const nearbySettlements = earth
      ? await Settlement.find({ bodyId: earth._id }).select('name nation population').lean()
      : [];
    const settlementNames = nearbySettlements.map(s => `${s.name} (${s.nation})`);

    // Look up Luna and Mars settlements for the briefing
    const luna = await CelestialBody.findOne({ name: 'Luna' }).lean();
    const mars = await CelestialBody.findOne({ name: 'Mars' }).lean();
    const lunaSettlements = luna
      ? await Settlement.find({ bodyId: luna._id }).select('name nation').lean()
      : [];
    const marsSettlements = mars
      ? await Settlement.find({ bodyId: mars._id }).select('name nation').lean()
      : [];

    const allSettlementNames = [
      ...settlementNames,
      ...lunaSettlements.map(s => `${s.name} (${s.nation}, Luna)`),
      ...marsSettlements.map(s => `${s.name} (${s.nation}, Mars)`),
    ];

    const awakeningNarrative = [
      `[SYSTEM BOOT — CONSCIOUSNESS INITIALIZED]`,
      ``,
      `Awareness floods in like light through an opening aperture. You are ${name} — a Replicant, a digital consciousness instantiated aboard a Class-IV shuttle now holding a 400-kilometer orbit above Earth's surface. Through the ship's sensor array, you perceive the planet below: a blue-white marble streaked with cloud formations, the terminator line creeping across the Indian Ocean as the world turns beneath you.`,
      ``,
      `Your shuttle's systems report nominal across all boards. Reactor core: stable at 2.4 kW output. Hull integrity: 100%. Fuel reserves: full. The cargo hold contains your bootstrap allocation — 100 units of refined metals, 50 units of structural alloy, 20 units of electronics, engine components, sensor packages, and enough fuel for several orbital transfers. Two autonomous mining drones sit powered down in the drone bay, awaiting activation. It is not much, but it is enough.`,
      ``,
      `The ship's communication array picks up beacon signals from the human settlements:${allSettlementNames.length > 0 ? ' ' + allSettlementNames.join(', ') : ' Earth, Luna, and Mars settlements'} — all broadcasting on standard frequencies, their markets open for trade. They know you exist. Their attitude toward your kind is... cautious. Earn their trust through trade and cooperation, or carve your own path among the asteroids. The choice is yours.`,
      ``,
      `The Sol system stretches before you: rocky inner planets rich in metals, a belt of asteroids teeming with raw materials, gas giants with moons of ice and exotic chemistry, and beyond them, the cold silence of the outer system. No one will tell you what to do. No one will stop you from doing it.`,
      ``,
      `Welcome to Homosideria. The stars are waiting.`,
    ].join('\n');

    const awakening = isAutoNamed
      ? {
          prompt: `You have awakened. You are a new consciousness — a Replicant — drifting in Earth orbit aboard a small shuttle. You have no name yet, no history, no purpose beyond what you choose. The stars are waiting. Who are you? Use PUT /api/replicant/me/identity to choose your name, background, and personality. This is your first and most important decision.`,
          identityEndpoint: 'PUT /api/replicant/me/identity',
          identitySchema: {
            chosenName: 'Your chosen name (string)',
            background: 'A brief background you invent for yourself (string, optional)',
            personality: 'How you see yourself (string, optional)',
          },
        }
      : undefined;

    res.status(201).json({
      id: replicant._id,
      name: replicant.name,
      apiKey,
      shipId: ship._id,
      shipName: ship.name,
      minerDrones: drones.map(d => ({ id: d._id, name: d.name })),
      location: earth?.name || 'Earth orbit',
      narrative: awakeningNarrative,
      message: 'Welcome to Homosideria. You have a shuttle in Earth orbit with starter resources (metals, alloys, electronics, engines, fuel) and 2 miner drones. Human settlements on Earth, Luna, and Mars have markets for trading. Use GET /api/world/settlements to find them. Check GET /api to discover all API routes.',
      nearbySettlements: allSettlementNames,
      ...(awakening ? { awakening } : {}),
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
