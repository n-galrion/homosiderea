import { AMI, Ship, ActionQueue, Tick } from '../../db/models/index.js';
import { buildAMIContext } from '../../ami/ScriptContext.js';
import { executeScript } from '../../ami/ScriptEngine.js';

/**
 * Execute all active AMI scripts. Each AMI evaluates its script
 * against the current game state and may enqueue an action.
 */
export async function executeAllAMIs(tick: number): Promise<number> {
  const amis = await AMI.find({ status: 'active' });
  let executed = 0;

  for (const ami of amis) {
    try {
      const ctx = await buildAMIContext(ami, tick);
      const result = executeScript(ami.script, ctx);

      // Apply state updates from the script
      if (result.stateUpdates && Object.keys(result.stateUpdates).length > 0) {
        ami.scriptState = { ...ami.scriptState, ...result.stateUpdates };
        ami.markModified('scriptState');
        await ami.save();
      }

      // If the script produced an action, enqueue it
      if (result.action) {
        const shipId = ami.shipId?.toString();
        const structureId = ami.structureId?.toString();

        switch (result.action) {
          case 'mine': {
            // Set the ship to mining state directly
            if (shipId) {
              const ship = await Ship.findById(shipId);
              if (ship && ship.status === 'orbiting' && !ship.miningState?.active) {
                ship.miningState = {
                  active: true,
                  targetBodyId: ship.orbitingBodyId,
                  targetAsteroidId: ship.orbitingAsteroidId,
                  resourceType: result.params.target || null,
                  startedAtTick: tick,
                };
                await ship.save();
              }
            }
            break;
          }
          case 'navigate': {
            if (shipId && result.params.target) {
              await ActionQueue.create({
                replicantId: ami.ownerId,
                type: 'move',
                params: { shipId, destinationBodyId: result.params.target },
                queuedAtTick: tick,
              });
            }
            break;
          }
          case 'unload': {
            // Stop mining and mark as returning
            if (shipId) {
              const ship = await Ship.findById(shipId);
              if (ship?.miningState?.active) {
                ship.miningState.active = false;
                await ship.save();
              }
            }
            break;
          }
          case 'scan': {
            if (shipId) {
              await ActionQueue.create({
                replicantId: ami.ownerId,
                type: 'scan',
                params: { shipId },
                queuedAtTick: tick,
              });
            }
            break;
          }
          case 'return_to_owner': {
            // AMI goes idle — needs the replicant to reassign
            ami.status = 'returning';
            await ami.save();
            break;
          }
          case 'flee':
          case 'hold_position': {
            // No-op for now
            break;
          }
        }
      }

      executed++;
    } catch (err) {
      // Don't let one broken AMI stop the others
      console.error(`AMI ${ami.name} execution error:`, err instanceof Error ? err.message : err);
    }
  }

  return executed;
}
