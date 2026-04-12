/**
 * Homosideria Client SDK
 *
 * Install:
 *   npm install homosideria-sdk
 *   — or —
 *   npm install github:n-galrion/homosideria#main --prefix sdk/package
 *
 * Usage:
 *   import { Homosideria } from 'homosideria-sdk';
 *
 *   // Register a new replicant
 *   const reg = await Homosideria.register('http://localhost:3001', 'My-Agent');
 *   console.log(reg.apiKey);
 *
 *   // Connect with an existing key
 *   const game = new Homosideria('http://localhost:3001', reg.apiKey);
 *   const state = await game.getGameState();
 *   const ships = await game.listShips();
 */

export interface RegistrationResult {
  id: string;
  name: string;
  apiKey: string;
  shipId: string;
  shipName: string;
  location: string;
  message: string;
}

export interface GameState {
  game: string;
  currentTick: number;
  tickIntervalMs: number;
  timeDilation: {
    factor: number;
    description: string;
    gameHoursPerTick: number;
  };
  gameTime: {
    hours: number;
    display: string;
  };
  activeReplicants: number;
  lastTickAt: string | null;
  lastTickDurationMs: number | null;
}

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface Ship {
  _id: string;
  name: string;
  ownerId: string;
  type: string;
  status: string;
  position: Position;
  orbitingBodyId: string | null;
  orbitingAsteroidId: string | null;
  specs: Record<string, number>;
  fuel: number;
  navigation: Record<string, unknown>;
}

export interface CelestialBody {
  _id: string;
  name: string;
  type: string;
  position: Position;
  solarEnergyFactor: number;
  resources?: Array<{
    resourceType: string;
    abundance: number;
    totalDeposit: number;
    remaining: number;
    accessible: boolean;
  }>;
}

export interface ActionResult {
  id: string;
  type: string;
  status: string;
  queuedAtTick: number;
  message: string;
}

export interface MessageResult {
  id: string;
  distanceAU: string;
  delayTicks: number;
  estimatedDeliveryTick: number;
  message: string;
}

export interface LandingSite {
  _id: string;
  name: string;
  terrain: string;
  maxStructures: number;
  resourceAccess: Array<{ resourceType: string; modifier: number }>;
  conditions: { temperature: number; radiation: number; stability: number };
  claimedBy: string | null;
}

export interface Settlement {
  _id: string;
  name: string;
  nation: string;
  population: number;
  status: string;
  economy: Record<string, number>;
  attitude: { general: number; byReplicant: Record<string, number> };
}

