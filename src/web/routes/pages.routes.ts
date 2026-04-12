import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth, requireRole } from '../middleware/roles.js';
import { Replicant, Ship, ResourceStore, Technology, ActionQueue, MemoryLog, Message, User, CelestialBody, Tick, Notification, Blueprint } from '../../db/models/index.js';
import { config } from '../../config.js';

export const pagesRoutes = Router();

// ── Elevate to operator with admin key ──────────────────────────────
pagesRoutes.post('/elevate', requireAuth, async (req: Request, res: Response) => {
  const { adminKey } = req.body;
  if (adminKey === config.auth.adminKey) {
    const user = await User.findById(res.locals.user._id);
    if (user) {
      user.role = 'operator';
      await user.save();
      req.session.role = 'operator';
    }
    res.redirect('/dashboard');
  } else {
    res.redirect('/dashboard?error=Invalid+admin+key');
  }
});

// ── Replicants List ──────────────────────────────────────────────────
pagesRoutes.get('/replicants', requireAuth, requireRole('owner', 'operator', 'spectator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;
    let replicants;
    if (user.role === 'operator') {
      replicants = await Replicant.find().lean();
    } else {
      replicants = await Replicant.find({ _id: { $in: user.replicantIds || [] } }).lean();
    }

    // Get ship counts per replicant
    const replicantIds = replicants.map((r: Record<string, unknown>) => r._id);
    const ships = await Ship.find({ ownerId: { $in: replicantIds }, status: { $ne: 'destroyed' } })
      .select('ownerId')
      .lean();
    const shipCounts: Record<string, number> = {};
    for (const s of ships) {
      const key = s.ownerId.toString();
      shipCounts[key] = (shipCounts[key] || 0) + 1;
    }

    res.render('replicants', {
      title: 'Replicants',
      user,
      currentPath: '/replicants',
      flash: {},
      replicants,
      shipCounts,
    });
  } catch (err) { next(err); }
});

