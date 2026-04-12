import type { Request, Response, NextFunction } from 'express';
import { User } from '../../db/models/index.js';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.session?.userId) {
    res.redirect('/login');
    return;
  }
  const user = await User.findById(req.session.userId).lean();
  if (!user) {
    req.session.destroy(() => {});
    res.redirect('/login');
    return;
  }
  res.locals.user = user;
  res.locals.isOperator = user.role === 'operator';
  res.locals.isOwner = user.role === 'owner' || user.role === 'operator';
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = res.locals.user;
    if (!user || !roles.includes(user.role)) {
      res.status(403).send('Access denied');
      return;
    }
    next();
  };
}
