import type { BuiltinScript, AMIContext, ScriptResult } from '../types.js';

export const minerScript: BuiltinScript = {
  name: 'miner',
  description: 'Mines resources at assigned location, returns cargo when full',

  execute(ctx: AMIContext): ScriptResult {
    // If in transit, wait
    if (ctx.location.inTransit) {
      return { action: null, params: {}, stateUpdates: {} };
    }

    // If damaged below 30%, return to owner
    if (ctx.hullPercent < 30) {
      return { action: 'return_to_owner', params: {}, stateUpdates: {} };
    }

    // If cargo is full, navigate to nearest refinery to unload
    if (ctx.cargoFull) {
      return {
        action: 'navigate',
        params: { target: 'nearest refinery' },
        stateUpdates: { phase: 'hauling' },
      };
    }

    // If we're at a refinery-type location and have cargo (returning from haul)
    const phase = ctx.scriptState.phase as string | undefined;
    if (phase === 'hauling' && ctx.cargoUsed > 0) {
      return { action: 'unload', params: { target: 'all' }, stateUpdates: {} };
    }

    // After unloading, go back to mining
    if (phase === 'hauling' && ctx.cargoEmpty) {
      const assignedBody = ctx.scriptState.assignedBody as string | undefined;
      if (assignedBody) {
        return {
          action: 'navigate',
          params: { target: assignedBody },
          stateUpdates: { phase: 'mining' },
        };
      }
    }

    // At a mineable location — mine the primary resource
    if (ctx.location.bodyId && !ctx.cargoFull) {
      const targetResource = (ctx.scriptState.targetResource as string) || 'metals';
      return {
        action: 'mine',
        params: { target: targetResource },
        stateUpdates: { phase: 'mining', assignedBody: ctx.location.bodyId },
      };
    }

    // No location — navigate to nearest asteroid
    return {
      action: 'navigate',
      params: { target: 'nearest asteroid' },
      stateUpdates: { phase: 'seeking' },
    };
  },
};
