import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { evaluateAction, applyOutcomes } from '../../engine/systems/ActionEvaluator.js';
import { ActionQueue, Tick } from '../../db/models/index.js';
import { config } from '../../config.js';

/** Compute timing info for an action or event that resolves at a target tick. */
function timingInfo(currentTick: number, targetTick: number, tickIntervalMs: number) {
  const ticksRemaining = Math.max(0, targetTick - currentTick);
  return {
    currentTick,
    targetTick,
    ticksRemaining,
    estimatedWaitMs: ticksRemaining * tickIntervalMs,
    tickIntervalMs,
  };
}

export function registerActionTools(server: McpServer, replicantId: string): void {

  server.tool(
    'propose_action',
    `Describe any action you want to take. Your ship's computer will run a physics simulation to determine if it's feasible, what resources it requires, and what the outcomes will be. This handles everything: mining, building, trading, researching, attacking, diplomacy, and anything else you can think of.

Examples:
- "Mine metals from the asteroid I'm orbiting using my ship's mining equipment"
- "Sell 100 units of alloys to the Houston market"
- "Research a more efficient ion drive by modifying the exhaust nozzle geometry"
- "Build a refinery at my colony on Luna"
- "Negotiate a trade agreement with Artemis Base"

Your computer simulates the physics, checks your resources and position, and tells you the outcome.`,
    {
      action: z.string().describe('Describe what you want to do in plain language'),
      context: z.string().optional().describe('Any additional context, reasoning, or details'),
      autoApply: z.boolean().optional().default(true).describe('Automatically apply outcomes if feasible (set false to preview only)'),
    },
    async ({ action, context, autoApply }) => {
      const outcome = await evaluateAction(replicantId, action, context || undefined);

      if (outcome.impossible) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'IMPOSSIBLE',
              reason: outcome.impossibleReason,
              message: 'This action violates fundamental physical laws or game constraints and can never be done.',
            }, null, 2),
          }],
        };
      }

      if (!outcome.feasible) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'NOT_FEASIBLE',
              reason: outcome.reason,
              prerequisites: outcome.prerequisites,
              message: 'This action is not currently possible but could be with the right prerequisites.',
            }, null, 2),
          }],
        };
      }

      // Feasible — apply if autoApply
      if (autoApply) {
        const log = await applyOutcomes(replicantId, outcome);

        // Store in action queue for history
        const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
        const currentTick = latestTick?.tickNumber ?? 0;

        await ActionQueue.create({
          replicantId,
          type: 'proposed_action',
          status: 'completed',
          params: { action, context, evaluatedBy: 'ship_computer' },
          result: {
            outcomes: outcome.outcomes,
            narrative: outcome.outcomes?.narrative,
            log,
          },
          queuedAtTick: currentTick,
          resolvedAtTick: currentTick,
        });

        const ticksToComplete = outcome.ticksToComplete ?? 0;
        const estimatedCompletionTick = currentTick + ticksToComplete;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'EXECUTED',
              narrative: outcome.outcomes?.narrative,
              reason: outcome.reason,
              costs: {
                compute: outcome.computeCost,
                energy: outcome.energyCost,
                ticks: outcome.ticksToComplete,
              },
              outcomes: outcome.outcomes,
              appliedChanges: log,
              timing: timingInfo(currentTick, estimatedCompletionTick, config.game.tickIntervalMs),
            }, null, 2),
          }],
        };
      }

      // Preview only
      {
        const previewTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
        const previewCurrentTick = previewTick?.tickNumber ?? 0;
        const previewTicksToComplete = outcome.ticksToComplete ?? 0;
        const previewCompletionTick = previewCurrentTick + previewTicksToComplete;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status: 'PREVIEW',
              reason: outcome.reason,
              costs: {
                compute: outcome.computeCost,
                energy: outcome.energyCost,
                ticks: outcome.ticksToComplete,
              },
              outcomes: outcome.outcomes,
              message: 'This is a preview. Call again with autoApply: true to execute.',
              timing: timingInfo(previewCurrentTick, previewCompletionTick, config.game.tickIntervalMs),
            }, null, 2),
          }],
        };
      }
    },
  );
}
