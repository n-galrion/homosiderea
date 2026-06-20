import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth, requireRole } from '../middleware/roles.js';
import { getConversation, sendOperatorMessage, applyProposed, discardProposed } from '../../services/mcChat.js';

export const mcPagesRoutes = Router();

mcPagesRoutes.get('/admin/mc', requireAuth, requireRole('operator'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const convo = await getConversation();
    res.render('admin/mc', {
      title: 'Master Controller',
      user: res.locals.user,
      currentPath: '/admin/mc',
      flash: {},
      messages: convo.messages,
    });
  } catch (err) { next(err); }
});

mcPagesRoutes.post('/admin/mc/chat', requireAuth, requireRole('operator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.body.message) await sendOperatorMessage(String(req.body.message));
    res.redirect('/admin/mc');
  } catch (err) { next(err); }
});

mcPagesRoutes.post('/admin/mc/apply', requireAuth, requireRole('operator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.body.messageId) await applyProposed(String(req.body.messageId));
    res.redirect('/admin/mc');
  } catch (err) { next(err); }
});

mcPagesRoutes.post('/admin/mc/discard', requireAuth, requireRole('operator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.body.messageId) await discardProposed(String(req.body.messageId));
    res.redirect('/admin/mc');
  } catch (err) { next(err); }
});
