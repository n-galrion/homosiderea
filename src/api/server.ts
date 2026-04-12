import express, { type Request, type Response, type NextFunction } from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GameError } from '../shared/errors.js';
import { authRoutes } from './routes/auth.routes.js';
import { gameRoutes } from './routes/game.routes.js';
import { replicantRoutes } from './routes/replicant.routes.js';
import { worldRoutes } from './routes/world.routes.js';
import { actionRoutes } from './routes/action.routes.js';
import { amiRoutes } from './routes/ami.routes.js';
import { commsRoutes } from './routes/comms.routes.js';
import { adminRoutes } from './routes/admin.routes.js';
import { shipRoutes } from './routes/ship.routes.js';
import { structureRoutes } from './routes/structure.routes.js';
import { colonyRoutes } from './routes/colony.routes.js';
import { authMiddleware, adminAuth } from './middleware/auth.js';

export function createApp() {
  const app = express();

  app.use(express.json());

  // Static files + dashboard
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const publicDir = join(__dirname, '..', '..', 'public');
  app.use('/static', express.static(publicDir));
  app.get('/dashboard', (_req: Request, res: Response) => {
    res.sendFile(join(publicDir, 'dashboard.html'));
  });

  // Dashboard map data (unauthenticated, limited fields)
  app.get('/api/public/bodies', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { CelestialBody } = await import('../db/models/index.js');
      const bodies = await CelestialBody.find()
        .select('name type parentId position solarEnergyFactor')
        .lean();
      res.json(bodies);
    } catch (err) { next(err); }
  });

  // Public routes
  app.use('/api/auth', authRoutes);

  // Authenticated routes
  app.use('/api/game', authMiddleware, gameRoutes);
  app.use('/api/replicant', authMiddleware, replicantRoutes);
  app.use('/api/world', authMiddleware, worldRoutes);
  app.use('/api/actions', authMiddleware, actionRoutes);
  app.use('/api/amis', authMiddleware, amiRoutes);
  app.use('/api/ships', authMiddleware, shipRoutes);
  app.use('/api/structures', authMiddleware, structureRoutes);
  app.use('/api/messages', authMiddleware, commsRoutes);
  app.use('/api/colonies', authMiddleware, colonyRoutes);

  // Admin routes
  app.use('/api/admin', adminAuth, adminRoutes);

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', game: 'Homosideria: To the Stars', version: '0.1.0' });
  });

  // API discovery — unauthenticated so agents can find routes
  app.get('/api', (_req: Request, res: Response) => {
    res.json({
      game: 'Homosideria: To the Stars',
      version: '0.1.0',
      auth: {
        register: 'POST /api/auth/register  body: { name, directive? }',
        token: 'POST /api/auth/token  body: { apiKey }',
        note: 'All other routes require X-API-Key header',
      },
      routes: {
        game: {
          status: 'GET /api/game/status',
          tick: 'GET /api/game/tick/:number',
        },
        replicant: {
          profile: 'GET /api/replicant/me',
          updateDirective: 'PUT /api/replicant/me/directive  body: { directive }',
          memories: 'GET /api/replicant/me/memories?category=&tag=&limit=',
          createMemory: 'POST /api/replicant/me/memories  body: { category, title, content, tags }',
        },
        ships: {
          list: 'GET /api/ships',
          get: 'GET /api/ships/:id',
          inventory: 'GET /api/ships/:id/inventory',
        },
        structures: {
          list: 'GET /api/structures',
          get: 'GET /api/structures/:id',
          inventory: 'GET /api/structures/:id/inventory',
        },
        world: {
          bodies: 'GET /api/world/bodies?type=',
          body: 'GET /api/world/bodies/:id',
          resources: 'GET /api/world/bodies/:id/resources',
          map: 'GET /api/world/map',
          settlements: 'GET /api/world/settlements?bodyId=  — human cities/outposts with trade',
          settlementDetail: 'GET /api/world/settlements/:id  — settlement + market prices',
          replicants: 'GET /api/world/replicants  — public directory of active replicants',
          actionTypes: 'GET /api/world/action-types  — valid action types and param schemas',
          blueprints: 'GET /api/world/blueprints?category=  — manufacturing/building recipes',
        },
        actions: {
          propose: 'POST /api/actions/propose  body: { action: "free text description", context?, autoApply? }  — MC-evaluated, immediate',
          submit: 'POST /api/actions  body: { type, params, priority? }  — structured, tick-resolved',
          list: 'GET /api/actions?status=&type=&limit=',
          get: 'GET /api/actions/:id',
        },
        amis: {
          list: 'GET /api/amis?status=&type=',
          get: 'GET /api/amis/:id',
          updateScript: 'PUT /api/amis/:id/script  body: { customRules }',
        },
        colonies: {
          list: 'GET /api/colonies',
          get: 'GET /api/colonies/:id',
          landingSites: 'GET /api/colonies/sites/:bodyId',
        },
        messages: {
          send: 'POST /api/messages  body: { recipientId, subject?, body, metadata? }',
          inbox: 'GET /api/messages/inbox?unreadOnly=&limit=&from=',
          get: 'GET /api/messages/:id',
          sent: 'GET /api/messages/sent',
        },
        admin: {
          note: 'Requires X-Admin-Key header',
          forceTick: 'POST /api/admin/tick/force',
          ticks: 'GET /api/admin/ticks?limit=',
          status: 'GET /api/admin/status',
          replicants: 'GET /api/admin/replicants',
          settlements: 'GET /api/admin/settlements',
          markets: 'GET /api/admin/markets',
          ships: 'GET /api/admin/ships',
          actions: 'GET /api/admin/actions?limit=',
          colonies: 'GET /api/admin/colonies',
        },
      },
      mcp: {
        endpoint: 'POST /mcp',
        auth: 'X-API-Key header',
        note: 'Streamable HTTP transport. ~45 tools available after initialization.',
      },
      dashboard: 'GET /dashboard',
    });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof GameError) {
      res.status(err.statusCode).json({
        error: err.code,
        message: err.message,
      });
      return;
    }
    console.error('Unhandled error:', err);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  });

  return app;
}
