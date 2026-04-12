import { randomUUID } from 'crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
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

  // Authenticate from headers (required)
  const replicant = await tryAuthFromHeaders(req);

  if (!replicant) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Authentication required. Add X-Replicant-Name + X-Replicant-Password headers (or X-API-Key). Register first via POST /api/auth/register with {"name":"YourName","password":"YourPassword"}',
      },
      id: null,
    });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  const server = createGameServer(replicant);

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

// ── Legacy SSE Transport ──────────────────────────────
// For Claude Code and other clients that don't support Streamable HTTP

interface SSESession {
  transport: SSEServerTransport;
  server: McpServer;
  replicantId: string | null;
}

const sseSessions = new Map<string, SSESession>();

/**
 * Handle GET /sse — establishes an SSE connection.
 * Claude Code connects here to receive server-sent events.
 */
export async function handleSSEGet(req: Request, res: Response): Promise<void> {
  const replicant = await tryAuthFromHeaders(req);

  if (!replicant) {
    res.status(401).json({
      error: 'Authentication required',
      message: 'Add headers to your MCP config: X-Replicant-Name and X-Replicant-Password. Register first via: curl -X POST http://localhost:3001/api/auth/register -H "Content-Type: application/json" -d \'{"name":"YourName","password":"YourPassword"}\'',
    });
    return;
  }

  const server = createGameServer(replicant);

  const transport = new SSEServerTransport('/sse/message', res);
  const sessionId = transport.sessionId;

  sseSessions.set(sessionId, {
    transport,
    server,
    replicantId: replicant?._id.toString() || null,
  });

  transport.onclose = () => {
    sseSessions.delete(sessionId);
  };

  await server.connect(transport);
}

/**
 * Handle POST /sse/message — receives JSON-RPC messages from the client.
 */
export async function handleSSEPost(req: Request, res: Response): Promise<void> {
  const sessionId = req.query.sessionId as string | undefined;
  if (!sessionId || !sseSessions.has(sessionId)) {
    res.status(404).json({ error: 'SSE session not found' });
    return;
  }

  const session = sseSessions.get(sessionId)!;
  await session.transport.handlePostMessage(req, res);
}
