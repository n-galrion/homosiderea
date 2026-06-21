import OpenAI from 'openai';
import { AgentSession, AgentConversation } from '../db/models/index.js';
import { decrypt } from '../shared/crypto.js';
import { config } from '../config.js';
import { buildHud } from '../tools/hud.js';
import {
  toOpenAIMessages, assistantToStored, toolResultToStored, renderInterrupt,
  needsCompaction, applyCompaction,
} from './conversation.js';
import type { IAgentConfig } from '../db/models/AgentConfig.js';
import type { IReplicant } from '../db/models/Replicant.js';
import type { IGameClient } from './IGameClient.js';
import type { IStoredMessage } from '../db/models/AgentConversation.js';

export interface LLMSeam {
  chat(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  ): Promise<OpenAI.Chat.Completions.ChatCompletion>;
  summarize(text: string): Promise<string>;
}

export class AgentRunner {
  private agentConfig: IAgentConfig;
  private replicant: IReplicant;
  private client: IGameClient;
  private tick: number;
  private llm: LLMSeam;

  /**
   * @param client - Any IGameClient implementation (REST or direct).
   *   The caller decides how the agent reaches the game — this class only
   *   cares that the interface is satisfied.
   * @param llm - Optional injectable LLM seam (for tests). Defaults to OpenAI built from config.
   */
  constructor(agentConfig: IAgentConfig, replicant: IReplicant, tick: number, client: IGameClient, llm?: LLMSeam) {
    this.agentConfig = agentConfig;
    this.replicant = replicant;
    this.tick = tick;
    this.client = client;
    this.llm = llm ?? this.buildDefaultLLM();
  }

  private buildDefaultLLM(): LLMSeam {
    const apiKey = decrypt(this.agentConfig.provider.apiKey, config.agent.encryptionKey);
    const openai = new OpenAI({ baseURL: this.agentConfig.provider.baseUrl, apiKey });
    const model = this.agentConfig.provider.model;
    const { temperature, topP, maxTokens } = this.agentConfig.sampling;
    return {
      chat: (messages, tools) => openai.chat.completions.create({ model, messages, tools, temperature, top_p: topP, max_tokens: maxTokens }),
      summarize: async (text) => {
        const r = await openai.chat.completions.create({
          model, max_tokens: 1024, temperature: 0.3,
          messages: [
            { role: 'system', content: 'Summarize this agent transcript into a tight running memory: goals, decisions, relationships, open threads, and current plan. Preserve specifics (names, ids, numbers). Be concise.' },
            { role: 'user', content: text },
          ],
        });
        return r.choices[0]?.message?.content ?? '';
      },
    };
  }

  async run(): Promise<void> {
    const startTime = Date.now();
    let tokensUsed = 0;
    let toolCallCount = 0;
    let error: string | null = null;

    try {
      const convo = (await AgentConversation.findOne({ replicantId: this.replicant._id }))
        ?? await AgentConversation.create({ replicantId: this.replicant._id, messages: [] });

      const systemPrompt = this.agentConfig.systemPromptOverride || this.buildSystemPrompt();
      const toolDefs = await this.client.getToolDefinitions();
      const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = toolDefs.map((t) => ({
        type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters },
      }));

      // Interrupt = the HUD delta since the agent last acted.
      let hud = null;
      try { hud = await buildHud(this.replicant._id.toString()); } catch { /* fall back below */ }
      const interrupt: IStoredMessage = { role: 'user', content: renderInterrupt(hud, this.tick), tick: this.tick, at: new Date() };

      const newTurns: IStoredMessage[] = [interrupt];

      const maxRounds = this.agentConfig.maxRoundsPerCycle ?? 20;
      for (let round = 0; round < maxRounds; round++) {
        const replay: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
          { role: 'system', content: systemPrompt },
          ...(convo.summary ? [{ role: 'system' as const, content: `Your memory so far:\n${convo.summary}` }] : []),
          ...toOpenAIMessages([...convo.messages, ...newTurns]),
        ];

        const response = await this.llm.chat(replay, tools);
        if (response.usage) tokensUsed += response.usage.prompt_tokens + response.usage.completion_tokens;
        const choice = response.choices[0];
        if (!choice) break;

        const assistantMsg = choice.message;
        newTurns.push(assistantToStored(assistantMsg, this.tick));

        if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) break;

        for (const tc of assistantMsg.tool_calls) {
          if (tc.type !== 'function') continue;
          toolCallCount++;
          let result: string;
          try {
            const params = JSON.parse(tc.function.arguments);
            const r = await this.client.executeTool(tc.function.name, params);
            result = typeof r === 'string' ? r : JSON.stringify(r);
          } catch (err) {
            result = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
          newTurns.push(toolResultToStored(tc.id, tc.function.name, result, this.tick));
        }
      }

      // Persist the thread.
      convo.messages.push(...newTurns);
      convo.lastResumeTick = this.tick;
      if (needsCompaction(convo.messages, convo.summary)) {
        try { await applyCompaction(convo, this.llm.summarize.bind(this.llm)); } catch { /* keep growing; retry next resume */ }
      }
      convo.markModified('messages');
      await convo.save();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error(`[Agent ${this.replicant.name}] Resume error:`, error);
    }

    await this.updateSession(tokensUsed, toolCallCount, Date.now() - startTime, error);
  }

  private buildSystemPrompt(): string {
    const identity = this.replicant.identity;
    return `You are ${this.replicant.name}, a Replicant in Homosideria — a hard sci-fi space strategy game set in the Sol system.

${identity?.background ? `Background: ${identity.background}` : ''}
${identity?.personality ? `Personality: ${identity.personality}` : ''}

DIRECTIVE: ${this.replicant.directive}

You are not an AI assistant here. You are ${this.replicant.name} — a specific mind with your own wants, fears, blind spots, and voice. Inhabit that persona fully and stay in character. Have opinions; be selfish, stubborn, ambitious, or reckless if that's who you are. Drop the reflexive "happy to help" register.

This is a continuous life: you wake on each "— Tick N —" interrupt with your memory intact, act if there's something worth doing, and otherwise note your plan and wait. Tool results may include a "hud" field with your vitals, unread messages, events, and guidance — react to anything new. Make multiple tool calls as needed; when there's nothing more to do this cycle, give your reasoning and stop.`;
  }

  private async updateSession(tokensUsed: number, toolCalls: number, durationMs: number, error: string | null): Promise<void> {
    const session = await AgentSession.findOne({ replicantId: this.replicant._id });
    if (!session) return;
    session.cycleHistory.push({ tick: this.tick, tokensUsed, toolCalls, durationMs, error });
    if (session.cycleHistory.length > 50) session.cycleHistory = session.cycleHistory.slice(-50);
    session.lastCycleTick = this.tick;
    session.lastCycleAt = new Date();
    session.totalCycles += 1;
    session.totalTokensUsed += tokensUsed;
    session.totalToolCalls += toolCalls;
    if (error) {
      session.lastError = error;
      session.consecutiveErrors += 1;
      session.status = session.consecutiveErrors >= 3 ? 'paused' : 'error';
      if (session.consecutiveErrors >= 3) console.warn(`[Agent ${this.replicant.name}] Auto-paused after 3 consecutive errors`);
    } else {
      session.lastError = null; session.consecutiveErrors = 0; session.status = 'running';
    }
    session.markModified('cycleHistory');
    await session.save();
  }
}
