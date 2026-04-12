import type { AMIContext, AMIRule } from '../shared/types.js';

export interface ScriptResult {
  action: string | null;
  params: Record<string, string>;
  stateUpdates: Record<string, unknown>;
}

export interface BuiltinScript {
  name: string;
  description: string;
  execute(ctx: AMIContext): ScriptResult;
}

export type { AMIContext, AMIRule };
