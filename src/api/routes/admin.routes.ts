import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { Tick, Replicant, CelestialBody, Settlement, Market, Ship, ActionQueue, Colony, Technology, Message, Faction, ResourceStore, PriceHistory } from '../../db/models/index.js';

// GameLoop reference will be set at startup
let gameLoopRef: { forceTick: () => Promise<unknown>; getCurrentTick: () => number } | null = null;

export function setGameLoopRef(gl: typeof gameLoopRef) {
  gameLoopRef = gl;
}

export const adminRoutes = Router();

// Force an immediate tick
adminRoutes.post('/tick/force', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    if (!gameLoopRef) {
      res.status(503).json({ error: 'NOT_READY', message: 'Game loop not initialized' });
      return;
    }

    const result = await gameLoopRef.forceTick();
    res.json({ message: 'Tick forced', result });
  } catch (err) {
    next(err);
  }
});

// Get tick history
adminRoutes.get('/ticks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit = '20' } = req.query;
    const ticks = await Tick.find()
      .sort({ tickNumber: -1 })
      .limit(parseInt(limit as string, 10))
      .lean();
    res.json(ticks);
  } catch (err) {
    next(err);
  }
});

// List all replicants (admin view)
adminRoutes.get('/replicants', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const replicants = await Replicant.find()
      .select('-apiKey')
      .lean();
    res.json(replicants);
  } catch (err) {
    next(err);
  }
});

// List all settlements
adminRoutes.get('/settlements', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const settlements = await Settlement.find().lean();
    res.json(settlements);
  } catch (err) {
    next(err);
  }
});

// List all markets
adminRoutes.get('/markets', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const markets = await Market.find().populate('settlementId', 'name nation').lean();
    res.json(markets);
  } catch (err) {
    next(err);
  }
});

// List all ships
adminRoutes.get('/ships', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const ships = await Ship.find({ status: { $ne: 'destroyed' } }).lean();
    res.json(ships);
  } catch (err) {
    next(err);
  }
});

// Recent actions across all replicants
adminRoutes.get('/actions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit = '50' } = req.query;
    const actions = await ActionQueue.find()
      .sort({ createdAt: -1 })
      .limit(parseInt(limit as string, 10))
      .populate('replicantId', 'name')
      .lean();
    res.json(actions);
  } catch (err) {
    next(err);
  }
});

// All colonies
adminRoutes.get('/colonies', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const colonies = await Colony.find().populate('bodyId', 'name').lean();
    res.json(colonies);
  } catch (err) {
    next(err);
  }
});

// All technologies
adminRoutes.get('/technologies', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const technologies = await Technology.find()
      .populate('inventedBy', 'name')
      .populate('knownBy', 'name')
      .lean();
    res.json(technologies);
  } catch (err) {
    next(err);
  }
});

// All messages
adminRoutes.get('/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit = '50' } = req.query;
    const messages = await Message.find()
      .sort({ sentAtTick: -1 })
      .limit(parseInt(limit as string, 10))
      .populate('senderId', 'name')
      .populate('recipientId', 'name')
      .lean();
    res.json(messages);
  } catch (err) {
    next(err);
  }
});

// Send a suggestion/prompt to a replicant (appears as a system message)
adminRoutes.post('/suggest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { replicantId, subject, body: msgBody, metadata } = req.body;
    if (!replicantId || !msgBody) {
      res.status(400).json({ error: 'VALIDATION', message: 'replicantId and body are required' });
      return;
    }

    const replicant = await Replicant.findById(replicantId);
    if (!replicant) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Replicant not found' });
      return;
    }

    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const currentTick = latestTick?.tickNumber ?? 0;

    // Create as a system message — delivered instantly
    await Message.create({
      senderId: replicant._id, // self-addressed system message
      recipientId: replicant._id,
      subject: subject || 'System Advisory',
      body: msgBody,
      metadata: { type: 'system_suggestion', fromDashboard: true, ...metadata },
      senderPosition: { x: 0, y: 0, z: 0 },
      recipientPosition: { x: 0, y: 0, z: 0 },
      distanceAU: 0,
      sentAtTick: currentTick,
      deliverAtTick: currentTick,
      delivered: true,
    });

    res.json({
      message: `Suggestion sent to ${replicant.name}`,
      deliveredAtTick: currentTick,
    });
  } catch (err) {
    next(err);
  }
});

