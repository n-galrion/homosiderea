import { Tick } from '../db/models/index.js';
import type { TickResult } from '../shared/types.js';
import { updateAllPositions } from './systems/OrbitalMechanics.js';
import { generateEnergy, executeMining } from './systems/ResourceProduction.js';
import { resolveAll } from './systems/ActionResolver.js';
import { advanceAll } from './systems/Movement.js';
import { advanceConstruction, processManufacturing } from './systems/Manufacturing.js';
import { deliverMessages } from './systems/Communication.js';
import { recomputeAllColonyStats } from './systems/ColonyManager.js';
import { processCompletedResearch } from './systems/MasterController.js';

/**
 * Orchestrates the processing of a single game tick.
 * Phases execute in strict order; each phase is wrapped in try/catch
 * so that a failure in one phase doesn't abort the entire tick.
 */
export class TickProcessor {
  /**
   * Process a single tick through all game phases in order.
   */
  async processTick(tickNumber: number): Promise<TickResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let actionsProcessed = 0;
    let amisExecuted = 0;
    let messagesDelivered = 0;

    // Create tick record to mark start
    const tickRecord = await Tick.create({
      tickNumber,
      startedAt: new Date(),
    });

    // Phase 1: Orbital Update
    try {
      await updateAllPositions(tickNumber);
    } catch (err) {
      errors.push(`OrbitalUpdate: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 2: Energy Production
    try {
      await generateEnergy(tickNumber);
    } catch (err) {
      errors.push(`EnergyProduction: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 3: AMI Execution (stub — will be implemented in AMI task)
    try {
      // AMIExecutor.executeAll() will go here
      amisExecuted = 0;
    } catch (err) {
      errors.push(`AMIExecution: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 4: Action Resolution
    try {
      actionsProcessed = await resolveAll(tickNumber);
    } catch (err) {
      errors.push(`ActionResolution: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 5: Movement
    try {
      await advanceAll(tickNumber);
    } catch (err) {
      errors.push(`Movement: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 6: Resource Production (Mining)
    try {
      await executeMining(tickNumber);
    } catch (err) {
      errors.push(`ResourceProduction: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 7: Construction
    try {
      await advanceConstruction(tickNumber);
      await processManufacturing(tickNumber);
    } catch (err) {
      errors.push(`Construction: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 8: Communication
    try {
      messagesDelivered = await deliverMessages(tickNumber);
    } catch (err) {
      errors.push(`Communication: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 9: Colony Stats Recompute
    try {
      await recomputeAllColonyStats(tickNumber);
    } catch (err) {
      errors.push(`ColonyStats: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 10: Research Processing
    try {
      await processCompletedResearch(tickNumber);
    } catch (err) {
      errors.push(`Research: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 11: Save Tick Record
    const durationMs = Date.now() - startTime;

    tickRecord.completedAt = new Date();
    tickRecord.durationMs = durationMs;
    tickRecord.actionsProcessed = actionsProcessed;
    tickRecord.amisExecuted = amisExecuted;
    tickRecord.messagesDelivered = messagesDelivered;
    tickRecord.tickErrors = errors;
    await tickRecord.save();

    return {
      tickNumber,
      durationMs,
      actionsProcessed,
      amisExecuted,
      messagesDelivered,
      errors,
    };
  }
}
