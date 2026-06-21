import type OpenAI from 'openai';
import type { IStoredMessage } from '../db/models/AgentConversation.js';
import type { Hud } from '../tools/hud.js';

export const COMPACTION_THRESHOLD_TOKENS = 40000;
export const KEEP_RECENT_MESSAGES = 20;

/** Map persisted messages back to the OpenAI chat shape for replay. */
export function toOpenAIMessages(stored: IStoredMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return stored.map((m) => {
    if (m.role === 'assistant') {
      const msg: Record<string, unknown> = { role: 'assistant', content: m.content ?? '' };
      if (m.toolCalls && m.toolCalls.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } }));
      }
      return msg as unknown as OpenAI.Chat.Completions.ChatCompletionMessageParam;
    }
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content ?? '' } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
    }
    return { role: m.role, content: m.content ?? '' } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
  });
}

/** Convert an OpenAI assistant choice message into a stored message. */
export function assistantToStored(msg: OpenAI.Chat.Completions.ChatCompletionMessage, tick: number): IStoredMessage {
  const toolCalls = (msg.tool_calls || [])
    .filter((tc) => tc.type === 'function')
    .map((tc) => ({ id: tc.id, name: tc.function.name, args: tc.function.arguments }));
  return {
    role: 'assistant',
    content: msg.content ?? '',
    toolCalls: toolCalls.length ? toolCalls : undefined,
    tick,
    at: new Date(),
  };
}

export function toolResultToStored(toolCallId: string, name: string, content: string, tick: number): IStoredMessage {
  return { role: 'tool', content, toolCallId, name, tick, at: new Date() };
}

/** Render the HUD delta as the interrupt/wake-up user message. */
export function renderInterrupt(hud: Hud | null, tick: number): string {
  const lines: string[] = [`— Tick ${tick} —`];
  if (!hud) { lines.push('(status unavailable)'); return lines.join('\n'); }
  const v = hud.vitals;
  lines.push(`Vitals: credits ${v.credits}, fuel ${v.fuelPct}%, hull ${v.hullPct}%, ${v.status} ${v.location}`);
  if (hud.unreadMessages.count > 0) {
    lines.push(`Unread messages (${hud.unreadMessages.count}):`);
    for (const m of hud.unreadMessages.items) lines.push(`  - from ${m.from}: ${m.subject} (tick ${m.tick})`);
  }
  if (hud.recentEvents.length) lines.push(`Recent events: ${hud.recentEvents.map((e) => e.title).join('; ')}`);
  if (hud.completedActions.length) lines.push(`Completed: ${hud.completedActions.map((a) => a.action).join(', ')}`);
  if (hud.warnings.length) lines.push(`Warnings: ${hud.warnings.join('; ')}`);
  if (hud.guidance.length) lines.push(`Guidance: ${hud.guidance.join(' ')}`);
  lines.push('Continue pursuing your directive. Act if there is something worth doing, otherwise note your plan and wait.');
  return lines.join('\n');
}

export function estimateTokens(stored: IStoredMessage[], summary: string | null): number {
  let chars = summary ? summary.length : 0;
  for (const m of stored) {
    chars += (m.content?.length ?? 0);
    if (m.toolCalls) for (const tc of m.toolCalls) chars += tc.args.length + tc.name.length;
  }
  return Math.ceil(chars / 4);
}

export function needsCompaction(stored: IStoredMessage[], summary: string | null): boolean {
  return estimateTokens(stored, summary) > COMPACTION_THRESHOLD_TOKENS;
}

/**
 * Fold all but the most recent KEEP_RECENT_MESSAGES turns into `summary`
 * (extending any existing summary) via the injected `summarize` fn, then drop
 * those turns. Pure on the passed object (caller saves).
 */
export async function applyCompaction(
  conv: { messages: IStoredMessage[]; summary: string | null; summarizedThroughTick: number },
  summarize: (text: string) => Promise<string>,
): Promise<void> {
  if (conv.messages.length <= KEEP_RECENT_MESSAGES) return;
  let cut = conv.messages.length - KEEP_RECENT_MESSAGES;
  // Never start `recent` on an orphaned tool result — fold each assistant(tool_calls)
  // group together. Advance the cut past any tool messages at the boundary.
  while (cut < conv.messages.length && conv.messages[cut].role === 'tool') cut++;
  if (cut >= conv.messages.length) return; // nothing safe to compact this round
  const older = conv.messages.slice(0, cut);
  const recent = conv.messages.slice(cut);
  const transcript = older.map((m) => {
    if (m.role === 'assistant' && m.toolCalls?.length) return `ASSISTANT: ${m.content ?? ''} [calls: ${m.toolCalls.map((t) => t.name).join(', ')}]`;
    if (m.role === 'tool') return `TOOL(${m.name}): ${(m.content ?? '').slice(0, 300)}`;
    return `${m.role.toUpperCase()}: ${m.content ?? ''}`;
  }).join('\n');
  const prior = conv.summary ? `Prior summary:\n${conv.summary}\n\n` : '';
  conv.summary = await summarize(`${prior}New turns to fold in:\n${transcript}`);
  conv.summarizedThroughTick = older[older.length - 1].tick;
  conv.messages = recent;
}
