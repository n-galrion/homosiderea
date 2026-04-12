import { Router, type Request, type Response, type NextFunction } from 'express';
import { buildToolRegistry, getToolDefinitions } from '../../tools/registry.js';
import { authMiddleware } from '../middleware/auth.js';

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
toolsRoutes.post('/:toolName', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const replicantId = req.replicantId;
    if (!replicantId) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
      return;
    }

    const toolName = req.params.toolName as string;
    const registry = buildToolRegistry(replicantId);
    const tool = registry.get(toolName);

    if (!tool) {
      res.status(404).json({ error: 'NOT_FOUND', message: `Tool "${toolName}" not found` });
      return;
    }

    const mcpResult = await tool.handler(req.body || {});

    // Parse MCP format: { content: [{ type: 'text', text: '...' }] }
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
