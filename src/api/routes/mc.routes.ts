import { Router, type Request, type Response, type NextFunction } from 'express';
import { getConversation, sendOperatorMessage, applyProposed, discardProposed } from '../../services/mcChat.js';

export const mcRoutes = Router();

mcRoutes.get('/conversation', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const convo = await getConversation();
    res.json({ messages: convo.messages });
  } catch (err) { next(err); }
});

mcRoutes.post('/chat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'VALIDATION', message: 'message string is required' });
      return;
    }
    const convo = await sendOperatorMessage(message);
    res.json({ messages: convo.messages });
  } catch (err) { next(err); }
});

mcRoutes.post('/apply', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { messageId } = req.body;
    if (!messageId) { res.status(400).json({ error: 'VALIDATION', message: 'messageId is required' }); return; }
    const out = await applyProposed(messageId);
    res.json(out);
  } catch (err) { next(err); }
});

mcRoutes.post('/discard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { messageId } = req.body;
    if (!messageId) { res.status(400).json({ error: 'VALIDATION', message: 'messageId is required' }); return; }
    await discardProposed(messageId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
