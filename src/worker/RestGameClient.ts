import { config } from '../config.js';
import type { IGameClient, ToolDefinition } from './IGameClient.js';

/**
 * HTTP implementation of IGameClient.
 * Calls the game server REST API using the replicant's API key.
 * Use this when the worker runs as a separate process (default) — it's the
 * open-source-friendly path and works against any Homosideria server.
 */
export class RestGameClient implements IGameClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey: string, baseUrl: string = config.agent.gameApiUrl) {
    this.baseUrl = baseUrl;
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

  async getToolDefinitions(): Promise<ToolDefinition[]> {
    const data = await this.request('GET', '/api/tools') as { tools: ToolDefinition[] };
    return data.tools;
  }

  async executeTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    const data = await this.request('POST', `/api/tools/${toolName}`, params) as { result: unknown };
    return data.result;
  }
}
