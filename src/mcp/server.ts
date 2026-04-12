import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { Replicant, type IReplicant } from '../db/models/index.js';
import { registerAllTools } from './tools/index.js';
import { registerResources } from './resources/index.js';
import { registerPrompts } from './prompts/index.js';

interface MCPSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  replicantId: string;
}

const sessions = new Map<string, MCPSession>();

function createMcpServerForReplicant(replicant: IReplicant): McpServer {
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

async function authenticateRequest(req: Request): Promise<IReplicant | null> {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (!apiKey) return null;
  return Replicant.findOne({ apiKey, status: 'active' });
}

/**
 * Handle MCP POST requests (JSON-RPC messages).
 */
export async function handleMcpPost(req: Request, res: Response): Promise<void> {
  const replicant = await authenticateRequest(req);
  if (!replicant) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'X-API-Key header required with valid replicant key' },
      id: null,
    });
    return;
  }

  // Check for existing session
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  // New session — must be an initialize request
  const body = req.body;
  if (body?.method !== 'initialize' && !Array.isArray(body)) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'No active session. Send an initialize request first.' },
      id: body?.id ?? null,
    });
    return;
  }

  // For batched requests, check if any is initialize
  const isInit = Array.isArray(body)
    ? body.some((msg: Record<string, unknown>) => msg.method === 'initialize')
    : body?.method === 'initialize';

  if (!isInit) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'No active session. Send an initialize request first.' },
      id: null,
    });
    return;
  }

  // Create transport — it manages its own session ID
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  const server = createMcpServerForReplicant(replicant);

  // Connect server to transport
  await server.connect(transport);

  // Store session once transport has generated its ID (after handling the request)
  // We need to handle the request first, then grab the session ID
  await transport.handleRequest(req, res, req.body);

  // Now the transport has a session ID
  const newSessionId = transport.sessionId;
  if (newSessionId) {
    sessions.set(newSessionId, {
      transport,
      server,
      replicantId: replicant._id.toString(),
    });

    // Clean up on close
    transport.onclose = () => {
      sessions.delete(newSessionId);
    };
  }
}

/**
 * Handle MCP GET requests (SSE stream for server-to-client notifications).
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