// Inject an event for a specific replicant or globally
adminRoutes.post('/event', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { replicantId, subject, body: msgBody, metadata, global: isGlobal } = req.body;
    if (!msgBody) {
      res.status(400).json({ error: 'VALIDATION', message: 'body is required' });
      return;
    }

    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const currentTick = latestTick?.tickNumber ?? 0;

    const targets = isGlobal
      ? await Replicant.find({ status: 'active' })
      : replicantId
        ? [await Replicant.findById(replicantId)].filter(Boolean)
        : [];

    if (targets.length === 0) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'No target replicants found' });
      return;
    }

    for (const target of targets) {
      if (!target) continue;
      await Message.create({
        senderId: target._id,
        recipientId: target._id,
        subject: subject || 'Event Alert',
        body: msgBody,
        metadata: { type: 'injected_event', fromDashboard: true, ...metadata },
        senderPosition: { x: 0, y: 0, z: 0 },
        recipientPosition: { x: 0, y: 0, z: 0 },
        distanceAU: 0,
        sentAtTick: currentTick,
        deliverAtTick: currentTick,
        delivered: true,
      });
    }

    res.json({
      message: `Event sent to ${targets.length} replicant(s)`,
      targets: targets.map(t => t!.name),
    });
  } catch (err) {
    next(err);
  }
});

// Price history for charts
adminRoutes.get('/price-history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { settlementName, limit = '100' } = req.query;
    const filter: Record<string, unknown> = {};
    if (settlementName) filter.settlementName = settlementName;

    const history = await PriceHistory.find(filter)
      .sort({ tick: -1 })
      .limit(parseInt(limit as string, 10))
      .lean();
    res.json(history);
  } catch (err) {
    next(err);
  }
});

// Game status overview
adminRoutes.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [replicants, bodies, ticks] = await Promise.all([
      Replicant.countDocuments({ status: 'active' }),
      CelestialBody.countDocuments(),
      Tick.findOne().sort({ tickNumber: -1 }).lean(),
    ]);

    res.json({
      currentTick: ticks?.tickNumber ?? 0,
      activeReplicants: replicants,
      celestialBodies: bodies,
      gameLoopActive: !!gameLoopRef,
    });
  } catch (err) {
    next(err);
  }
});

// ── MC Game Master Endpoints ───────────────────────────────────────────

