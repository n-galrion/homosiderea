/**
 * Homosideria Client SDK
 *
 * A standalone TypeScript client for the Homosideria REST API.
 * Agents can use this in their own scripts to automate gameplay
 * without going through MCP tool calls.
 *
 * Usage:
 *   import { Homosideria } from './homosideria.js';
 *   const game = new Homosideria('http://localhost:3001', 'hs_your_api_key');
 *   const status = await game.getGameState();
 */

export class Homosideria {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private async req<T = unknown>(
    path: string,
    opts: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(`${res.status} ${(err as Record<string, string>).message || res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  private async adminReq<T = unknown>(
    path: string,
    adminKey: string,
    opts: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': adminKey,
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(`${res.status} ${(err as Record<string, string>).message || res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  // ── Auth ──────────────────────────────────────────────

  static async register(
    baseUrl: string,
    name: string,
    directive?: string,
  ): Promise<{ id: string; name: string; apiKey: string; shipId: string; shipName: string }> {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, directive }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Registration failed: ${(err as Record<string, string>).message || res.statusText}`);
    }
    return res.json() as Promise<{ id: string; name: string; apiKey: string; shipId: string; shipName: string }>;
  }

  // ── Game State ──────────────────────────────────────────

  async getGameState() {
    return this.req('/api/game/status');
  }

  async getTick(tickNumber: number) {
    return this.req(`/api/game/tick/${tickNumber}`);
  }

  // ── Profile ──────────────────────────────────────────

  async getProfile() {
    return this.req('/api/replicant/me');
  }

  async updateDirective(directive: string) {
    return this.req('/api/replicant/me/directive', { method: 'PUT', body: { directive } });
  }

  // ── Ships ──────────────────────────────────────────

  async listShips() {
    return this.req<Array<Record<string, unknown>>>('/api/ships');
  }

  async getShip(shipId: string) {
    return this.req(`/api/ships/${shipId}`);
  }

  async getShipInventory(shipId: string) {
    return this.req(`/api/ships/${shipId}/inventory`);
  }

  // ── Structures ──────────────────────────────────────

  async listStructures(filters?: { status?: string; type?: string; bodyId?: string }) {
    const params = new URLSearchParams(filters as Record<string, string>).toString();
    return this.req(`/api/structures${params ? '?' + params : ''}`);
  }

  async getStructure(id: string) {
    return this.req(`/api/structures/${id}`);
  }

  async getStructureInventory(id: string) {
    return this.req(`/api/structures/${id}/inventory`);
  }

  // ── World ──────────────────────────────────────────

  async listBodies(filters?: { type?: string }) {
    const params = new URLSearchParams(filters as Record<string, string>).toString();
    return this.req<Array<Record<string, unknown>>>(`/api/world/bodies${params ? '?' + params : ''}`);
  }

  async getBody(bodyId: string) {
    return this.req(`/api/world/bodies/${bodyId}`);
  }

  async getBodyResources(bodyId: string) {
    return this.req(`/api/world/bodies/${bodyId}/resources`);
  }

  async getMap() {
    return this.req<Array<Record<string, unknown>>>('/api/world/map');
  }

  // ── AMIs ──────────────────────────────────────────

  async listAMIs(filters?: { status?: string; type?: string }) {
    const params = new URLSearchParams(filters as Record<string, string>).toString();
    return this.req(`/api/amis${params ? '?' + params : ''}`);
  }

  async getAMI(id: string) {
    return this.req(`/api/amis/${id}`);
  }

  async updateAMIScript(id: string, customRules: Array<{ condition: string; action: string; priority: number }>) {
    return this.req(`/api/amis/${id}/script`, { method: 'PUT', body: { customRules } });
  }

  // ── Actions ──────────────────────────────────────────

  async submitAction(type: string, params: Record<string, unknown>, priority?: number) {
    return this.req('/api/actions', {
      method: 'POST',
      body: { type, params, priority },
    });
  }

  async listActions(filters?: { status?: string; type?: string; limit?: string }) {
    const params = new URLSearchParams(filters as Record<string, string>).toString();
    return this.req(`/api/actions${params ? '?' + params : ''}`);
  }

  async getAction(id: string) {
    return this.req(`/api/actions/${id}`);
  }

  // ── Colonies ──────────────────────────────────────────

  async listColonies() {
    return this.req('/api/colonies');
  }

  async getColony(id: string) {
    return this.req(`/api/colonies/${id}`);
  }

  async getLandingSites(bodyId: string) {
    return this.req(`/api/colonies/sites/${bodyId}`);
  }

  // ── Messages ──────────────────────────────────────────

  async sendMessage(recipientId: string, body: string, subject?: string, metadata?: Record<string, unknown>) {
    return this.req('/api/messages', {
      method: 'POST',
      body: { recipientId, body, subject, metadata },
    });
  }

  async getInbox(filters?: { unreadOnly?: string; limit?: string; from?: string }) {
    const params = new URLSearchParams(filters as Record<string, string>).toString();
    return this.req(`/api/messages/inbox${params ? '?' + params : ''}`);
  }

  async getMessage(id: string) {
    return this.req(`/api/messages/${id}`);
  }

  // ── Memory ──────────────────────────────────────────

  async writeMemory(content: string, opts?: { category?: string; title?: string; tags?: string[] }) {
    return this.req('/api/replicant/me/memories', {
      method: 'POST',
      body: { content, ...opts },
    });
  }

  async readMemories(filters?: { category?: string; tag?: string; limit?: string }) {
    const params = new URLSearchParams(filters as Record<string, string>).toString();
    return this.req(`/api/replicant/me/memories${params ? '?' + params : ''}`);
  }

  // ── Admin (requires admin key) ──────────────────────

  async forceTick(adminKey: string) {
    return this.adminReq('/api/admin/tick/force', adminKey, { method: 'POST' });
  }

  async getAdminStatus(adminKey: string) {
    return this.adminReq('/api/admin/status', adminKey);
  }

  async listSettlements(adminKey: string) {
    return this.adminReq('/api/admin/settlements', adminKey);
  }

  async listMarkets(adminKey: string) {
    return this.adminReq('/api/admin/markets', adminKey);
  }

  // ── Convenience / Compound Actions ──────────────────

  /** Move a ship to a body by name. Finds the body ID automatically. */
  async moveTo(shipId: string, bodyName: string) {
    const bodies = await this.listBodies();
    const target = bodies.find(b => (b.name as string).toLowerCase() === bodyName.toLowerCase());
    if (!target) throw new Error(`Body "${bodyName}" not found`);
    return this.submitAction('move', { shipId, destinationBodyId: target._id });
  }

  /** Wait for N ticks by polling game state. */
  async waitTicks(n: number, pollIntervalMs = 2000): Promise<void> {
    const start = ((await this.getGameState()) as Record<string, number>).currentTick;
    while (true) {
      await new Promise(r => setTimeout(r, pollIntervalMs));
      const now = ((await this.getGameState()) as Record<string, number>).currentTick;
      if (now >= start + n) return;
    }
  }

  /** Get a summary of everything: profile, ships, structures, nearby. */
  async situationReport() {
    const [profile, ships, structures, colonies, amis, actions] = await Promise.all([
      this.getProfile(),
      this.listShips(),
      this.listStructures(),
      this.listColonies(),
      this.listAMIs(),
      this.listActions({ status: 'queued' }),
    ]);
    return { profile, ships, structures, colonies, amis, pendingActions: actions };
  }
}
