import { registerAllTools } from '../mcp/tools/index.js';

export interface ToolDef {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

/**
 * Capture proxy that mimics McpServer.tool() to record tool registrations.
 * This avoids refactoring all 65+ tool files — we intercept their registrations
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
