import type { BuiltinScript, AMIContext, ScriptResult } from '../types.js';

export const combatScript: BuiltinScript = {
  name: 'combat',
  description: 'Patrols assigned area, engages hostiles, retreats when damaged',

  execute(ctx: AMIContext): ScriptResult {
    if (ctx.location.inTransit) {
      return { action: null, params: {}, stateUpdates: {} };
    }

    // Retreat if badly damaged
    if (ctx.hullPercent < 25) {
      return { action: 'return_to_owner', params: {}, stateUpdates: { phase: 'retreating' } };
    }

    // Low fuel — return
    if (ctx.fuelPercent < 10) {
      return { action: 'return_to_owner', params: {}, stateUpdates: { phase: 'refueling' } };
    }

    // Engage hostiles if present
    if (ctx.nearbyHostiles > 0) {
      return {
        action: 'attack',
        params: { target: 'nearest_hostile' },
        stateUpdates: { phase: 'engaging' },
      };
    }

    // Patrol assigned body
    const patrolBodyId = ctx.scriptState.patrolBodyId as string | undefined;
    if (patrolBodyId && ctx.location.bodyId !== patrolBodyId) {
      return {
        action: 'navigate',
        params: { target: patrolBodyId },
        stateUpdates: { phase: 'patrolling' },
      };
    }

    // Hold position and scan
    return {
      action: 'scan',
      params: {},
      stateUpdates: { phase: 'patrolling' },
    };
  },
};
