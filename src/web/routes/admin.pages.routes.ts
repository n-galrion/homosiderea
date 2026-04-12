import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth, requireRole } from '../middleware/roles.js';
import { Replicant, Ship, Tick, Settlement, Notification, User, Faction } from '../../db/models/index.js';

export const adminPagesRoutes = Router();

// ── Admin Control Panel ──────────────────────────────────────────────
adminPagesRoutes.get('/admin/control', requireAuth, requireRole('operator'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;

    const [replicants, latestTick, notifications, shipCount] = await Promise.all([
      Replicant.find().lean(),
      Tick.findOne().sort({ tickNumber: -1 }).lean(),
      Notification.find({ read: false }).sort({ createdAt: -1 }).limit(20).lean(),
      Ship.countDocuments({ status: { $ne: 'destroyed' } }),
    ]);

    res.render('admin/index', {
      title: 'Control Panel',
      user,
      currentPath: '/admin/control',
      flash: {},
      replicants,
      currentTick: latestTick?.tickNumber ?? 0,
      notifications,
      shipCount,
    });
  } catch (err) { next(err); }
});

// ── Admin Settlements ────────────────────────────────────────────────
adminPagesRoutes.get('/admin/settlements', requireAuth, requireRole('operator'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;
    const settlements = await Settlement.find().populate('bodyId', 'name').lean();

    res.render('admin/settlements', {
      title: 'Settlements',
      user,
      currentPath: '/admin/settlements',
      flash: {},
      settlements,
    });
  } catch (err) { next(err); }
});

// ── Admin Settlement Update (POST) ───────────────────────────────────
adminPagesRoutes.post('/admin/settlements/:id', requireAuth, requireRole('operator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const settlement = await Settlement.findById(req.params.id);
    if (!settlement) { res.redirect('/admin/settlements'); return; }

    const { attitude, status } = req.body;
    if (attitude !== undefined) {
      settlement.attitude.general = Math.max(-1, Math.min(1, parseFloat(attitude)));
      settlement.markModified('attitude');
    }
    if (status) {
      const validStatuses = ['thriving', 'stable', 'struggling', 'damaged', 'destroyed'];
      if (validStatuses.includes(status)) {
        settlement.status = status as typeof settlement.status;
      }
    }
    await settlement.save();

    res.redirect('/admin/settlements');
  } catch (err) { next(err); }
});

// ── Admin Events ─────────────────────────────────────────────────────
adminPagesRoutes.get('/admin/events', requireAuth, requireRole('operator'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;
    const replicants = await Replicant.find({ status: 'active' }).select('name identity').lean();
    const factions = await Faction.find().select('name').lean();

    res.render('admin/events', {
      title: 'Event Injector',
      user,
      currentPath: '/admin/events',
      flash: {},
      replicants,
      factions,
    });
  } catch (err) { next(err); }
});

// ── Admin Event Inject (POST) ────────────────────────────────────────
adminPagesRoutes.post('/admin/events/inject', requireAuth, requireRole('operator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, replicantId, subject, body: msgBody, global: isGlobal } = req.body;

    const port = req.socket.localPort || 3001;
    const adminKey = process.env.ADMIN_KEY || 'dev-admin-key';

    let endpoint = '/api/admin/suggest';
    let payload: Record<string, unknown> = { replicantId, subject, body: msgBody };

    if (type === 'event') {
      endpoint = '/api/admin/event';
      payload = { replicantId, subject, body: msgBody, global: isGlobal === 'on' };
    } else if (type === 'world-event') {
      endpoint = '/api/admin/mc/world-event';
      payload = { title: subject, description: msgBody, global: isGlobal === 'on' };
    }

    await fetch(`http://localhost:${port}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': adminKey },
      body: JSON.stringify(payload),
    });

    res.redirect('/admin/events');
  } catch (err) { next(err); }
});

// ── Admin Game ───────────────────────────────────────────────────────
adminPagesRoutes.get('/admin/game', requireAuth, requireRole('operator'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;
    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();

    res.render('admin/game', {
      title: 'Game Control',
      user,
      currentPath: '/admin/game',
      flash: {},
      currentTick: latestTick?.tickNumber ?? 0,
    });
  } catch (err) { next(err); }
});

// ── Admin Force Tick (POST) ──────────────────────────────────────────
adminPagesRoutes.post('/admin/game/force-tick', requireAuth, requireRole('operator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const port = req.socket.localPort || 3001;
    const adminKey = process.env.ADMIN_KEY || 'dev-admin-key';

    await fetch(`http://localhost:${port}/api/admin/tick/force`, {
      method: 'POST',
      headers: { 'X-Admin-Key': adminKey },
    });

    res.redirect('/admin/game');
  } catch (err) { next(err); }
});

// ── Admin Users ──────────────────────────────────────────────────────
adminPagesRoutes.get('/admin/users', requireAuth, requireRole('operator'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;
    const users = await User.find().select('-passwordHash').lean();

    res.render('admin/users', {
      title: 'Users',
      user,
      currentPath: '/admin/users',
      flash: {},
      users,
    });
  } catch (err) { next(err); }
});

// ── Admin User Role Update (POST) ────────────────────────────────────
adminPagesRoutes.post('/admin/users/:id/role', requireAuth, requireRole('operator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { role } = req.body;
    const validRoles = ['operator', 'owner', 'spectator'];
    if (!validRoles.includes(role)) { res.redirect('/admin/users'); return; }

    await User.findByIdAndUpdate(req.params.id, { role });
    res.redirect('/admin/users');
  } catch (err) { next(err); }
});
