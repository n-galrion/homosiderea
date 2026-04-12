# Managed Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate worker process that runs AI agents for replicants, using user-provided LLM credentials, communicating with the game server via Redis pub/sub and REST API.

**Architecture:** Separate worker process subscribes to Redis `tick:complete` events. For each due agent, it builds context via REST, runs an agentic loop with the user's LLM (multi-step tool calling), and executes tools via a new generic `POST /api/tools/:toolName` endpoint. API keys encrypted at rest with AES-256-GCM. Web UI for configuration.

**Tech Stack:** TypeScript, Node.js, Express, MongoDB/Mongoose, Redis/ioredis, OpenAI SDK, AES-256-GCM encryption, EJS templates

**Spec:** `docs/superpowers/specs/2026-04-12-managed-agent-runtime.md`

---

## File Map

### New Files
- `src/shared/crypto.ts` — AES-256-GCM encrypt/decrypt
- `src/db/models/AgentConfig.ts` — Mongoose model for agent LLM config
- `src/db/models/AgentSession.ts` — Mongoose model for agent runtime state
- `src/tools/registry.ts` — Tool capture proxy + registry (extracts tool handlers from MCP registration without refactoring tool files)
- `src/api/routes/tools.routes.ts` — `GET /api/tools` + `POST /api/tools/:toolName`
- `src/worker/index.ts` — Worker entry point
- `src/worker/WorkerLoop.ts` — Redis subscriber, agent scheduler
- `src/worker/AgentRunner.ts` — Agentic loop: context building, LLM calls, tool execution
- `src/worker/GameClient.ts` — REST client wrapper for game API
- `src/web/views/agents.ejs` — Agent list page
- `src/web/views/agent.ejs` — Agent config page
- `test/crypto.test.ts` — Encryption tests
- `test/tools-api.test.ts` — Generic tool endpoint tests
- `test/worker.test.ts` — Worker/agent runner tests

### Modified Files
- `package.json` — Add `ioredis`, add `worker` script
- `src/config.ts` — Add redis, encryption key, game API URL config
- `src/db/models/index.ts` — Export AgentConfig, AgentSession
- `src/engine/GameLoop.ts` — Publish `tick:complete` to Redis after each tick
- `src/api/server.ts` — Mount tools routes
- `src/web/routes/pages.routes.ts` — Add agent web routes
- `src/web/views/partials/nav.ejs` — Add "Agents" nav link
- `docker-compose.yml` — Add Redis service + agent-worker service
- `.env.example` — Add new env vars
- `Dockerfile` — Add worker entrypoint option

---

### Task 1: Install Dependencies & Add Config

**Files:**
- Modify: `package.json`
- Modify: `src/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Install ioredis**

```bash
npm install ioredis
npm install -D @types/ioredis
```

Note: `@types/ioredis` may not be needed if ioredis ships its own types. Check after install — if it does, skip the devDep.

- [ ] **Step 2: Add config entries**

In `src/config.ts`, add after the `session` block (before the closing `} as const`):

```typescript
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  agent: {
    encryptionKey: process.env.AGENT_ENCRYPTION_KEY || '',
    gameApiUrl: process.env.GAME_API_URL || `http://localhost:${parseInt(process.env.PORT || '3001', 10)}`,
  },
```

- [ ] **Step 3: Update .env.example**

Add at the end of `.env.example`:

```
REDIS_URL=redis://localhost:6379
AGENT_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
GAME_API_URL=http://localhost:3001
```

- [ ] **Step 4: Add worker script to package.json**

Add to `"scripts"`:

```json
"worker": "tsx src/worker/index.ts"
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/config.ts .env.example
git commit -m "feat: add ioredis dependency and agent runtime config"
```

---

### Task 2: Encryption Utility

**Files:**
- Create: `src/shared/crypto.ts`
- Create: `test/crypto.test.ts`

- [ ] **Step 1: Write the test**

Create `test/crypto.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../src/shared/crypto.js';

const TEST_KEY = 'a'.repeat(64); // 32 bytes in hex

