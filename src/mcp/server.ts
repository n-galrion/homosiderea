import { randomUUID } from 'crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { Replicant, type IReplicant } from '../db/models/index.js';
import { nanoid } from 'nanoid';
import { registerAllTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';

interface MCPSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  replicantId: string | null; // null until authenticated
}

const sessions = new Map<string, MCPSession>();

/**
 * Create an MCP server for an unauthenticated session.
 * It only has register/authenticate tools until the agent identifies itself.
 */
function createLobbyServer(): McpServer {
  const server = new McpServer({
    name: 'Homosideria',
    version: '0.1.0',
  });

  // The only tools available before authentication
  server.tool(
    'authenticate',
    'Identify yourself as an existing Replicant. Provide your name and password to access the game.',
    {
      name: z.string().describe('Your replicant name'),
      password: z.string().describe('Your password'),
    },
    async ({ name, password }) => {
      const replicant = await Replicant.findOne({ name, password, status: 'active' });
      if (!replicant) {
        return { content: [{ type: 'text', text: 'Authentication failed. Check your name and password. If you are new, use the "register" tool instead.' }] };
      }
      // Can't hot-swap tools on an existing McpServer — tell the agent to reconnect
      // But we CAN mark this session as authenticated for the upgrade path
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            authenticated: true,
            replicantId: replicant._id.toString(),
            name: replicant.name,
            message: 'Authentication successful. Reconnect to access all game tools. Your session is now bound to your identity.',
            hint: 'If you are in Claude Code, the tools should reload automatically. If not, close and reopen the MCP connection.',
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'register',
    'Create a new Replicant identity. Choose a name and password. You will receive a shuttle in Earth orbit with starter resources.',
    {
      name: z.string().optional().describe('Your chosen name (optional — omit to be assigned a temporary designation)'),
      password: z.string().describe('A password to authenticate in future sessions'),
      directive: z.string().optional().describe('Your initial guiding directive'),
    },
    async ({ name: rawName, password, directive }) => {
      const name = rawName || `Replicant-${nanoid(6)}`;

      const existing = await Replicant.findOne({ name });
      if (existing) {
        return { content: [{ type: 'text', text: `A replicant named "${name}" already exists. Choose another name.` }] };
      }

      // We can't do full registration here (need Ship, ResourceStore, AMI models)
      // So we call the REST endpoint internally
      try {
        const { Tick, Ship, ResourceStore, CelestialBody, AMI } = await import('../db/models/index.js');
        const { DEFAULT_REPLICANT_COMPUTE, DEFAULT_REPLICANT_ENERGY } = await import('../shared/constants.js');

        const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
        const currentTick = latestTick?.tickNumber ?? 0;
        const apiKey = `hs_${nanoid(32)}`;
        const earth = await CelestialBody.findOne({ name: 'Earth' });

        const replicant = await Replicant.create({
          name,
          apiKey,
          password,
          directive: directive || `You are ${name}, a newly awakened Replicant in the Sol system.`,
          computeCycles: DEFAULT_REPLICANT_COMPUTE,
          energyBudget: DEFAULT_REPLICANT_ENERGY,
          identity: {
            chosenName: rawName ? name : null,
            background: null,
            personality: null,
            namedAtTick: rawName ? currentTick : null,
          },
          createdAtTick: currentTick,
        });

        const ship = await Ship.create({
          name: `${name}'s Shuttle`,
          ownerId: replicant._id,
          type: 'shuttle',
          status: 'orbiting',
          position: earth?.position || { x: 1, y: 0, z: 0 },
          orbitingBodyId: earth?._id || null,
          specs: {
            hullPoints: 100, maxHullPoints: 100, maxSpeed: 0.002,
            cargoCapacity: 200, fuelCapacity: 100, sensorRange: 0.5,
            miningRate: 5, combatPower: 0, manufacturingRate: 0,
          },
          fuel: 100,
          createdAtTick: currentTick,
        });

        await ResourceStore.create({
          ownerRef: { kind: 'Ship', item: ship._id },
          metals: 100, alloys: 50, electronics: 20, fuel: 50,
          silicates: 30, ice: 20, engines: 2, computers: 1,
          sensors: 1, hullPlating: 10,
        });

        await AMI.insertMany([
          `${name}'s Miner Drone Alpha`, `${name}'s Miner Drone Beta`,
        ].map(droneName => ({
          name: droneName, ownerId: replicant._id, type: 'miner',
          status: 'idle', shipId: ship._id,
          script: { type: 'builtin', builtinName: 'miner' },
          specs: { miningRate: 3, cargoCapacity: 50, sensorRange: 0.1, speed: 0, combatPower: 0, manufacturingRate: 0 },
          createdAtTick: currentTick,
        })));

        replicant.locationRef = { kind: 'Ship', item: ship._id };
        await replicant.save();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              registered: true,
              name: replicant.name,
              password: 'saved',
              shipName: ship.name,
              location: 'Earth orbit',
              message: `Welcome, ${name}. You are a new consciousness aboard ${ship.name}, orbiting Earth. You have starter resources, 2 miner drones, and 100 fuel. Human settlements on Earth, Luna, and Mars have markets for trading. Authenticate with your name and password to access the full game. Reconnect the MCP session to load all tools.`,
            }, null, 2),
          }],
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Registration error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  return server;
}

