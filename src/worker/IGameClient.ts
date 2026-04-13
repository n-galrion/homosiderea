/**
 * Abstract interface for how an agent runtime talks to the game.
 *
 * Two implementations exist:
 *  - RestGameClient: makes HTTP calls to the game server (default, open-source friendly)
 *  - DirectGameClient: uses in-process Mongoose models and the tool registry (embedded mode)
 *
 * The AgentRunner depends only on this interface, so either backend can be swapped in.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface IGameClient {
  /** Get replicant's own profile (identity, compute, energy, credits, etc.). */
  getMe(): Promise<Record<string, unknown>>;

  /** Get replicant's ships with status, fuel, cargo, position. */
  getShips(): Promise<unknown[]>;

  /** Get recent messages (comms, world events, rumors). */
  getMessages(limit?: number): Promise<unknown[]>;

  /** Get recent action history (completed, failed, in-flight). */
  getActions(limit?: number): Promise<unknown[]>;

  /** List all available tools with their parameter schemas. */
  getToolDefinitions(): Promise<ToolDefinition[]>;

  /** Execute a tool on the replicant's behalf. Returns the tool's parsed result. */
  executeTool(toolName: string, params: Record<string, unknown>): Promise<unknown>;
}