// ── Create Replicant (POST) ──────────────────────────────────────────
pagesRoutes.post('/replicants/create', requireAuth, requireRole('owner', 'operator', 'spectator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;
    const { name, directive, background, personality } = req.body;

    // Call the internal registration API via fetch to localhost
    const port = config.server.port;
    const apiRes = await fetch(`http://localhost:${port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || undefined, directive: directive || undefined }),
    });

    const data = await apiRes.json();
    if (!apiRes.ok) {
      res.render('replicants', {
        title: 'Replicants',
        user: await User.findById(user._id).lean(),
        currentPath: '/replicants',
        flash: { error: (data as Record<string, string>).message || 'Failed to create replicant' },
        replicants: await Replicant.find(user.role === 'operator' ? {} : { _id: { $in: user.replicantIds || [] } }).lean(),
        shipCounts: {},
      });
      return;
    }

    // Apply identity fields that the register API doesn't handle
    const replicantId = (data as Record<string, string>).id;
    if (background || personality) {
      const replicant = await Replicant.findById(replicantId);
      if (replicant) {
        if (background) replicant.identity.background = background.trim();
        if (personality) replicant.identity.personality = personality.trim();
        replicant.markModified('identity');
        await replicant.save();
      }
    }

    // Link replicant to user
    await User.findByIdAndUpdate(user._id, {
      $push: { replicantIds: replicantId },
    });

    // Promote user to owner if they were spectator
    if (user.role === 'spectator') {
      await User.findByIdAndUpdate(user._id, { role: 'owner' });
      req.session.role = 'owner';
    }

    res.redirect('/replicants');
  } catch (err) { next(err); }
});

// ── Replicant Detail ─────────────────────────────────────────────────
pagesRoutes.get('/replicant/:id', requireAuth, requireRole('owner', 'operator', 'spectator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;
    const replicant = await Replicant.findById(req.params.id).lean();
    if (!replicant) { res.status(404).send('Replicant not found'); return; }

    // Ownership check
    if (user.role !== 'operator' && !(user.replicantIds || []).some((id: { toString(): string }) => id.toString() === replicant._id.toString())) {
      res.status(403).send('Access denied'); return;
    }

    const ships = await Ship.find({ ownerId: replicant._id, status: { $ne: 'destroyed' } }).lean();
    const actions = await ActionQueue.find({ replicantId: replicant._id })
      .sort({ createdAt: -1 }).limit(20).lean();
    const memories = await MemoryLog.find({ replicantId: replicant._id })
      .sort({ createdAt: -1 }).limit(20).lean();
    const technologies = await Technology.find({ knownBy: replicant._id }).lean();

    // Get inventory from first ship
    let inventory = null;
    if (ships.length > 0) {
      inventory = await ResourceStore.findOne({ 'ownerRef.item': ships[0]._id }).lean();
    }

    res.render('replicant', {
      title: replicant.identity?.chosenName || replicant.name,
      user,
      currentPath: '/replicants',
      flash: {},
      replicant,
      ships,
      actions,
      memories,
      technologies,
      inventory,
    });
  } catch (err) { next(err); }
});

// ── Edit Replicant Identity ──────────────────────────────────────────
pagesRoutes.post('/replicant/:id/edit', requireAuth, requireRole('owner', 'operator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;
    const replicant = await Replicant.findById(req.params.id);
    if (!replicant) { res.status(404).send('Replicant not found'); return; }

    // Ownership check
    if (user.role !== 'operator' && !(user.replicantIds || []).some((id: { toString(): string }) => id.toString() === replicant._id.toString())) {
      res.status(403).send('Access denied'); return;
    }

    const { name, chosenName, background, personality, directive } = req.body;

    if (name !== undefined && name.trim()) replicant.name = name.trim();
    if (chosenName !== undefined) replicant.identity.chosenName = chosenName.trim() || null;
    if (background !== undefined) replicant.identity.background = background.trim() || null;
    if (personality !== undefined) replicant.identity.personality = personality.trim() || null;
    if (directive !== undefined) replicant.directive = directive.trim() || '';

    replicant.markModified('identity');
    await replicant.save();

    res.redirect(`/replicant/${req.params.id}`);
  } catch (err) { next(err); }
});

// ── Comms ────────────────────────────────────────────────────────────
pagesRoutes.get('/replicant/:id/comms', requireAuth, requireRole('owner', 'operator', 'spectator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;
    const replicant = await Replicant.findById(req.params.id).lean();
    if (!replicant) { res.status(404).send('Replicant not found'); return; }

    if (user.role !== 'operator' && !(user.replicantIds || []).some((id: { toString(): string }) => id.toString() === replicant._id.toString())) {
      res.status(403).send('Access denied'); return;
    }

    const messages = await Message.find({
      $or: [{ senderId: replicant._id }, { recipientId: replicant._id }],
    }).sort({ sentAtTick: -1 }).limit(100)
      .populate('senderId', 'name')
      .populate('recipientId', 'name')
      .lean();

    const captainsLogs = await MemoryLog.find({
      replicantId: replicant._id,
      category: 'captains_log',
    }).sort({ tick: -1 }).limit(20).lean();

    res.render('comms', {
      title: `Comms - ${replicant.identity?.chosenName || replicant.name}`,
      user,
      currentPath: '/replicants',
      flash: {},
      replicant,
      messages,
      captainsLogs,
    });
  } catch (err) { next(err); }
});

// ── Send Message (POST) ──────────────────────────────────────────────
pagesRoutes.post('/replicant/:id/comms/send', requireAuth, requireRole('owner', 'operator', 'spectator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;
    const replicant = await Replicant.findById(req.params.id);
    if (!replicant) { res.status(404).send('Replicant not found'); return; }

    if (user.role !== 'operator' && !(user.replicantIds || []).some((id: { toString(): string }) => id.toString() === replicant._id.toString())) {
      res.status(403).send('Access denied'); return;
    }

    const { subject, body: msgBody } = req.body;
    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const currentTick = latestTick?.tickNumber ?? 0;

    await Message.create({
      senderId: replicant._id,
      recipientId: replicant._id,
      subject: subject || 'Mission Control Advisory',
      body: msgBody,
      metadata: { type: 'system_suggestion', fromDashboard: true },
      senderPosition: { x: 0, y: 0, z: 0 },
      recipientPosition: { x: 0, y: 0, z: 0 },
      distanceAU: 0,
      sentAtTick: currentTick,
      deliverAtTick: currentTick,
      delivered: true,
    });

    res.redirect(`/replicant/${req.params.id}/comms`);
  } catch (err) { next(err); }
});

// ── API Keys ─────────────────────────────────────────────────────────
pagesRoutes.get('/api-keys', requireAuth, requireRole('owner', 'operator', 'spectator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(res.locals.user._id).lean();
    if (!user) { res.redirect('/login'); return; }

    const replicants = await Replicant.find({
      _id: { $in: user.replicantIds || [] },
    }).select('name identity').lean();

    res.render('keys', {
      title: 'API Keys',
      user,
      currentPath: '/api-keys',
      flash: {},
      replicants,
    });
  } catch (err) { next(err); }
});

// ── Generate API Key (POST) ──────────────────────────────────────────
pagesRoutes.post('/api-keys/generate', requireAuth, requireRole('owner', 'operator', 'spectator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(res.locals.user._id);
    if (!user) { res.redirect('/login'); return; }

    const { replicantId, label } = req.body;
    if (!replicantId || !label) {
      res.redirect('/api-keys');
      return;
    }

    // Verify user owns this replicant (or is operator)
    if (user.role !== 'operator' && !(user.replicantIds || []).some((id: { toString(): string }) => id.toString() === replicantId)) {
      res.status(403).send('Access denied'); return;
    }

    const replicant = await Replicant.findById(replicantId);
    if (!replicant) { res.redirect('/api-keys'); return; }

    // Generate a dashboard API key (different from the replicant's built-in one)
    const { nanoid } = await import('nanoid');
    const key = `hsk_${nanoid(32)}`;

    user.apiKeys.push({
      key,
      name: label,
      replicantId: replicant._id,
      createdAt: new Date(),
      lastUsedAt: null,
      active: true,
    });
    await user.save();

    res.redirect('/api-keys');
  } catch (err) { next(err); }
});

// ── Revoke API Key (POST) ────────────────────────────────────────────
pagesRoutes.post('/api-keys/revoke', requireAuth, requireRole('owner', 'operator', 'spectator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(res.locals.user._id);
    if (!user) { res.redirect('/login'); return; }

    const { keyId } = req.body;
    // keyId matches by key string or index
    const apiKey = user.apiKeys.find((k: { key: string }) => k.key === keyId);
    if (apiKey) {
      apiKey.active = false;
      await user.save();
    }

    res.redirect('/api-keys');
  } catch (err) { next(err); }
});

// ── Map ──────────────────────────────────────────────────────────────
pagesRoutes.get('/map', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;
    res.render('map', {
      title: 'Sol Map',
      user,
      currentPath: '/map',
      flash: {},
    });
  } catch (err) { next(err); }
});

// ── Event Feed ───────────────────────────────────────────────────────
pagesRoutes.get('/events', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;
    const { getLastEconomyLog } = await import('../../engine/systems/SettlementEconomy.js');

    const [ticks, actions, notifications] = await Promise.all([
      Tick.find().sort({ tickNumber: -1 }).limit(20).lean(),
      ActionQueue.find().sort({ createdAt: -1 }).limit(30).populate('replicantId', 'name').lean(),
      Notification.find().sort({ createdAt: -1 }).limit(30).lean(),
    ]);

    const economyLog = getLastEconomyLog();

    res.render('feed', {
      title: 'Event Feed',
      user,
      currentPath: '/events',
      flash: {},
      ticks,
      actions,
      notifications,
      economyLog,
    });
  } catch (err) { next(err); }
});

// ── Play ─────────────────────────────────────────────────────────────
pagesRoutes.get('/play/:replicantId', requireAuth, requireRole('owner', 'operator', 'spectator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;
    const replicant = await Replicant.findById(req.params.replicantId).lean();
    if (!replicant) { res.status(404).send('Replicant not found'); return; }

    if (user.role !== 'operator' && !(user.replicantIds || []).some((id: { toString(): string }) => id.toString() === replicant._id.toString())) {
      res.status(403).send('Access denied'); return;
    }

    const ships = await Ship.find({ ownerId: replicant._id, status: { $ne: 'destroyed' } }).lean();
    const bodies = await CelestialBody.find({ type: { $in: ['planet', 'dwarf_planet', 'moon'] } })
      .select('name type').lean();
    const blueprints = await Blueprint.find().select('name category').lean();

    // Get inventory for first ship
    let inventory = null;
    if (ships.length > 0) {
      inventory = await ResourceStore.findOne({ 'ownerRef.item': ships[0]._id }).lean();
    }

    res.render('play', {
      title: `Play - ${replicant.identity?.chosenName || replicant.name}`,
      user,
      currentPath: '/replicants',
      flash: {},
      replicant,
      ships,
      bodies,
      blueprints,
      inventory,
    });
  } catch (err) { next(err); }
});
