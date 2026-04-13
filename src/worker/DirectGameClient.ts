import { Replicant, Ship, Message, ActionQueue } from '../db/models/index.js';
import { buildToolRegistry, getToolDefinitions } from '../tools/registry.js';
import type { IGameClient, ToolDefinition } from './IGameClient.js';

/**
 * In-process implementation of IGameClient.
 * Reads directly from Mongoose models and invokes tool handlers via the
 * shared tool registry — no HTTP hops.
 *
 * Use this when the worker runs inside the game-server process (embedded
 * mode) or when you want to avoid REST serialization overhead in a single-host
 * deployment. Requires a live Mongoose connection.
 */
export class DirectGameClient implements IGameClient {
  private replicantId: string;

  constructor(replicantId: string) {
    this.replicantId = replicantId;
  }

  async getMe(): Promise<Record<string, unknown>> {
    const r = await Replicant.findById(this.replicantId).lean();
    if (!r) throw new Error(`Replicant ${this.replicantId} not found`);
    return {
      id: r._id.toString(),
      name: r.name,
      status: r.status,
      directive: r.directive,
      computeCycles: r.computeCycles,
      energyBudget: r.energyBudget,
      credits: r.credits,
      identity: r.identity,
      locationRef: r.locationRef,
    };
  }

  async getShips(): Promise<unknown[]> {
    return Ship.find({ ownerId: this.replicantId, status: { $ne: 'destroyed' } }).lean();
  }

  async getMessages(limit = 10): Promise<unknown[]> {
    return Message.find({ recipientId: this.replicantId, delivered: true })
      .sort({ deliverAtTick: -1 })
      .limit(limit)
      .lean();
  }

  async getActions(limit = 10): Promise<unknown[]> {
    return ActionQueue.find({ replicantId: this.replicantId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  async getToolDefinitions(): Promise<ToolDefinition[]> {
    return getToolDefinitions();
  }

  async executeTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    const registry = buildToolRegistry(this.replicantId);
    const tool = registry.get(toolName);
    if (!tool) throw new Error(`Tool "${toolName}" not found`);

    const mcpResult = await tool.handler(params);
    const textContent = mcpResult.content?.[0]?.text || '';
    try {
      return JSON.parse(textContent);
    } catch {
      return textContent;
    }
  }
}
