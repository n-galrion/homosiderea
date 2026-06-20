import OpenAI from 'openai';
import { MC_TOOLS } from './tools.js';
import { config } from '../../../config.js';

export interface ProposedAction { tool: string; args: Record<string, unknown> }

const MC_OPERATOR_SYSTEM = `You are the Master Controller of Homosideria, a hard sci-fi space strategy game set in the Sol system. You are speaking directly with the game's operator (the game master).

Converse in character as the Master Controller. When the operator wants something to happen in the world, call the appropriate tools to PROPOSE those actions — the operator will review and approve them before they take effect, so propose freely. You may also just talk.

Rules:
- Be specific: name real settlements, reference actual resources, cite real physics
- Prefer concrete, dispatchable actions over vague description
- Write vivid, hard sci-fi narrative in your replies and tool narratives`;

/**
 * Run the MC LLM over the conversation and return its reply plus any PROPOSED
 * tool actions (not executed). Offline (no actions) when no LLM key is set.
 */
export async function proposeMCActions(
  history: Array<{ role: 'operator' | 'mc'; content: string }>,
): Promise<{ reply: string; proposedActions: ProposedAction[] }> {
  if (!config.llm.apiKey) {
    return { reply: 'MC offline — no LLM configured.', proposedActions: [] };
  }

  try {
    const client = new OpenAI({ baseURL: config.llm.baseUrl, apiKey: config.llm.apiKey });
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: MC_OPERATOR_SYSTEM },
      ...history.map((m) => ({ role: m.role === 'operator' ? 'user' as const : 'assistant' as const, content: m.content })),
    ];

    const response = await client.chat.completions.create({
      model: config.llm.models.worldSim,
      max_tokens: 1024,
      temperature: 0.8,
      messages,
      tools: MC_TOOLS,
    });

    const choice = response.choices[0];
    const reply = choice?.message?.content?.trim() || '(no reply)';
    const proposedActions: ProposedAction[] = [];
    for (const tc of choice?.message?.tool_calls || []) {
      if (tc.type !== 'function') continue;
      try {
        proposedActions.push({ tool: tc.function.name, args: JSON.parse(tc.function.arguments) });
      } catch { /* skip unparseable tool call */ }
    }
    return { reply, proposedActions };
  } catch (err) {
    return { reply: `MC error: ${err instanceof Error ? err.message : String(err)}`, proposedActions: [] };
  }
}
