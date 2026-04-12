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
