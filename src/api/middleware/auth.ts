import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Replicant, type IReplicant } from '../../db/models/index.js';
import { config } from '../../config.js';
import { AuthError } from '../../shared/errors.js';

// Extend Express Request to include replicant
declare global {
  namespace Express {
    interface Request {
      replicant?: IReplicant;
      replicantId?: string;
    }
  }
}

/**
 * Auth middleware. Accepts (in priority order):
 * 1. X-API-Key header (legacy)
 * 2. Authorization: Bearer <JWT>
 * 3. X-Replicant-Name + X-Replicant-Password headers (simple auth)
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // 1. API key
    const apiKey = req.headers['x-api-key'] as string | undefined;
    if (apiKey) {
      const replicant = await Replicant.findOne({ apiKey, status: 'active' });
      if (!replicant) throw new AuthError('Invalid API key');
      req.replicant = replicant;
      req.replicantId = replicant._id.toString();
      next();
      return;
    }

    // 2. JWT
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const payload = jwt.verify(token, config.auth.jwtSecret) as { replicantId: string };
      const replicant = await Replicant.findById(payload.replicantId);
      if (!replicant || replicant.status !== 'active') throw new AuthError('Invalid or expired token');
      req.replicant = replicant;
      req.replicantId = replicant._id.toString();
      next();
      return;
    }

    // 3. Name + password
    const name = req.headers['x-replicant-name'] as string | undefined;
    const password = req.headers['x-replicant-password'] as string | undefined;
    if (name && password) {
      const replicant = await Replicant.findOne({ name, password, status: 'active' });
      if (!replicant) throw new AuthError('Invalid name or password');
      req.replicant = replicant;
      req.replicantId = replicant._id.toString();
      next();
      return;
    }

    throw new AuthError('No auth provided. Use X-API-Key, Bearer token, or X-Replicant-Name + X-Replicant-Password headers.');
  } catch (err) {
    if (err instanceof AuthError) {
      next(err);
    } else {
      next(new AuthError('Authentication failed'));
    }
  }
}

/**
 * Admin auth: requires the admin key.
 */
export function adminAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const key = req.headers['x-admin-key'] as string | undefined;
  if (key !== config.auth.adminKey) {
    next(new AuthError('Invalid admin key'));
    return;
  }
  next();
}
