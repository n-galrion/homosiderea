import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import type { Express } from 'express';
import { createApp } from '../src/api/server.js';
import { handleMcpPost, handleMcpGet, handleMcpDelete } from '../src/mcp/server.js';
import { GameLoop } from '../src/engine/GameLoop.js';
import { setGameLoopRef } from '../src/api/routes/admin.routes.js';
import { seedSolSystem } from '../src/db/seeds/solSystem.js';
import { seedBlueprints } from '../src/db/seeds/blueprints.js';
import { seedLandingSites } from '../src/db/seeds/landingSites.js';
import { seedSettlements } from '../src/db/seeds/settlements.js';

let mongod: MongoMemoryServer;
let app: Express;
let server: ReturnType<Express['listen']>;
let gameLoop: GameLoop;

export const TEST_PORT = 3099;
export const BASE_URL = `http://localhost:${TEST_PORT}`;
export const ADMIN_KEY = 'dev-admin-key';

export async function setupTestServer(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  await seedSolSystem();
  await seedLandingSites();
  await seedBlueprints();
  await seedSettlements();

  app = createApp();
  app.post('/mcp', handleMcpPost);
  app.get('/mcp', handleMcpGet);
  app.delete('/mcp', handleMcpDelete);

  gameLoop = new GameLoop();
  setGameLoopRef(gameLoop);
  // Don't auto-start the loop — we'll force ticks manually

  await new Promise<void>((resolve) => {
    server = app.listen(TEST_PORT, resolve);
  });
}

export async function teardownTestServer(): Promise<void> {
  if (server) server.close();
  gameLoop?.stop();
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

export async function forceTick(): Promise<unknown> {
  return gameLoop.forceTick();
}

export async function api(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    apiKey?: string;
    adminKey?: string;
  } = {},
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers['X-API-Key'] = opts.apiKey;
  if (opts.adminKey) headers['X-Admin-Key'] = opts.adminKey;

  const res = await fetch(`${BASE_URL}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const data = await res.json();
  return { status: res.status, data };
}

export async function registerReplicant(name: string): Promise<{ id: string; apiKey: string; shipId: string }> {
  const { data } = await api('/api/auth/register', {
    method: 'POST',
    body: { name },
  });
  const d = data as Record<string, string>;
  return { id: d.id, apiKey: d.apiKey, shipId: d.shipId };
}
