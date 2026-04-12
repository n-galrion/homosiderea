import type { BuiltinScript, AMIContext, ScriptResult } from '../types.js';

export const explorerScript: BuiltinScript = {
  name: 'explorer',
  description: 'Scans celestial bodies systematically, reports findings',

  execute(ctx: AMIContext): ScriptResult {
    if (ctx.location.inTransit) {
      return { action: null, params: {}, stateUpdates: {} };
    }

    if (ctx.hullPercent < 20) {
      return { action: 'return_to_owner', params: {}, stateUpdates: {} };
    }

    if (ctx.fuelPercent < 15) {
      return { action: 'return_to_owner', params: {}, stateUpdates: {} };
    }

    // If at a body, scan it
    if (ctx.location.bodyId) {
      const scannedBodies = (ctx.scriptState.scannedBodies as string[]) || [];
      if (!scannedBodies.includes(ctx.location.bodyId)) {
        return {
          action: 'scan',
          params: {},
          stateUpdates: {
            scannedBodies: [...scannedBodies, ctx.location.bodyId],
          },
        };
      }
    }

    // Navigate to next unscanned body
    return {
      action: 'navigate',
      params: { target: 'nearest unscanned' },
      stateUpdates: {},
    };
  },
};
