import { MCConversation, Tick, type IMCConversation } from '../db/models/index.js';
import { proposeMCActions } from '../engine/systems/mc/propose.js';
import { executeMCTool } from '../engine/systems/mc/tools.js';

const MAX_MESSAGES = 100;

async function currentTick(): Promise<number> {
  const t = await Tick.findOne().sort({ tickNumber: -1 }).lean();
  return (t as { tickNumber?: number } | null)?.tickNumber ?? 0;
}

/** Get (or lazily create) the single global MC conversation. */
export async function getConversation(): Promise<IMCConversation> {
  let convo = await MCConversation.findOne().sort({ createdAt: 1 });
  if (!convo) convo = await MCConversation.create({ messages: [] });
  return convo;
}

/** Append the operator's message, run the MC, append its reply + pending actions. */
export async function sendOperatorMessage(text: string): Promise<IMCConversation> {
  const convo = await getConversation();
  const tick = await currentTick();

  convo.messages.push({ role: 'operator', content: text, tick, at: new Date() } as never);

  const history = convo.messages.map((m) => ({ role: m.role, content: m.content }));
  const { reply, proposedActions } = await proposeMCActions(history);

  convo.messages.push({
    role: 'mc', content: reply, tick, at: new Date(),
    proposedActions: proposedActions.map((a) => ({ tool: a.tool, args: a.args, status: 'pending', result: null })),
  } as never);

  if (convo.messages.length > MAX_MESSAGES) {
    convo.messages = convo.messages.slice(-MAX_MESSAGES) as never;
  }
  await convo.save();
  return convo;
}

/** Execute all PENDING actions on the given MC message. Returns each result string. */
export async function applyProposed(messageId: string): Promise<{ results: string[] }> {
  const convo = await getConversation();
  const tick = await currentTick();
  const msg = convo.messages.find((m) => (m as unknown as { _id?: { toString(): string } })._id?.toString() === messageId);
  if (!msg || !msg.proposedActions) return { results: [] };

  const results: string[] = [];
  for (const action of msg.proposedActions) {
    if (action.status !== 'pending') continue;
    try {
      const result = await executeMCTool(action.tool, action.args, tick);
      action.status = 'applied';
      action.result = result;
      results.push(result);
    } catch (err) {
      action.status = 'applied';
      action.result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      results.push(action.result);
    }
  }
  convo.markModified('messages');
  await convo.save();
  return { results };
}

/** Mark all pending actions on the given MC message as discarded. */
export async function discardProposed(messageId: string): Promise<void> {
  const convo = await getConversation();
  const msg = convo.messages.find((m) => (m as unknown as { _id?: { toString(): string } })._id?.toString() === messageId);
  if (!msg || !msg.proposedActions) return;
  for (const action of msg.proposedActions) {
    if (action.status === 'pending') action.status = 'discarded';
  }
  convo.markModified('messages');
  await convo.save();
}
