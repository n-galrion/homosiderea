import type { BuiltinScript, AMIContext, ScriptResult } from '../types.js';

export const transportScript: BuiltinScript = {
  name: 'transport',
  description: 'Hauls cargo between two designated points',

  execute(ctx: AMIContext): ScriptResult {
    if (ctx.location.inTransit) {
      return { action: null, params: {}, stateUpdates: {} };
    }

    const pickupId = ctx.scriptState.pickupId as string | undefined;
    const dropoffId = ctx.scriptState.dropoffId as string | undefined;
    const phase = ctx.scriptState.phase as string | undefined;

    if (!pickupId || !dropoffId) {
      return { action: null, params: {}, stateUpdates: {} };
    }

    // Phase: loading at pickup
    if (phase === 'loading' || (!phase && ctx.cargoEmpty)) {
      if (ctx.location.bodyId === pickupId) {
        if (ctx.cargoFull) {
          return {
            action: 'navigate',
            params: { target: dropoffId },
            stateUpdates: { phase: 'delivering' },
          };
        }
        return {
          action: 'load',
          params: { target: 'all' },
          stateUpdates: { phase: 'loading' },
        };
      }
      return {
        action: 'navigate',
        params: { target: pickupId },
        stateUpdates: { phase: 'loading' },
      };
    }

    // Phase: delivering to dropoff
    if (phase === 'delivering') {
      if (ctx.location.bodyId === dropoffId) {
        if (ctx.cargoEmpty) {
          return {
            action: 'navigate',
            params: { target: pickupId },
            stateUpdates: { phase: 'loading' },
          };
        }
        return {
          action: 'unload',
          params: { target: 'all' },
          stateUpdates: { phase: 'delivering' },
        };
      }
      return {
        action: 'navigate',
        params: { target: dropoffId },
        stateUpdates: { phase: 'delivering' },
      };
    }

    return { action: null, params: {}, stateUpdates: {} };
  },
};