// POST /api/admin/mc/create-npc — MC creates an NPC replicant
adminRoutes.post('/mc/create-npc', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, type, directive, faction: factionName, shipSpecs } = req.body;
    if (!name || !type || !directive) {
      res.status(400).json({ error: 'VALIDATION', message: 'name, type, and directive are required' });
      return;
    }

    const npcTypes: Record<string, { shipType: string; specs: Record<string, number> }> = {
      trader: {
        shipType: 'freighter',
        specs: { hullPoints: 80, maxHullPoints: 80, maxSpeed: 0.05, cargoCapacity: 500, fuelCapacity: 200, sensorRange: 2, miningRate: 0, combatPower: 1, manufacturingRate: 0 },
      },
      pirate: {
        shipType: 'warship',
        specs: { hullPoints: 60, maxHullPoints: 60, maxSpeed: 0.12, cargoCapacity: 100, fuelCapacity: 150, sensorRange: 5, miningRate: 0, combatPower: 8, manufacturingRate: 0 },
      },
      scientist: {
        shipType: 'probe',
        specs: { hullPoints: 40, maxHullPoints: 40, maxSpeed: 0.08, cargoCapacity: 50, fuelCapacity: 100, sensorRange: 10, miningRate: 0, combatPower: 0, manufacturingRate: 0 },
      },
      military: {
        shipType: 'warship',
        specs: { hullPoints: 120, maxHullPoints: 120, maxSpeed: 0.1, cargoCapacity: 80, fuelCapacity: 300, sensorRange: 8, miningRate: 0, combatPower: 12, manufacturingRate: 0 },
      },
    };

    const template = npcTypes[type];
    if (!template) {
      res.status(400).json({ error: 'VALIDATION', message: `Invalid NPC type. Valid: ${Object.keys(npcTypes).join(', ')}` });
      return;
    }

    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const currentTick = latestTick?.tickNumber ?? 0;

    // Create NPC replicant
    const apiKey = `npc_${crypto.randomBytes(16).toString('hex')}`;
    const replicant = await Replicant.create({
      name,
      apiKey,
      password: null,
      parentId: null,
      lineage: [],
      directive,
      status: 'active',
      locationRef: null,
      computeCycles: 500,
      energyBudget: 100,
      techLevels: {},
      accessControl: {
        authorizedModifiers: [],
        authorizedReaders: [],
        physicalAccessEnabled: false,
        securityLevel: 1,
      },
      identity: { chosenName: name, background: `NPC ${type}`, personality: type, namedAtTick: currentTick },
      lastRebootTick: null,
      rebootCount: 0,
      createdAtTick: currentTick,
      lastActiveTick: currentTick,
    });

    // Create ship for NPC
    const earth = await CelestialBody.findOne({ name: 'Earth' });
    const finalSpecs = shipSpecs ? { ...template.specs, ...shipSpecs } : template.specs;

    const ship = await Ship.create({
      name: `${name}'s ${template.shipType}`,
      ownerId: replicant._id,
      type: template.shipType,
      status: 'orbiting',
      position: earth?.position ?? { x: 1, y: 0, z: 0 },
      orbitingBodyId: earth?._id ?? null,
      orbitingAsteroidId: null,
      dockedAtId: null,
      navigation: { destinationBodyId: null, destinationPos: null, departurePos: null, departureTick: null, arrivalTick: null, speed: null },
      miningState: null,
      maintenance: { hullDegradationRate: 0.001, lastMaintenanceTick: currentTick, radiationExposure: 0 },
      specs: finalSpecs,
      fuel: finalSpecs.fuelCapacity,
      createdAtTick: currentTick,
    });

    // Create cargo hold
    await ResourceStore.create({
      ownerRef: { kind: 'Ship', item: ship._id },
    });

    // Link replicant location to ship
    replicant.locationRef = { kind: 'Ship', item: ship._id };
    await replicant.save();

    // Optionally link to a faction
    let factionRef = null;
    if (factionName) {
      const faction = await Faction.findOne({ name: new RegExp(`^${factionName}$`, 'i') });
      if (faction) factionRef = faction._id;
    }

    res.json({
      message: `NPC "${name}" created as ${type}`,
      replicantId: replicant._id.toString(),
      shipId: ship._id.toString(),
      faction: factionRef?.toString() ?? null,
      apiKey,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/mc/create-faction — MC creates a new faction
adminRoutes.post('/mc/create-faction', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, type, description, policies } = req.body;
    if (!name || !type) {
      res.status(400).json({ error: 'VALIDATION', message: 'name and type are required' });
      return;
    }

    const validTypes = ['governmental', 'corporate', 'military', 'scientific', 'independent'];
    if (!validTypes.includes(type)) {
      res.status(400).json({ error: 'VALIDATION', message: `Invalid faction type. Valid: ${validTypes.join(', ')}` });
      return;
    }

    const faction = await Faction.create({
      name,
      type,
      description: description || '',
      members: [],
      attitude: { general: 0.5, byReplicant: {} },
      resources: {},
      policies: policies || { tradeOpenness: 0.5, militaryAggression: 0.2, techSharing: 0.5, replicantTolerance: 0.5 },
    });

    res.json({
      message: `Faction "${name}" created`,
      factionId: faction._id.toString(),
      faction,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/mc/modify-settlement — MC changes a settlement
adminRoutes.post('/mc/modify-settlement', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { settlementId, changes } = req.body;
    if (!settlementId || !changes) {
      res.status(400).json({ error: 'VALIDATION', message: 'settlementId and changes are required' });
      return;
    }

    const settlement = await Settlement.findById(settlementId);
    if (!settlement) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Settlement not found' });
      return;
    }

    // Apply allowed changes
    if (changes.attitude !== undefined) {
      if (typeof changes.attitude === 'number') {
        settlement.attitude.general = Math.max(-1, Math.min(1, changes.attitude));
      } else if (typeof changes.attitude === 'object') {
        if (changes.attitude.general !== undefined) settlement.attitude.general = Math.max(-1, Math.min(1, changes.attitude.general));
        if (changes.attitude.byReplicant) Object.assign(settlement.attitude.byReplicant, changes.attitude.byReplicant);
      }
      settlement.markModified('attitude');
    }
    if (changes.status !== undefined) {
      const validStatuses = ['thriving', 'stable', 'struggling', 'damaged', 'destroyed'];
      if (validStatuses.includes(changes.status)) {
        settlement.status = changes.status;
      }
    }
    if (changes.population !== undefined && typeof changes.population === 'number') {
      settlement.population = Math.max(0, changes.population);
    }
    if (changes.leadership !== undefined && typeof changes.leadership === 'object') {
      if (changes.leadership.leaderName) settlement.leadership.leaderName = changes.leadership.leaderName;
      if (changes.leadership.leaderTitle) settlement.leadership.leaderTitle = changes.leadership.leaderTitle;
      if (changes.leadership.governmentType) settlement.leadership.governmentType = changes.leadership.governmentType;
      settlement.markModified('leadership');
    }
    if (changes.culture !== undefined && typeof changes.culture === 'object') {
      if (changes.culture.temperament) settlement.culture.temperament = changes.culture.temperament;
      if (changes.culture.description) settlement.culture.description = changes.culture.description;
      if (changes.culture.priorities) settlement.culture.priorities = changes.culture.priorities;
      settlement.markModified('culture');
    }
    if (changes.factionId !== undefined) {
      settlement.factionId = changes.factionId;
    }

    await settlement.save();

    res.json({
      message: `Settlement "${settlement.name}" modified`,
      settlement,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/mc/world-event — MC generates a world event
adminRoutes.post('/mc/world-event', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, description, effects, global: isGlobal } = req.body;
    if (!title || !description) {
      res.status(400).json({ error: 'VALIDATION', message: 'title and description are required' });
      return;
    }

    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const currentTick = latestTick?.tickNumber ?? 0;
    const appliedEffects: string[] = [];

    // Apply settlement effects
    if (effects?.settlements && Array.isArray(effects.settlements)) {
      for (const se of effects.settlements) {
        const settlement = await Settlement.findById(se.settlementId);
        if (!settlement) continue;
        if (se.attitudeDelta !== undefined) {
          settlement.attitude.general = Math.max(-1, Math.min(1, settlement.attitude.general + se.attitudeDelta));
          settlement.markModified('attitude');
        }
        if (se.populationDelta !== undefined) {
          settlement.population = Math.max(0, settlement.population + se.populationDelta);
        }
        if (se.status !== undefined) {
          settlement.status = se.status;
        }
        await settlement.save();
        appliedEffects.push(`Settlement "${settlement.name}" updated`);
      }
    }

    // Apply faction effects
    if (effects?.factions && Array.isArray(effects.factions)) {
      for (const fe of effects.factions) {
        const faction = await Faction.findById(fe.factionId);
        if (!faction) continue;
        if (fe.attitudeDelta !== undefined) {
          faction.attitude.general = Math.max(-1, Math.min(1, faction.attitude.general + fe.attitudeDelta));
          faction.markModified('attitude');
        }
        if (fe.policies) {
          Object.assign(faction.policies, fe.policies);
          faction.markModified('policies');
        }
        await faction.save();
        appliedEffects.push(`Faction "${faction.name}" updated`);
      }
    }

    // Notify replicants
    const targets = isGlobal
      ? await Replicant.find({ status: 'active' })
      : effects?.replicants && Array.isArray(effects.replicants)
        ? await Replicant.find({ _id: { $in: effects.replicants } })
        : await Replicant.find({ status: 'active' }); // default to global

    for (const target of targets) {
      await Message.create({
        senderId: target._id,
        recipientId: target._id,
        subject: `[WORLD EVENT] ${title}`,
        body: description,
        metadata: { type: 'world_event', title, effects: effects ?? {}, fromDashboard: true },
        senderPosition: { x: 0, y: 0, z: 0 },
        recipientPosition: { x: 0, y: 0, z: 0 },
        distanceAU: 0,
        sentAtTick: currentTick,
        deliverAtTick: currentTick,
        delivered: true,
      });
    }

    res.json({
      message: `World event "${title}" created`,
      tick: currentTick,
      notified: targets.length,
      appliedEffects,
    });
  } catch (err) {
    next(err);
  }
});