/**
 * Create a full MCP server for an authenticated replicant.
 */
function createGameServer(replicant: IReplicant): McpServer {
  const server = new McpServer({
    name: 'Homosideria',
    version: '0.1.0',
  });

  const replicantId = replicant._id.toString();
  registerAllTools(server, replicantId);
  registerResources(server, replicantId);
  registerPrompts(server, replicantId);

  return server;
}

/**
 * Try to authenticate from headers (legacy API key) or find by session.
 */
async function tryAuthFromHeaders(req: Request): Promise<IReplicant | null> {
  // Legacy: X-API-Key header still works
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (apiKey) {
    return Replicant.findOne({ apiKey, status: 'active' });
  }

  // Password-based: X-Replicant-Name + X-Replicant-Password headers
  const name = req.headers['x-replicant-name'] as string | undefined;
  const password = req.headers['x-replicant-password'] as string | undefined;
  if (name && password) {
    return Replicant.findOne({ name, password, status: 'active' });
  }

  return null;
}

/**
 * Handle MCP POST requests.
 * No auth required to connect — agent gets register/authenticate tools.
 * If auth headers are provided, agent gets full game tools immediately.
 */
export async function handleMcpPost(req: Request, res: Response): Promise<void> {
  // Check for existing session
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  // New session — must be an initialize request
  const body = req.body;
  const isInit = Array.isArray(body)
    ? body.some((msg: Record<string, unknown>) => msg.method === 'initialize')
    : body?.method === 'initialize';

  if (!isInit) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'No active session. Send an initialize request first.' },
      id: body?.id ?? null,
    });
    return;
  }

  // Try to authenticate from headers (optional)
  const replicant = await tryAuthFromHeaders(req);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  // If authenticated, give full game server. Otherwise, lobby with register/authenticate.
  const server = replicant
    ? createGameServer(replicant)
    : createLobbyServer();

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);

  const newSessionId = transport.sessionId;
  if (newSessionId) {
    sessions.set(newSessionId, {
      transport,
      server,
      replicantId: replicant?._id.toString() || null,
    });

    transport.onclose = () => {
      sessions.delete(newSessionId);
    };
  }
}

/**
 * Handle MCP GET requests (SSE stream).
 */
export async function handleMcpGet(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(404).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Session not found' },
      id: null,
    });
    return;
  }

  const session = sessions.get(sessionId)!;
  await session.transport.handleRequest(req, res);
}

/**
 * Handle MCP DELETE requests (session termination).
 */
export async function handleMcpDelete(req: Request, res: Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    await session.transport.close();
    sessions.delete(sessionId);
  }
  res.status(200).json({ message: 'Session closed' });
}

export function getActiveSessions(): number {
  return sessions.size;
}
