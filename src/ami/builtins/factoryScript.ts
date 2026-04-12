import type { BuiltinScript, AMIContext, ScriptResult } from '../types.js';

export const factoryScript: BuiltinScript = {
  name: 'factory',
  description: 'Operates a factory structure, runs manufacturing blueprints',

  execute(ctx: AMIContext): ScriptResult {
    // Factory AMIs are stationary — they operate structures
    // The assigned blueprint is stored in scriptState
    const blueprintId = ctx.scriptState.blueprintId as string | undefined;
    if (!blueprintId) {
      return { action: null, params: {}, stateUpdates: {} };
    }

    // Attempt to manufacture
    return {
      action: 'manufacture',
      params: { target: blueprintId },
      stateUpdates: {},
    };
  },
};
