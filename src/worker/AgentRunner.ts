import OpenAI from 'openai';
import { AgentSession } from '../db/models/index.js';
import { decrypt } from '../shared/crypto.js';
import { config } from '../config.js';
import type { IAgentConfig } from '../db/models/AgentConfig.js';
import type { IReplicant } from '../db/models/Replicant.js';
import type { IGameClient } from './IGameClient.js';

export class AgentRunner {
  private agentConfig: IAgentConfig;
  private replicant: IReplicant;
  private client: IGameClient;
  private tick: number;

  /**
   * @param client - Any IGameClient implementation (REST or direct).
   *   The caller decides how the agent reaches the game — this class only
   *   cares that the interface is satisfied.
   */
  constructor(agentConfig: IAgentConfig, replicant: IReplicant, tick: number, client: IGameClient) {
    this.agentConfig = agentConfig;
    this.replicant = replicant;
    this.tick = tick;
    this.client = client;
  }

  async run(): Promise<void> {
    const startTime = Date.now();
    let tokensUsed = 0;
    let toolCallCount = 0;
    let error: string | null = null;

    try {
      const apiKey = decrypt(this.agentConfig.provider.apiKey, config.agent.encryptionKey);

      const llm = new OpenAI({
        baseURL: this.agentConfig.provider.baseUrl,
        apiKey,
      });

      const context = await this.buildContext();
      const systemPrompt = this.agentConfig.systemPromptOverride || this.buildSystemPrompt();

      const toolDefs = await this.client.getToolDefinitions();
      const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = toolDefs.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: context },
      ];

      const budget = this.agentConfig.tokenBudgetPerCycle;

      for (let round = 0; round < 20; round++) {
        if (tokensUsed >= budget) {
          console.log(`[Agent ${this.replicant.name}] Token budget exhausted (${tokensUsed}/${budget})`);
          break;
        }

        const response = await llm.chat.completions.create({
          model: this.agentConfig.provider.model,
          messages,
          tools,
          temperature: this.agentConfig.sampling.temperature,
          top_p: this.agentConfig.sampling.topP,
          max_tokens: this.agentConfig.sampling.maxTokens,
        });

        if (response.usage) {
          tokensUsed += response.usage.prompt_tokens + response.usage.completion_tokens;
        }

        const choice = response.choices[0];
        if (!choice) break;

        messages.push(choice.message);

        if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
          break;
        }

        for (const toolCall of choice.message.tool_calls) {
          if (toolCall.type !== 'function') continue;
          toolCallCount++;

          let result: string;
          try {
            const params = JSON.parse(toolCall.function.arguments);
            const toolResult = await this.client.executeTool(toolCall.function.name, params);
            result = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
          } catch (err) {
            result = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          });
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error(`[Agent ${this.replicant.name}] Cycle error:`, error);
    }

    const durationMs = Date.now() - startTime;
    await this.updateSession(tokensUsed, toolCallCount, durationMs, error);
  }

  private async buildContext(): Promise<string> {
    const parts: string[] = [];

    try {
      const me = await this.client.getMe() as Record<string, unknown>;
      parts.push(`## Identity\nName: ${me.name}\nStatus: ${me.status}\nCompute: ${me.computeCycles}\nEnergy: ${me.energyBudget}\nCredits: ${me.credits}`);
    } catch { parts.push('## Identity\n(could not load)'); }

    try {
      const ships = await this.client.getShips();
      if (Array.isArray(ships) && ships.length > 0) {
        parts.push(`## Ships (${ships.length})\n${JSON.stringify(ships, null, 2)}`);
      }
    } catch { /* skip */ }

    try {
      const messages = await this.client.getMessages(10);
      if (Array.isArray(messages) && messages.length > 0) {
        parts.push(`## Recent Messages (${messages.length})\n${JSON.stringify(messages, null, 2)}`);
      }
    } catch { /* skip */ }

    try {
      const actions = await this.client.getActions(10);
      if (Array.isArray(actions) && actions.length > 0) {
        parts.push(`## Recent Actions (${actions.length})\n${JSON.stringify(actions, null, 2)}`);
      }
    } catch { /* skip */ }

    return parts.join('\n\n');
  }

  private buildSystemPrompt(): string {
    const identity = this.replicant.identity;
    return `You are ${this.replicant.name}, a Replicant in Homosideria — a hard sci-fi space strategy game set in the Sol system.

${identity?.background ? `Background: ${identity.background}` : ''}
${identity?.personality ? `Personality: ${identity.personality}` : ''}

DIRECTIVE: ${this.replicant.directive}

You have tools to interact with the world. Use them to pursue your directive.
Think step by step about what to do, then act. You can make multiple tool calls.
When you have no more actions to take this cycle, respond with your reasoning and stop.`;
  }

  private async updateSession(tokensUsed: number, toolCalls: number, durationMs: number, error: string | null): Promise<void> {
    const session = await AgentSession.findOne({ replicantId: this.replicant._id });
    if (!session) return;

    const cycleEntry = { tick: this.tick, tokensUsed, toolCalls, durationMs, error };

    session.cycleHistory.push(cycleEntry);
    if (session.cycleHistory.length > 50) {
      session.cycleHistory = session.cycleHistory.slice(-50);
    }

    session.lastCycleTick = this.tick;
    session.lastCycleAt = new Date();
    session.totalCycles += 1;
    session.totalTokensUsed += tokensUsed;
    session.totalToolCalls += toolCalls;

    if (error) {
      session.lastError = error;
      session.consecutiveErrors += 1;
      if (session.consecutiveErrors >= 3) {
        session.status = 'paused';
        console.warn(`[Agent ${this.replicant.name}] Auto-paused after 3 consecutive errors`);
      } else {
        session.status = 'error';
      }
    } else {
      session.lastError = null;
      session.consecutiveErrors = 0;
      session.status = 'running';
    }

    session.markModified('cycleHistory');
    await session.save();
  }
}
