import { Parser } from 'expr-eval';
import type { AMIContext, AMIRule, ScriptResult } from './types.js';
import { minerScript } from './builtins/minerScript.js';
import { explorerScript } from './builtins/explorerScript.js';
import { factoryScript } from './builtins/factoryScript.js';
import { transportScript } from './builtins/transportScript.js';
import { combatScript } from './builtins/combatScript.js';
import type { BuiltinScript } from './types.js';

const parser = new Parser();

const BUILTIN_SCRIPTS: Record<string, BuiltinScript> = {
  miner: minerScript,
  explorer: explorerScript,
  factory: factoryScript,
  transport: transportScript,
  combat: combatScript,
};

/**
 * Parse an action string like "mine metals" or "navigate nearest refinery"
 * into an action name and params.
 */
function parseAction(actionStr: string): { action: string; params: Record<string, string> } {
  const parts = actionStr.trim().split(/\s+/);
  const action = parts[0];
  const params: Record<string, string> = {};

  if (parts.length > 1) {
    params.target = parts.slice(1).join(' ');
  }

  return { action, params };
}

/**
 * Flatten the AMI context into a flat object for expr-eval.
 * expr-eval doesn't support nested property access well,
 * so we flatten location.bodyType to location_bodyType etc.
 */
function flattenContext(ctx: AMIContext): Record<string, unknown> {
  return {
    cargoUsed: ctx.cargoUsed,
    cargoCapacity: ctx.cargoCapacity,
    cargoFull: ctx.cargoFull ? 1 : 0,
    cargoEmpty: ctx.cargoEmpty ? 1 : 0,
    status_active: ctx.status === 'active' ? 1 : 0,
    status_idle: ctx.status === 'idle' ? 1 : 0,
    status_returning: ctx.status === 'returning' ? 1 : 0,
    inTransit: ctx.location.inTransit ? 1 : 0,
    hullPercent: ctx.hullPercent,
    fuelPercent: ctx.fuelPercent,
    nearbyHostiles: ctx.nearbyHostiles,
    nearbyAllies: ctx.nearbyAllies,
    tick: ctx.tick,
    // Cargo amounts
    cargo_metals: ctx.cargo.metals || 0,
    cargo_ice: ctx.cargo.ice || 0,
    cargo_silicates: ctx.cargo.silicates || 0,
    cargo_rareEarths: ctx.cargo.rareEarths || 0,
    cargo_helium3: ctx.cargo.helium3 || 0,
    cargo_organics: ctx.cargo.organics || 0,
    cargo_hydrogen: ctx.cargo.hydrogen || 0,
    cargo_uranium: ctx.cargo.uranium || 0,
    cargo_carbon: ctx.cargo.carbon || 0,
    cargo_alloys: ctx.cargo.alloys || 0,
    cargo_fuel: ctx.cargo.fuel || 0,
    cargo_electronics: ctx.cargo.electronics || 0,
    cargo_hullPlating: ctx.cargo.hullPlating || 0,
    // Location
    hasBody: ctx.location.bodyId ? 1 : 0,
    bodyType_asteroid: ctx.location.bodyType === 'asteroid' ? 1 : 0,
    bodyType_planet: ctx.location.bodyType === 'planet' ? 1 : 0,
    bodyType_moon: ctx.location.bodyType === 'moon' ? 1 : 0,
    bodyType_belt_zone: ctx.location.bodyType === 'belt_zone' ? 1 : 0,
  };
}

/**
 * Evaluate a custom rule condition against the AMI context.
 */
function evaluateCondition(condition: string, ctx: AMIContext): boolean {
  try {
    const flat = flattenContext(ctx);
    const result = parser.evaluate(condition, flat as Record<string, number>);
    return Boolean(result);
  } catch {
    return false;
  }
}

/**
 * Execute an AMI's script (builtin or custom) and return the result.
 */
export function executeScript(
  scriptDef: { type: 'builtin' | 'custom'; builtinName?: string; customRules?: AMIRule[] },
  ctx: AMIContext,
): ScriptResult {
  // Builtin scripts
  if (scriptDef.type === 'builtin' && scriptDef.builtinName) {
    const builtin = BUILTIN_SCRIPTS[scriptDef.builtinName];
    if (builtin) {
      return builtin.execute(ctx);
    }
    return { action: null, params: {}, stateUpdates: {} };
  }

  // Custom rule-based scripts
  if (scriptDef.type === 'custom' && scriptDef.customRules) {
    const sortedRules = [...scriptDef.customRules].sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      if (evaluateCondition(rule.condition, ctx)) {
        const { action, params } = parseAction(rule.action);
        return { action, params, stateUpdates: {} };
      }
    }
  }

  // No matching rule — idle
  return { action: null, params: {}, stateUpdates: {} };
}

export { BUILTIN_SCRIPTS };
