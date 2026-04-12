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
import { simulateSettlements } from './systems/SettlementBehavior.js';
import { generateCaptainsLog } from './systems/CaptainsLog.js';
import { processMaintenance } from './systems/Maintenance.js';
import { processOrbitFuelDrain } from './systems/FuelConsumption.js';
import { processRandomEvents } from './systems/RandomEvents.js';
import { processNPCTraffic } from './systems/NPCTraffic.js';
import { simulateWorldWithMC } from './systems/MCWorldSimulator.js';
import { processPirateActivity } from './systems/PirateActivity.js';

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

    // Phase 11: Settlement Behavior (NPC simulation)
    try {
      await simulateSettlements(tickNumber);
    } catch (err) {
      errors.push(`Settlements: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 12: Hull Degradation & Maintenance
    try {
      await processMaintenance(tickNumber);
    } catch (err) {
      errors.push(`Maintenance: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 13: Orbital Fuel Drain
    try {
      await processOrbitFuelDrain(tickNumber);
    } catch (err) {
      errors.push(`FuelConsumption: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 14: Captain's Log (auto-generated log entries)
    try {
      await generateCaptainsLog(tickNumber);
    } catch (err) {
      errors.push(`CaptainsLog: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 15: NPC Traffic
    try {
      await processNPCTraffic(tickNumber);
    } catch (err) {
      errors.push(`NPCTraffic: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 16: Pirate Activity
    try {
      const pirateLogs = await processPirateActivity(tickNumber);
      if (pirateLogs.length > 0) {
        errors.push(...pirateLogs.map(l => `[PIRATE] ${l}`));
      }
    } catch (err) {
      errors.push(`PirateActivity: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 17: MC World Simulation (LLM-driven dynamic events, every ~50 ticks)
    try {
      const mcLogs = await simulateWorldWithMC(tickNumber);
      if (mcLogs.length > 0) {
        errors.push(...mcLogs.map(l => `[MC] ${l}`));
      }
    } catch (err) {
      errors.push(`MCWorldSim: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 18: Random Events
    try {
      const eventLogs = await processRandomEvents(tickNumber);
      if (eventLogs.length > 0) {
        errors.push(...eventLogs.map(l => `[EVENT] ${l}`));
      }
    } catch (err) {
      errors.push(`RandomEvents: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Phase 16: Save Tick Record
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
