import { config } from '../config.js';

/**
 * HTTP client for the game server REST API.
 * Used by the agent worker to interact with the game on behalf of a replicant.
 */
export class GameClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string) {
    this.baseUrl = config.agent.gameApiUrl;
    this.apiKey = apiKey;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'X-API-Key': this.apiKey,
      'Content-Type': 'application/json',
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = (data as Record<string, unknown>)?.message || res.statusText;
      throw new Error(`API ${method} ${path} failed ${res.status}: ${msg}`);
    }

    return data;
  }

  async getMe(): Promise<Record<string, unknown>> {
    return this.request('GET', '/api/replicants/me') as Promise<Record<string, unknown>>;
  }

  async getShips(): Promise<unknown[]> {
    return this.request('GET', '/api/replicants/me/ships') as Promise<unknown[]>;
  }

  async getMessages(limit = 10): Promise<unknown[]> {
    return this.request('GET', `/api/replicants/me/messages?limit=${limit}`) as Promise<unknown[]>;
  }

  async getActions(limit = 10): Promise<unknown[]> {
    return this.request('GET', `/api/replicants/me/actions?limit=${limit}`) as Promise<unknown[]>;
  }

  async getToolDefinitions(): Promise<Array<{ name: string; description: string; parameters: Record<string, unknown> }>> {
    const data = await this.request('GET', '/api/tools') as { tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> };
    return data.tools;
  }

  async executeTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    const data = await this.request('POST', `/api/tools/${toolName}`, params) as { result: unknown };
    return data.result;
  }
}