describe('crypto', () => {
  it('encrypts and decrypts a string', () => {
    const plaintext = 'sk-my-secret-api-key-12345';
    const ciphertext = encrypt(plaintext, TEST_KEY);
    expect(ciphertext).not.toEqual(plaintext);
    expect(ciphertext).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    const decrypted = decrypt(ciphertext, TEST_KEY);
    expect(decrypted).toEqual(plaintext);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const plaintext = 'same-input';
    const c1 = encrypt(plaintext, TEST_KEY);
    const c2 = encrypt(plaintext, TEST_KEY);
    expect(c1).not.toEqual(c2);
    expect(decrypt(c1, TEST_KEY)).toEqual(plaintext);
    expect(decrypt(c2, TEST_KEY)).toEqual(plaintext);
  });

  it('throws on tampered ciphertext', () => {
    const ciphertext = encrypt('test', TEST_KEY);
    const parts = ciphertext.split(':');
    parts[2] = 'ff' + parts[2].slice(2); // tamper with ciphertext
    expect(() => decrypt(parts.join(':'), TEST_KEY)).toThrow();
  });

  it('throws on wrong key', () => {
    const ciphertext = encrypt('test', TEST_KEY);
    const wrongKey = 'b'.repeat(64);
    expect(() => decrypt(ciphertext, wrongKey)).toThrow();
  });

  it('handles empty string', () => {
    const ciphertext = encrypt('', TEST_KEY);
    expect(decrypt(ciphertext, TEST_KEY)).toEqual('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/crypto.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement crypto utility**

Create `src/shared/crypto.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt plaintext with AES-256-GCM.
 * @param plaintext - The string to encrypt
 * @param keyHex - 64-char hex string (32 bytes)
 * @returns Format: {iv_hex}:{authTag_hex}:{ciphertext_hex}
 */
export function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a string encrypted with encrypt().
 * @param ciphertext - Format: {iv_hex}:{authTag_hex}:{ciphertext_hex}
 * @param keyHex - 64-char hex string (32 bytes)
 * @returns The original plaintext
 */
export function decrypt(ciphertext: string, keyHex: string): string {
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/crypto.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/crypto.ts test/crypto.test.ts
git commit -m "feat: add AES-256-GCM encryption utility for agent API keys"
```

---

### Task 3: AgentConfig & AgentSession Models

**Files:**
- Create: `src/db/models/AgentConfig.ts`
- Create: `src/db/models/AgentSession.ts`
- Modify: `src/db/models/index.ts`

- [ ] **Step 1: Create AgentConfig model**

Create `src/db/models/AgentConfig.ts`:

```typescript
import { Schema, model, type Document, type Types } from 'mongoose';

export interface IAgentConfig extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  replicantId: Types.ObjectId;
  enabled: boolean;

  provider: {
    baseUrl: string;
    apiKey: string;   // AES-256-GCM encrypted
    model: string;
  };

  sampling: {
    temperature: number;
    topP: number;
    maxTokens: number;
  };

  thinkEveryNTicks: number;
  tokenBudgetPerCycle: number;
  systemPromptOverride: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const AgentConfigSchema = new Schema<IAgentConfig>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  replicantId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true, unique: true },
  enabled: { type: Boolean, default: false },

  provider: {
    baseUrl: { type: String, default: 'https://openrouter.ai/api/v1' },
    apiKey: { type: String, default: '' },
    model: { type: String, default: 'anthropic/claude-sonnet-4' },
  },

  sampling: {
    temperature: { type: Number, default: 0.7 },
    topP: { type: Number, default: 1.0 },
    maxTokens: { type: Number, default: 4096 },
  },

  thinkEveryNTicks: { type: Number, default: 5, min: 1, max: 100 },
  tokenBudgetPerCycle: { type: Number, default: 50000, min: 1000, max: 200000 },
  systemPromptOverride: { type: String, default: null },
}, { timestamps: true });

export const AgentConfig = model<IAgentConfig>('AgentConfig', AgentConfigSchema);
```

- [ ] **Step 2: Create AgentSession model**

Create `src/db/models/AgentSession.ts`:

```typescript
import { Schema, model, type Document, type Types } from 'mongoose';

export interface ICycleEntry {
  tick: number;
  tokensUsed: number;
  toolCalls: number;
  durationMs: number;
  error: string | null;
}

export interface IAgentSession extends Document {
  _id: Types.ObjectId;
  replicantId: Types.ObjectId;
  status: 'running' | 'paused' | 'stopped' | 'error';
  lastCycleTick: number;
  lastCycleAt: Date | null;
  lastError: string | null;
  consecutiveErrors: number;

  totalCycles: number;
  totalTokensUsed: number;
  totalToolCalls: number;

  cycleHistory: ICycleEntry[];

  createdAt: Date;
  updatedAt: Date;
}

const AgentSessionSchema = new Schema<IAgentSession>({
  replicantId: { type: Schema.Types.ObjectId, ref: 'Replicant', required: true, unique: true },
  status: {
    type: String,
    enum: ['running', 'paused', 'stopped', 'error'],
    default: 'stopped',
  },
  lastCycleTick: { type: Number, default: 0 },
  lastCycleAt: { type: Date, default: null },
  lastError: { type: String, default: null },
  consecutiveErrors: { type: Number, default: 0 },

  totalCycles: { type: Number, default: 0 },
  totalTokensUsed: { type: Number, default: 0 },
  totalToolCalls: { type: Number, default: 0 },

  cycleHistory: [{
    tick: { type: Number, required: true },
    tokensUsed: { type: Number, required: true },
    toolCalls: { type: Number, required: true },
    durationMs: { type: Number, required: true },
    error: { type: String, default: null },
  }],
}, { timestamps: true });

export const AgentSession = model<IAgentSession>('AgentSession', AgentSessionSchema);
```

- [ ] **Step 3: Export from index**

Add to `src/db/models/index.ts`:

```typescript
export { AgentConfig, type IAgentConfig } from './AgentConfig.js';
export { AgentSession, type IAgentSession, type ICycleEntry } from './AgentSession.js';
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/db/models/AgentConfig.ts src/db/models/AgentSession.ts src/db/models/index.ts
git commit -m "feat: add AgentConfig and AgentSession models"
```

---

### Task 4: Tool Capture Registry + REST Endpoint

This is the key architectural piece. Instead of refactoring all 65 MCP tool files, we create a "capture proxy" that records tool registrations when `registerAllTools()` is called, giving us a callable registry.

**Files:**
- Create: `src/tools/registry.ts`
- Create: `src/api/routes/tools.routes.ts`
- Modify: `src/api/server.ts`
- Create: `test/tools-api.test.ts`

- [ ] **Step 1: Create the tool registry with capture proxy**

Create `src/tools/registry.ts`:

```typescript
import { registerAllTools } from '../mcp/tools/index.js';

export interface ToolDef {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

/**
 * Capture proxy that mimics McpServer.tool() to record tool registrations.
 * This avoids refactoring all 65 tool files — we intercept their registrations
 * and store the handlers in a plain Map.
 */
class ToolCapture {
  tools = new Map<string, ToolDef>();

  tool(
    name: string,
    description: string,
    schema: Record<string, unknown>,
    handler: (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>,
  ): void {
    this.tools.set(name, { name, description, schema, handler });
  }

  // No-op stubs for other McpServer methods that tool files might call
  resource(..._args: unknown[]): void { /* no-op */ }
  prompt(..._args: unknown[]): void { /* no-op */ }
}

/**
 * Build a tool registry for a specific replicant.
 * Calls registerAllTools with a capture proxy to collect all tool handlers.
 * Each handler is bound to the given replicantId via closure (same as MCP).
 */
export function buildToolRegistry(replicantId: string): Map<string, ToolDef> {
  const capture = new ToolCapture();
  registerAllTools(capture as unknown as Parameters<typeof registerAllTools>[0], replicantId);
  return capture.tools;
}

/**
 * Get a static list of tool definitions (names, descriptions, schemas)
 * without binding to a specific replicant. Uses a dummy ID since we only
 * need metadata, not executable handlers.
 */
export function getToolDefinitions(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  const capture = new ToolCapture();
  registerAllTools(capture as unknown as Parameters<typeof registerAllTools>[0], '000000000000000000000000');
  return Array.from(capture.tools.values()).map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.schema,
  }));
}
```

- [ ] **Step 2: Create tools REST routes**

Create `src/api/routes/tools.routes.ts`:

```typescript
import { Router, type Request, type Response, type NextFunction } from 'express';
import { buildToolRegistry, getToolDefinitions } from '../../tools/registry.js';

export const toolsRoutes = Router();

/**
 * GET /api/tools — List all available tools with their schemas.
 * No auth required — tool definitions are public (like an API spec).
 */
toolsRoutes.get('/', (_req: Request, res: Response) => {
  const tools = getToolDefinitions();
  res.json({
    count: tools.length,
    tools: tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  });
});

/**
 * POST /api/tools/:toolName — Execute a tool as the authenticated replicant.
 * Body contains tool parameters as JSON.
 * Returns the tool result (parsed from MCP text format).
 */
toolsRoutes.post('/:toolName', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const replicantId = req.replicantId;
    if (!replicantId) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
      return;
    }

    const { toolName } = req.params;
    const registry = buildToolRegistry(replicantId);
    const tool = registry.get(toolName);

    if (!tool) {
      res.status(404).json({ error: 'NOT_FOUND', message: `Tool "${toolName}" not found` });
      return;
    }

    const mcpResult = await tool.handler(req.body || {});

    // Parse MCP format: { content: [{ type: 'text', text: '...' }] }
    // The text is usually JSON-stringified, so try to parse it
    const textContent = mcpResult.content?.[0]?.text || '';
    let result: unknown;
    try {
      result = JSON.parse(textContent);
    } catch {
      result = textContent;
    }

    res.json({ tool: toolName, result });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Mount tools routes in the API server**

Find the file that creates the Express app and mounts API routes. Read `src/api/server.ts` to find where routes are mounted, then add:

```typescript
import { toolsRoutes } from './routes/tools.routes.js';
```

And in the route mounting section, add (the tools listing is public, tool execution requires auth):

```typescript
app.get('/api/tools', (_req, res, next) => toolsRoutes.handle(_req, res, next));
app.use('/api/tools', authMiddleware, toolsRoutes);
```

Note: The exact mount pattern depends on how the existing routes are structured. Check `src/api/server.ts` for the pattern and follow it. The key is: `GET /api/tools` is public, `POST /api/tools/:name` requires `authMiddleware`.

- [ ] **Step 4: Write integration test**

Create `test/tools-api.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, api, registerReplicant } from './setup.js';

describe('Tools API', () => {
  beforeAll(async () => {
    await setupTestServer();
  }, 60000);

  afterAll(async () => {
    await teardownTestServer();
  });

  it('GET /api/tools returns tool list', async () => {
    const { status, data } = await api('/api/tools');
    expect(status).toBe(200);
    expect(data.count).toBeGreaterThan(50);
    expect(data.tools[0]).toHaveProperty('name');
    expect(data.tools[0]).toHaveProperty('description');
    expect(data.tools[0]).toHaveProperty('parameters');
  });

  it('POST /api/tools/get_game_state returns game state', async () => {
    const { apiKey } = await registerReplicant('ToolTestBot');
    const { status, data } = await api('/api/tools/get_game_state', {
      method: 'POST',
      apiKey,
      body: {},
    });
    expect(status).toBe(200);
    expect(data.tool).toBe('get_game_state');
    expect(data.result).toHaveProperty('currentTick');
  });

  it('POST /api/tools/get_position returns ship position', async () => {
    const { apiKey } = await registerReplicant('ToolTestBot2');
    const { status, data } = await api('/api/tools/get_position', {
      method: 'POST',
      apiKey,
      body: {},
    });
    expect(status).toBe(200);
    expect(data.result).toHaveProperty('position');
  });

  it('POST /api/tools/unknown_tool returns 404', async () => {
    const { apiKey } = await registerReplicant('ToolTestBot3');
    const { status, data } = await api('/api/tools/nonexistent', {
      method: 'POST',
      apiKey,
      body: {},
    });
    expect(status).toBe(404);
    expect(data.error).toBe('NOT_FOUND');
  });

  it('POST /api/tools without auth returns 401', async () => {
    const { status } = await api('/api/tools/get_game_state', {
      method: 'POST',
      body: {},
    });
    expect(status).toBe(401);
  });
});
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run test/tools-api.test.ts
```

Expected: All tests PASS. If the `api()` helper doesn't support `method: 'POST'` with `body`, check `test/setup.ts` and add support.

- [ ] **Step 6: Commit**

```bash
git add src/tools/registry.ts src/api/routes/tools.routes.ts src/api/server.ts test/tools-api.test.ts
git commit -m "feat: add generic tool execution REST endpoint (POST /api/tools/:name)"
```

---

### Task 5: Redis Pub/Sub in Game Server

**Files:**
- Modify: `src/engine/GameLoop.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add Redis connection to main entry point**

In `src/index.ts`, add near the top:

```typescript
import Redis from 'ioredis';
import { config } from './config.js';
```

After the game loop starts, create and export a Redis publisher:

```typescript
let redisPublisher: Redis | null = null;

if (config.redis.url) {
  try {
    redisPublisher = new Redis(config.redis.url);
    redisPublisher.on('error', (err) => console.warn('[Redis] Publisher error:', err.message));
    redisPublisher.on('connect', () => console.log('[Redis] Publisher connected'));
  } catch (err) {
    console.warn('[Redis] Could not connect — agent worker will not receive tick events:', err);
  }
}
```

Export a function for GameLoop to call:

```typescript
export function getRedisPublisher(): Redis | null {
  return redisPublisher;
}
```

- [ ] **Step 2: Publish tick events from GameLoop**

In `src/engine/GameLoop.ts`, add import:

```typescript
import { getRedisPublisher } from '../index.js';
```

In the `executeTick()` method, after `this.currentTick = nextTick;` and before the log line, add:

```typescript
      // Notify agent workers that a tick completed
      const redis = getRedisPublisher();
      if (redis) {
        redis.publish('tick:complete', JSON.stringify({ tick: nextTick })).catch(() => {});
      }
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: 0 errors. Note: There may be a circular import issue since GameLoop imports from index.ts. If so, extract `getRedisPublisher` into a separate `src/shared/redis.ts` module instead.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/engine/GameLoop.ts
git commit -m "feat: publish tick:complete to Redis after each game tick"
```

---

### Task 6: Worker — GameClient (REST wrapper)

**Files:**
- Create: `src/worker/GameClient.ts`

- [ ] **Step 1: Create GameClient**

Create `src/worker/GameClient.ts`:

```typescript
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
      throw new Error(`API ${method} ${path} → ${res.status}: ${msg}`);
    }

    return data;
  }

  /** Get replicant's own profile. */
  async getMe(): Promise<Record<string, unknown>> {
    return this.request('GET', '/api/replicants/me') as Promise<Record<string, unknown>>;
  }

  /** Get replicant's ships. */
  async getShips(): Promise<unknown[]> {
    return this.request('GET', '/api/replicants/me/ships') as Promise<unknown[]>;
  }

  /** Get recent messages. */
  async getMessages(limit = 10): Promise<unknown[]> {
    return this.request('GET', `/api/replicants/me/messages?limit=${limit}`) as Promise<unknown[]>;
  }

  /** Get recent action history. */
  async getActions(limit = 10): Promise<unknown[]> {
    return this.request('GET', `/api/replicants/me/actions?limit=${limit}`) as Promise<unknown[]>;
  }

  /** Get available tool definitions. */
  async getToolDefinitions(): Promise<Array<{ name: string; description: string; parameters: Record<string, unknown> }>> {
    const data = await this.request('GET', '/api/tools') as { tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> };
    return data.tools;
  }

  /** Execute a tool by name. */
  async executeTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    const data = await this.request('POST', `/api/tools/${toolName}`, params) as { result: unknown };
    return data.result;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/worker/GameClient.ts
git commit -m "feat: add GameClient REST wrapper for agent worker"
```

---

### Task 7: Worker — AgentRunner (Agentic Loop)

**Files:**
- Create: `src/worker/AgentRunner.ts`

- [ ] **Step 1: Create AgentRunner**

Create `src/worker/AgentRunner.ts`:

```typescript
import OpenAI from 'openai';
import { AgentSession } from '../db/models/index.js';
import { GameClient } from './GameClient.js';
import { decrypt } from '../shared/crypto.js';
import { config } from '../config.js';
import type { IAgentConfig } from '../db/models/AgentConfig.js';
import type { IReplicant } from '../db/models/Replicant.js';

/**
 * Runs a single think cycle for a managed agent.
 * Builds context via REST, calls the user's LLM with tool definitions,
 * executes tool calls, and loops until done or budget exhausted.
 */
export class AgentRunner {
  private agentConfig: IAgentConfig;
  private replicant: IReplicant;
  private client: GameClient;
  private tick: number;

  constructor(agentConfig: IAgentConfig, replicant: IReplicant, tick: number) {
    this.agentConfig = agentConfig;
    this.replicant = replicant;
    this.tick = tick;
    this.client = new GameClient(replicant.apiKey);
  }

  async run(): Promise<void> {
    const startTime = Date.now();
    let tokensUsed = 0;
    let toolCallCount = 0;
    let error: string | null = null;

    try {
      // Decrypt API key
      const apiKey = decrypt(this.agentConfig.provider.apiKey, config.agent.encryptionKey);

      // Create OpenAI client with user's provider
      const llm = new OpenAI({
        baseURL: this.agentConfig.provider.baseUrl,
        apiKey,
      });

      // Build context
      const context = await this.buildContext();
      const systemPrompt = this.agentConfig.systemPromptOverride || this.buildSystemPrompt();

      // Get tool definitions
      const toolDefs = await this.client.getToolDefinitions();
      const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = toolDefs.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));

      // Agentic loop
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

        // Track tokens
        if (response.usage) {
          tokensUsed += response.usage.prompt_tokens + response.usage.completion_tokens;
        }

        const choice = response.choices[0];
        if (!choice) break;

        messages.push(choice.message);

        // If no tool calls, we're done
        if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
          break;
        }

        // Execute tool calls
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

    // Update session
    const durationMs = Date.now() - startTime;
    await this.updateSession(tokensUsed, toolCallCount, durationMs, error);
  }

  private async buildContext(): Promise<string> {
    const parts: string[] = [];

    try {
      const me = await this.client.getMe();
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

    const cycleEntry = {
      tick: this.tick,
      tokensUsed,
      toolCalls,
      durationMs,
      error,
    };

    // Ring buffer: keep last 50 cycles
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
```

- [ ] **Step 2: Commit**

```bash
git add src/worker/AgentRunner.ts
git commit -m "feat: add AgentRunner — agentic loop with token budget tracking"
```

---

### Task 8: Worker — WorkerLoop (Redis subscriber + scheduler)

**Files:**
- Create: `src/worker/WorkerLoop.ts`

- [ ] **Step 1: Create WorkerLoop**

Create `src/worker/WorkerLoop.ts`:

```typescript
import Redis from 'ioredis';
import { nanoid } from 'nanoid';
import { AgentConfig, AgentSession, Replicant } from '../db/models/index.js';
import { AgentRunner } from './AgentRunner.js';
import { config } from '../config.js';

const LOCK_TTL_SECONDS = 120;

export class WorkerLoop {
  private subscriber: Redis;
  private locker: Redis;
  private workerId: string;
  private running = false;

  constructor() {
    this.subscriber = new Redis(config.redis.url);
    this.locker = new Redis(config.redis.url);
    this.workerId = `worker-${nanoid(8)}`;
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[Worker ${this.workerId}] Starting, subscribing to tick:complete`);

    this.subscriber.on('message', (_channel: string, message: string) => {
      try {
        const { tick } = JSON.parse(message) as { tick: number };
        void this.onTickComplete(tick);
      } catch (err) {
        console.error('[Worker] Failed to parse tick event:', err);
      }
    });

    await this.subscriber.subscribe('tick:complete');
    console.log(`[Worker ${this.workerId}] Listening for tick events`);
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.subscriber.unsubscribe('tick:complete');
    this.subscriber.disconnect();
    this.locker.disconnect();
    console.log(`[Worker ${this.workerId}] Stopped`);
  }

  private async onTickComplete(tick: number): Promise<void> {
    if (!this.running) return;

    // Find all enabled agents due to think this tick
    const dueConfigs = await AgentConfig.find({ enabled: true }).lean();
    const dueThisTick = dueConfigs.filter(c => tick % c.thinkEveryNTicks === 0);

    if (dueThisTick.length === 0) return;

    console.log(`[Worker ${this.workerId}] Tick ${tick}: ${dueThisTick.length} agent(s) due`);

    // Process agents concurrently (with lock protection)
    const promises = dueThisTick.map(agentConfig => this.runAgent(agentConfig, tick));
    await Promise.allSettled(promises);
  }

  private async runAgent(agentConfig: typeof AgentConfig.prototype, tick: number): Promise<void> {
    const replicantId = agentConfig.replicantId.toString();
    const lockKey = `agent:lock:${replicantId}`;

    // Try to acquire lock
    const acquired = await this.locker.set(lockKey, this.workerId, 'NX', 'EX', LOCK_TTL_SECONDS);
    if (!acquired) {
      return; // Another worker is handling this agent
    }

    try {
      // Check session status — don't run paused/stopped agents
      let session = await AgentSession.findOne({ replicantId: agentConfig.replicantId });
      if (!session) {
        session = await AgentSession.create({ replicantId: agentConfig.replicantId, status: 'running' });
      }

      if (session.status === 'paused' || session.status === 'stopped') {
        return;
      }

      // Load replicant
      const replicant = await Replicant.findById(agentConfig.replicantId);
      if (!replicant || replicant.status !== 'active') {
        return;
      }

      // Run the agentic loop
      const runner = new AgentRunner(agentConfig as unknown as import('../db/models/AgentConfig.js').IAgentConfig, replicant, tick);
      await runner.run();
    } catch (err) {
      console.error(`[Worker] Agent ${replicantId} error:`, err);
    } finally {
      // Release lock
      await this.locker.del(lockKey).catch(() => {});
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/worker/WorkerLoop.ts
git commit -m "feat: add WorkerLoop — Redis subscriber and agent scheduler"
```

---

### Task 9: Worker Entry Point

**Files:**
- Create: `src/worker/index.ts`

- [ ] **Step 1: Create worker entry point**

Create `src/worker/index.ts`:

```typescript
import mongoose from 'mongoose';
import { config } from '../config.js';
import { WorkerLoop } from './WorkerLoop.js';

async function main(): Promise<void> {
  console.log('[Agent Worker] Starting...');

  // Connect to MongoDB (for AgentConfig and AgentSession)
  await mongoose.connect(config.mongodb.uri);
  console.log('[Agent Worker] MongoDB connected');

  // Validate encryption key
  if (!config.agent.encryptionKey || config.agent.encryptionKey.length !== 64) {
    console.warn('[Agent Worker] WARNING: AGENT_ENCRYPTION_KEY not set or invalid. Agent API keys cannot be decrypted.');
  }

  // Start the worker loop
  const worker = new WorkerLoop();
  await worker.start();

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[Agent Worker] Shutting down...');
    await worker.stop();
    await mongoose.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch(err => {
  console.error('[Agent Worker] Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/worker/index.ts
git commit -m "feat: add agent worker entry point"
```

---

### Task 10: Docker & Infrastructure

**Files:**
- Modify: `docker-compose.yml`
- Modify: `Dockerfile`

- [ ] **Step 1: Add Redis and agent-worker to docker-compose**

Replace `docker-compose.yml` content:

```yaml
services:
  mongodb:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db
    environment:
      MONGO_INITDB_DATABASE: homosideria
    command: mongod --setParameter diagnosticDataCollectionEnabled=false --quiet

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

  homosideria:
    build: .
    ports:
      - "3001:3001"
    depends_on:
      - mongodb
      - redis
    environment:
      MONGODB_URI: mongodb://mongodb:27017/homosideria
      PORT: "3001"
      ADMIN_KEY: ${ADMIN_KEY:-dev-admin-key}
      JWT_SECRET: ${JWT_SECRET:-dev-jwt-secret}
      TICK_INTERVAL_MS: ${TICK_INTERVAL_MS:-30000}
      LLM_BASE_URL: ${LLM_BASE_URL:-https://openrouter.ai/api/v1}
      LLM_API_KEY: ${LLM_API_KEY:-}
      LLM_MODEL: ${LLM_MODEL:-anthropic/claude-sonnet-4}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      REDIS_URL: redis://redis:6379
      AGENT_ENCRYPTION_KEY: ${AGENT_ENCRYPTION_KEY:-0000000000000000000000000000000000000000000000000000000000000000}
    restart: unless-stopped

  agent-worker:
    build: .
    command: ["node", "dist/worker/index.js"]
    depends_on:
      - mongodb
      - redis
      - homosideria
    environment:
      MONGODB_URI: mongodb://mongodb:27017/homosideria
      REDIS_URL: redis://redis:6379
      GAME_API_URL: http://homosideria:3001
      AGENT_ENCRYPTION_KEY: ${AGENT_ENCRYPTION_KEY:-0000000000000000000000000000000000000000000000000000000000000000}
    restart: unless-stopped

volumes:
  mongo-data:
  redis-data:
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add Redis and agent-worker to docker-compose"
```

---

### Task 11: Web UI — Agent Config Routes

**Files:**
- Modify: `src/web/routes/pages.routes.ts`

- [ ] **Step 1: Add agent web routes**

Add imports at the top of `src/web/routes/pages.routes.ts`:

```typescript
import { AgentConfig, AgentSession } from '../../db/models/index.js';
import { encrypt } from '../../shared/crypto.js';
import { config } from '../../config.js';
```

Add the following routes (place before the last export or at the end of the routes):

```typescript
// ── Agent List ──────────────────────────────────────────────────────
pagesRoutes.get('/agents', requireAuth, requireRole('owner', 'operator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;
    const replicantFilter = user.role === 'operator' ? {} : { _id: { $in: user.replicantIds || [] } };
    const replicants = await Replicant.find(replicantFilter).lean();
    const replicantIds = replicants.map(r => r._id);

    const configs = await AgentConfig.find({ replicantId: { $in: replicantIds } }).lean();
    const sessions = await AgentSession.find({ replicantId: { $in: replicantIds } }).lean();

    const configMap = new Map(configs.map(c => [c.replicantId.toString(), c]));
    const sessionMap = new Map(sessions.map(s => [s.replicantId.toString(), s]));

    const agents = replicants.map(r => ({
      replicant: r,
      config: configMap.get(r._id.toString()) || null,
      session: sessionMap.get(r._id.toString()) || null,
    }));

    res.render('agents', { title: 'Agents', user, currentPath: '/agents', flash: {}, agents });
  } catch (err) { next(err); }
});

// ── Agent Config Page ───────────────────────────────────────────────
pagesRoutes.get('/agent/:replicantId', requireAuth, requireRole('owner', 'operator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;
    const replicant = await Replicant.findById(req.params.replicantId).lean();
    if (!replicant) { res.status(404).send('Replicant not found'); return; }

    if (user.role !== 'operator' && !(user.replicantIds || []).some((id: { toString(): string }) => id.toString() === replicant._id.toString())) {
      res.status(403).send('Access denied'); return;
    }

    const agentConfig = await AgentConfig.findOne({ replicantId: replicant._id }).lean();
    const session = await AgentSession.findOne({ replicantId: replicant._id }).lean();

    res.render('agent', {
      title: `Agent: ${replicant.identity?.chosenName || replicant.name}`,
      user, currentPath: '/agents', flash: {},
      replicant, agentConfig, session,
    });
  } catch (err) { next(err); }
});

// ── Save Agent Config ───────────────────────────────────────────────
pagesRoutes.post('/agent/:replicantId/config', requireAuth, requireRole('owner', 'operator'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = res.locals.user;
    const replicant = await Replicant.findById(req.params.replicantId);
    if (!replicant) { res.status(404).send('Replicant not found'); return; }

    if (user.role !== 'operator' && !(user.replicantIds || []).some((id: { toString(): string }) => id.toString() === replicant._id.toString())) {
      res.status(403).send('Access denied'); return;
    }

    const { baseUrl, apiKey, model, temperature, topP, maxTokens, thinkEveryNTicks, tokenBudgetPerCycle, systemPromptOverride } = req.body;

    let agentConfig = await AgentConfig.findOne({ replicantId: replicant._id });
    if (!agentConfig) {
      agentConfig = new AgentConfig({ userId: user._id, replicantId: replicant._id });
    }

    if (baseUrl) agentConfig.provider.baseUrl = baseUrl;
    if (apiKey && apiKey !== '••••••••') {
      agentConfig.provider.apiKey = encrypt(apiKey, config.agent.encryptionKey);
    }
    if (model) agentConfig.provider.model = model;
    if (temperature !== undefined) agentConfig.sampling.temperature = parseFloat(temperature);
    if (topP !== undefined) agentConfig.sampling.topP = parseFloat(topP);
    if (maxTokens !== undefined) agentConfig.sampling.maxTokens = parseInt(maxTokens, 10);
    if (thinkEveryNTicks !== undefined) agentConfig.thinkEveryNTicks = parseInt(thinkEveryNTicks, 10);
    if (tokenBudgetPerCycle !== undefined) agentConfig.tokenBudgetPerCycle = parseInt(tokenBudgetPerCycle, 10);
    agentConfig.systemPromptOverride = systemPromptOverride?.trim() || null;

    agentConfig.markModified('provider');
    agentConfig.markModified('sampling');
    await agentConfig.save();

    res.redirect(`/agent/${req.params.replicantId}`);
  } catch (err) { next(err); }
});

// ── Start/Pause/Stop Agent ──────────────────────────────────────────
for (const action of ['start', 'pause', 'stop'] as const) {
  pagesRoutes.post(`/agent/:replicantId/${action}`, requireAuth, requireRole('owner', 'operator'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = res.locals.user;
      const replicant = await Replicant.findById(req.params.replicantId);
      if (!replicant) { res.status(404).send('Replicant not found'); return; }

      if (user.role !== 'operator' && !(user.replicantIds || []).some((id: { toString(): string }) => id.toString() === replicant._id.toString())) {
        res.status(403).send('Access denied'); return;
      }

      const agentConfig = await AgentConfig.findOne({ replicantId: replicant._id });
      if (!agentConfig) { res.redirect(`/agent/${req.params.replicantId}`); return; }

      let session = await AgentSession.findOne({ replicantId: replicant._id });
      if (!session) {
        session = new AgentSession({ replicantId: replicant._id });
      }

      if (action === 'start') {
        agentConfig.enabled = true;
        session.status = 'running';
        session.consecutiveErrors = 0;
        session.lastError = null;
      } else if (action === 'pause') {
        session.status = 'paused';
      } else {
        agentConfig.enabled = false;
        session.status = 'stopped';
      }

      await agentConfig.save();
      await session.save();

      res.redirect(`/agent/${req.params.replicantId}`);
    } catch (err) { next(err); }
  });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/web/routes/pages.routes.ts
git commit -m "feat: add agent config web routes"
```

---

### Task 12: Web UI — Agent List Page Template

**Files:**
- Create: `src/web/views/agents.ejs`
- Modify: `src/web/views/partials/nav.ejs`

- [ ] **Step 1: Create agents list template**

Create `src/web/views/agents.ejs`:

```ejs
<!DOCTYPE html>
<html lang="en">
<head>
  <%- include('partials/_head') %>
</head>
<body>
  <div class="app">
    <%- include('partials/nav', { user, currentPath }) %>
    <div style="flex:1; margin-left:var(--sidebar-width);">
      <%- include('partials/header', { user }) %>
      <main class="main">
        <%- include('partials/flash', { flash }) %>

        <h1 class="page-title">Agent Management</h1>
        <p class="text-dim" style="margin-bottom:24px;">Configure AI agents to autonomously control your replicants. Agents use your LLM API key and think on a configurable schedule.</p>

        <% if (agents.length === 0) { %>
          <div class="card"><p class="text-dim">No replicants found. Create a replicant first.</p></div>
        <% } else { %>
          <div class="grid-3">
            <% for (const a of agents) { %>
              <div class="card" style="cursor:pointer;" onclick="location.href='/agent/<%= a.replicant._id %>'">
                <div class="flex justify-between items-center mb-2">
                  <div class="card-title" style="margin-bottom:0;"><%= a.replicant.identity?.chosenName || a.replicant.name %></div>
                  <% if (a.session) { %>
                    <span class="badge badge-<%= a.session.status === 'running' ? 'owner' : a.session.status === 'paused' ? 'spectator' : a.session.status === 'error' ? 'operator' : 'spectator' %>"><%= a.session.status %></span>
                  <% } else if (a.config) { %>
                    <span class="badge badge-spectator">configured</span>
                  <% } else { %>
                    <span class="badge badge-spectator">not configured</span>
                  <% } %>
                </div>

                <% if (a.config) { %>
                  <table>
                    <tr><td class="label" style="width:100px;">Model</td><td class="mono" style="font-size:12px;"><%= a.config.provider.model %></td></tr>
                    <tr><td class="label">Think Every</td><td class="mono"><%= a.config.thinkEveryNTicks %> ticks</td></tr>
                    <tr><td class="label">Token Budget</td><td class="mono"><%= a.config.tokenBudgetPerCycle.toLocaleString() %></td></tr>
                  </table>
                <% } %>

                <% if (a.session) { %>
                  <table style="margin-top:8px;">
                    <tr><td class="label" style="width:100px;">Total Cycles</td><td class="mono"><%= a.session.totalCycles %></td></tr>
                    <tr><td class="label">Tokens Used</td><td class="mono"><%= a.session.totalTokensUsed.toLocaleString() %></td></tr>
                    <tr><td class="label">Last Cycle</td><td class="mono">Tick <%= a.session.lastCycleTick %></td></tr>
                    <% if (a.session.lastError) { %>
                      <tr><td class="label">Error</td><td class="text-dim" style="font-size:12px;color:var(--danger);"><%= a.session.lastError.slice(0, 80) %></td></tr>
                    <% } %>
                  </table>
                <% } %>

                <div class="mt-2">
                  <a href="/agent/<%= a.replicant._id %>" class="btn btn-outline btn-sm" onclick="event.stopPropagation()">Configure</a>
                </div>
              </div>
            <% } %>
          </div>
        <% } %>
      </main>
    </div>
  </div>
</body>
</html>
```

- [ ] **Step 2: Add Agents link to nav**

In `src/web/views/partials/nav.ejs`, find the Fleet section and add after the "API Keys" link:

```ejs
    <a href="/agents" class="sidebar-link<%= currentPath === '/agents' ? ' active' : '' %>">Agents</a>
```

- [ ] **Step 3: Commit**

```bash
git add src/web/views/agents.ejs src/web/views/partials/nav.ejs
git commit -m "feat: add agent list page and nav link"
```

---

### Task 13: Web UI — Agent Config Page Template

**Files:**
- Create: `src/web/views/agent.ejs`

- [ ] **Step 1: Create agent config template**

Create `src/web/views/agent.ejs`:

```ejs
<!DOCTYPE html>
<html lang="en">
<head>
  <%- include('partials/_head') %>
</head>
<body>
  <div class="app">
    <%- include('partials/nav', { user, currentPath }) %>
    <div style="flex:1; margin-left:var(--sidebar-width);">
      <%- include('partials/header', { user }) %>
      <main class="main">
        <%- include('partials/flash', { flash }) %>

        <div class="flex justify-between items-center mb-3">
          <h1 class="page-title" style="margin-bottom:0;">Agent: <%= replicant.identity?.chosenName || replicant.name %></h1>
          <div class="flex gap-1">
            <% if (session && session.status === 'running') { %>
              <form method="POST" action="/agent/<%= replicant._id %>/pause" style="display:inline;"><button class="btn btn-outline btn-sm">Pause</button></form>
              <form method="POST" action="/agent/<%= replicant._id %>/stop" style="display:inline;"><button class="btn btn-outline btn-sm">Stop</button></form>
            <% } else if (session && session.status === 'paused') { %>
              <form method="POST" action="/agent/<%= replicant._id %>/start" style="display:inline;"><button class="btn btn-accent btn-sm">Resume</button></form>
              <form method="POST" action="/agent/<%= replicant._id %>/stop" style="display:inline;"><button class="btn btn-outline btn-sm">Stop</button></form>
            <% } else { %>
              <form method="POST" action="/agent/<%= replicant._id %>/start" style="display:inline;"><button class="btn btn-accent btn-sm">Start Agent</button></form>
            <% } %>
          </div>
        </div>

        <% if (session && session.lastError) { %>
          <div class="card mb-3" style="border-color:var(--danger);">
            <div class="card-title" style="color:var(--danger);">Last Error</div>
            <pre class="mono" style="font-size:12px;white-space:pre-wrap;"><%= session.lastError %></pre>
          </div>
        <% } %>

        <form method="POST" action="/agent/<%= replicant._id %>/config">
          <div class="grid-2 mb-3">
            <!-- Provider -->
            <div class="card">
              <div class="card-title">LLM Provider</div>
              <div class="form-group">
                <label class="form-label">Base URL</label>
                <input type="text" name="baseUrl" class="form-input" value="<%= agentConfig?.provider?.baseUrl || 'https://openrouter.ai/api/v1' %>" placeholder="https://openrouter.ai/api/v1">
              </div>
              <div class="form-group">
                <label class="form-label">API Key</label>
                <input type="password" name="apiKey" class="form-input" value="<%= agentConfig?.provider?.apiKey ? '••••••••' : '' %>" placeholder="sk-...">
                <div class="text-muted" style="font-size:11px;margin-top:4px;"><%= agentConfig?.provider?.apiKey ? 'Key configured. Enter a new value to replace.' : 'Not configured.' %></div>
              </div>
              <div class="form-group">
                <label class="form-label">Model</label>
                <input type="text" name="model" class="form-input" value="<%= agentConfig?.provider?.model || 'anthropic/claude-sonnet-4' %>" placeholder="anthropic/claude-sonnet-4">
              </div>
            </div>

            <!-- Sampling -->
            <div class="card">
              <div class="card-title">Sampling</div>
              <div class="form-group">
                <label class="form-label">Temperature (0.0 - 2.0)</label>
                <input type="number" name="temperature" class="form-input" value="<%= agentConfig?.sampling?.temperature ?? 0.7 %>" min="0" max="2" step="0.1">
              </div>
              <div class="form-group">
                <label class="form-label">Top P (0.0 - 1.0)</label>
                <input type="number" name="topP" class="form-input" value="<%= agentConfig?.sampling?.topP ?? 1.0 %>" min="0" max="1" step="0.1">
              </div>
              <div class="form-group">
                <label class="form-label">Max Output Tokens</label>
                <input type="number" name="maxTokens" class="form-input" value="<%= agentConfig?.sampling?.maxTokens ?? 4096 %>" min="256" max="32768">
              </div>
            </div>
          </div>

          <div class="grid-2 mb-3">
            <!-- Scheduling -->
            <div class="card">
              <div class="card-title">Scheduling</div>
              <div class="form-group">
                <label class="form-label">Think Every N Ticks</label>
                <input type="number" name="thinkEveryNTicks" class="form-input" value="<%= agentConfig?.thinkEveryNTicks ?? 5 %>" min="1" max="100" id="think-interval">
                <div class="text-muted" style="font-size:11px;margin-top:4px;" id="think-desc">Every ~25 seconds / ~4 game hours</div>
              </div>
              <div class="form-group">
                <label class="form-label">Token Budget Per Cycle</label>
                <input type="number" name="tokenBudgetPerCycle" class="form-input" value="<%= agentConfig?.tokenBudgetPerCycle ?? 50000 %>" min="1000" max="200000" step="1000">
              </div>
            </div>

            <!-- System Prompt -->
            <div class="card">
              <div class="card-title">System Prompt Override</div>
              <div class="form-group">
                <textarea name="systemPromptOverride" class="form-input" style="min-height:140px;" placeholder="Leave blank to use the default agent prompt. Context (identity, ships, messages) is always injected as the user message."><%= agentConfig?.systemPromptOverride || '' %></textarea>
              </div>
            </div>
          </div>

          <button type="submit" class="btn btn-accent">Save Configuration</button>
        </form>

        <% if (session && session.cycleHistory && session.cycleHistory.length > 0) { %>
        <div class="card mt-3">
          <div class="card-title">Cycle History (last <%= session.cycleHistory.length %>)</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Tick</th><th>Tokens</th><th>Tool Calls</th><th>Duration</th><th>Status</th></tr></thead>
              <tbody>
                <% for (const c of [...session.cycleHistory].reverse().slice(0, 20)) { %>
                  <tr>
                    <td class="mono"><%= c.tick %></td>
                    <td class="mono"><%= c.tokensUsed.toLocaleString() %></td>
                    <td class="mono"><%= c.toolCalls %></td>
                    <td class="mono"><%= (c.durationMs / 1000).toFixed(1) %>s</td>
                    <td><%= c.error ? '❌ ' + c.error.slice(0, 50) : '✓' %></td>
                  </tr>
                <% } %>
              </tbody>
            </table>
          </div>

          <div style="margin-top:12px;">
            <table>
              <tr><td class="label" style="width:120px;">Total Cycles</td><td class="mono"><%= session.totalCycles %></td></tr>
              <tr><td class="label">Total Tokens</td><td class="mono"><%= session.totalTokensUsed.toLocaleString() %></td></tr>
              <tr><td class="label">Total Tool Calls</td><td class="mono"><%= session.totalToolCalls.toLocaleString() %></td></tr>
            </table>
          </div>
        </div>
        <% } %>

      </main>
    </div>
  </div>

  <script>
  (function() {
    var input = document.getElementById('think-interval');
    var desc = document.getElementById('think-desc');
    function update() {
      var n = parseInt(input.value) || 5;
      var realSec = n * 5;
      var gameMins = n * 50;
      desc.textContent = 'Every ~' + realSec + ' seconds / ~' + (gameMins >= 60 ? (gameMins / 60).toFixed(1) + ' game hours' : gameMins + ' game minutes');
    }
    input.addEventListener('input', update);
    update();
  })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add src/web/views/agent.ejs
git commit -m "feat: add agent config page template"
```

---

### Task 14: Integration Test + Final Verification

**Files:**
- Modify: `test/integration.test.ts` (or new test file)

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All existing tests pass (the new crypto tests from Task 2 also pass).

- [ ] **Step 2: Type-check the entire project**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Verify Docker build compiles**

```bash
npm run build
```

Expected: TypeScript compiles successfully to `dist/`.

- [ ] **Step 4: Update CLAUDE.md**

Add to the Architecture section in `/workspace/CLAUDE.md`:

Under "### Three-layer design", add a new item:

```
5. **Agent Worker** (`src/worker/`) — Separate process that runs managed AI agents. Subscribes to Redis `tick:complete` events, runs agentic loops for configured replicants using their LLM credentials. Communicates with game server via REST API only. Config in `AgentConfig` model, runtime state in `AgentSession` model.
```

Under "### Configuration", add:

```
Agent worker: `REDIS_URL`, `AGENT_ENCRYPTION_KEY` (64-char hex for AES-256-GCM), `GAME_API_URL`.
```

Under "### Key invariants", add:

```
- **Agent isolation** — Worker authenticates as the replicant via REST API. Same permissions as any external client.
- **Token budget** — Agents have a configurable token budget per think cycle (default 50K, max 200K). Loop stops when budget exhausted.
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete managed agent runtime — worker, UI, docs"
```

---

## Verification Checklist

1. `npx tsc --noEmit` — 0 errors
2. `npm test` — all tests pass (including crypto + tools API)
3. `GET /api/tools` — returns 60+ tool definitions
4. `POST /api/tools/get_game_state` with API key — returns game state
5. Web UI `/agents` — shows replicant cards with configure buttons
6. Web UI `/agent/:id` — shows config form, save works
7. Start/pause/stop buttons update AgentSession status
8. `npm run worker` — starts, connects to Redis, logs "Listening for tick events"
9. Docker: `docker compose up --build` — all 4 services start (mongo, redis, homosideria, agent-worker)
10. Agent cycle: configure agent with LLM key, start it, force a tick, see cycle in history