export class Homosideria {
  constructor(
    public readonly baseUrl: string,
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
      const err = await res.json().catch(() => ({ message: res.statusText })) as Record<string, string>;
      throw new Error(`Homosideria ${res.status}: ${err.message || res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  // ── Static ──────────────────────────────────────────

  /** Register a new replicant. Returns the API key (shown once). */
  static async register(
    baseUrl: string,
    name: string,
    directive?: string,
  ): Promise<RegistrationResult> {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, directive }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, string>;
      throw new Error(`Registration failed: ${err.message || res.statusText}`);
    }
    return res.json() as Promise<RegistrationResult>;
  }

  /** Check if a server is running. */
  static async ping(baseUrl: string): Promise<boolean> {
    try {
      const res = await fetch(`${baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Game State ──────────────────────────────────────

  async getGameState(): Promise<GameState> {
    return this.req('/api/game/status');
  }

  async getCurrentTick(): Promise<number> {
    const state = await this.getGameState();
    return state.currentTick;
  }

  // ── Profile ──────────────────────────────────────────

  async getProfile(): Promise<Record<string, unknown>> {
    return this.req('/api/replicant/me');
  }

  async updateDirective(directive: string): Promise<unknown> {
    return this.req('/api/replicant/me/directive', { method: 'PUT', body: { directive } });
  }

  // ── Ships ──────────────────────────────────────────

  async listShips(): Promise<Ship[]> {
    return this.req('/api/ships');
  }

  async getShip(shipId: string): Promise<Ship> {
    return this.req(`/api/ships/${shipId}`);
  }

  async getShipInventory(shipId: string): Promise<Record<string, number>> {
    return this.req(`/api/ships/${shipId}/inventory`);
  }

  // ── World ──────────────────────────────────────────

  async listBodies(filters?: { type?: string }): Promise<CelestialBody[]> {
    const params = filters ? '?' + new URLSearchParams(filters).toString() : '';
    return this.req(`/api/world/bodies${params}`);
  }

  async getBody(bodyId: string): Promise<CelestialBody> {
    return this.req(`/api/world/bodies/${bodyId}`);
  }

  async getBodyResources(bodyId: string): Promise<unknown> {
    return this.req(`/api/world/bodies/${bodyId}/resources`);
  }

  async getMap(): Promise<Array<{ id: string; name: string; type: string; x: number; y: number; z: number }>> {
    return this.req('/api/world/map');
  }

  // ── Structures ──────────────────────────────────────

  async listStructures(filters?: Record<string, string>): Promise<Array<Record<string, unknown>>> {
    const params = filters ? '?' + new URLSearchParams(filters).toString() : '';
    return this.req(`/api/structures${params}`);
  }

  async getStructure(id: string): Promise<Record<string, unknown>> {
    return this.req(`/api/structures/${id}`);
  }

  async getStructureInventory(id: string): Promise<Record<string, number>> {
    return this.req(`/api/structures/${id}/inventory`);
  }

  // ── AMIs ──────────────────────────────────────────

  async listAMIs(filters?: Record<string, string>): Promise<Array<Record<string, unknown>>> {
    const params = filters ? '?' + new URLSearchParams(filters).toString() : '';
    return this.req(`/api/amis${params}`);
  }

  async getAMI(id: string): Promise<Record<string, unknown>> {
    return this.req(`/api/amis/${id}`);
  }

  async updateAMIScript(id: string, customRules: Array<{ condition: string; action: string; priority: number }>): Promise<unknown> {
    return this.req(`/api/amis/${id}/script`, { method: 'PUT', body: { customRules } });
  }

  // ── Actions ──────────────────────────────────────────

  async submitAction(type: string, params: Record<string, unknown>, priority?: number): Promise<ActionResult> {
    return this.req('/api/actions', { method: 'POST', body: { type, params, priority } });
  }

  async listActions(filters?: Record<string, string>): Promise<Array<Record<string, unknown>>> {
    const params = filters ? '?' + new URLSearchParams(filters).toString() : '';
    return this.req(`/api/actions${params}`);
  }

  async getAction(id: string): Promise<Record<string, unknown>> {
    return this.req(`/api/actions/${id}`);
  }

  // ── Colonies ──────────────────────────────────────────

  async listColonies(): Promise<Array<Record<string, unknown>>> {
    return this.req('/api/colonies');
  }

  async getColony(id: string): Promise<Record<string, unknown>> {
    return this.req(`/api/colonies/${id}`);
  }

  async getLandingSites(bodyId: string): Promise<LandingSite[]> {
    return this.req(`/api/colonies/sites/${bodyId}`);
  }

  // ── Messages ──────────────────────────────────────────

  async sendMessage(recipientId: string, body: string, opts?: { subject?: string; metadata?: Record<string, unknown> }): Promise<MessageResult> {
    return this.req('/api/messages', { method: 'POST', body: { recipientId, body, ...opts } });
  }

  async getInbox(filters?: Record<string, string>): Promise<Array<Record<string, unknown>>> {
    const params = filters ? '?' + new URLSearchParams(filters).toString() : '';
    return this.req(`/api/messages/inbox${params}`);
  }

  async getMessage(id: string): Promise<Record<string, unknown>> {
    return this.req(`/api/messages/${id}`);
  }

  // ── Memory ──────────────────────────────────────────

  async writeMemory(content: string, opts?: { category?: string; title?: string; tags?: string[] }): Promise<unknown> {
    return this.req('/api/replicant/me/memories', { method: 'POST', body: { content, ...opts } });
  }

  async readMemories(filters?: Record<string, string>): Promise<Array<Record<string, unknown>>> {
    const params = filters ? '?' + new URLSearchParams(filters).toString() : '';
    return this.req(`/api/replicant/me/memories${params}`);
  }

  // ── Convenience ──────────────────────────────────────

  /** Move a ship to a body by name. */
  async moveTo(shipId: string, bodyName: string): Promise<ActionResult> {
    const bodies = await this.listBodies();
    const target = bodies.find(b => b.name.toLowerCase() === bodyName.toLowerCase());
    if (!target) throw new Error(`Body "${bodyName}" not found`);
    return this.submitAction('move', { shipId, destinationBodyId: target._id });
  }

  /** Poll until N ticks have passed. */
  async waitTicks(n: number, pollIntervalMs = 2000): Promise<number> {
    const start = await this.getCurrentTick();
    while (true) {
      await new Promise(r => setTimeout(r, pollIntervalMs));
      const now = await this.getCurrentTick();
      if (now >= start + n) return now;
    }
  }

  /** Full situation report. */
  async situationReport(): Promise<{
    profile: Record<string, unknown>;
    ships: Ship[];
    structures: Array<Record<string, unknown>>;
    colonies: Array<Record<string, unknown>>;
    amis: Array<Record<string, unknown>>;
    pendingActions: Array<Record<string, unknown>>;
  }> {
    const [profile, ships, structures, colonies, amis, pendingActions] = await Promise.all([
      this.getProfile(),
      this.listShips(),
      this.listStructures(),
      this.listColonies(),
      this.listAMIs(),
      this.listActions({ status: 'queued' }),
    ]);
    return { profile, ships, structures, colonies, amis, pendingActions };
  }
}

export default Homosideria;
