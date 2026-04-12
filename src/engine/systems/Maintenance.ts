import { Ship, MemoryLog, Notification } from '../../db/models/index.js';
import { distance } from '../../shared/physics.js';
import { generateSalvageFromShip } from './SalvageGenerator.js';

const SUN_POSITION = { x: 0, y: 0, z: 0 };
const RADIATION_THRESHOLD_AU = 0.5;
const ASTEROID_BELT_INNER_AU = 2.0;
const ASTEROID_BELT_OUTER_AU = 3.5;
const ASTEROID_COLLISION_CHANCE = 0.02; // 2% chance per tick
const ASTEROID_COLLISION_DAMAGE = 2.0;
const RADIATION_DAMAGE_FACTOR = 0.5;

/**
 * Process hull degradation, radiation exposure, and environmental hazards.
 */
export async function processMaintenance(tick: number): Promise<void> {
  const ships = await Ship.find({
    status: { $ne: 'destroyed' },
  });

  if (ships.length === 0) return;

  const logEntries: Array<{
    replicantId: string;
    title: string;
    content: string;
  }> = [];

  for (const ship of ships) {
    const prevHull = ship.specs.hullPoints;
    const degradationRate = ship.maintenance?.hullDegradationRate ?? 0.01;

    // Base hull degradation
    ship.specs.hullPoints -= degradationRate;

    // Radiation damage near Sun
    const distFromSun = distance(ship.position, SUN_POSITION);
    if (distFromSun < RADIATION_THRESHOLD_AU) {
      const radiationDamage = RADIATION_DAMAGE_FACTOR * (1 - distFromSun / RADIATION_THRESHOLD_AU);
      ship.specs.hullPoints -= radiationDamage;
      ship.maintenance.radiationExposure += radiationDamage;
    }

    // Asteroid belt collision risk
    if (distFromSun >= ASTEROID_BELT_INNER_AU && distFromSun <= ASTEROID_BELT_OUTER_AU) {
      if (Math.random() < ASTEROID_COLLISION_CHANCE) {
        ship.specs.hullPoints -= ASTEROID_COLLISION_DAMAGE;
        logEntries.push({
          replicantId: ship.ownerId.toString(),
          title: 'Micrometeorite impact',
          content: `${ship.name} was struck by a micrometeorite in the asteroid belt. Hull took ${ASTEROID_COLLISION_DAMAGE} damage.`,
        });
      }
    }

    // Clamp hull points
    ship.specs.hullPoints = Math.max(0, parseFloat(ship.specs.hullPoints.toFixed(4)));
    ship.maintenance.lastMaintenanceTick = tick;

    // Hull warning thresholds
    const hullPercent = ship.specs.hullPoints / ship.specs.maxHullPoints;
    const prevPercent = prevHull / ship.specs.maxHullPoints;

    if (prevPercent > 0.5 && hullPercent <= 0.5) {
      logEntries.push({
        replicantId: ship.ownerId.toString(),
        title: 'Hull warning: 50%',
        content: `WARNING: ${ship.name} hull integrity at ${(hullPercent * 100).toFixed(1)}%. Maintenance recommended.`,
      });
    } else if (prevPercent > 0.25 && hullPercent <= 0.25) {
      logEntries.push({
        replicantId: ship.ownerId.toString(),
        title: 'Hull critical: 25%',
        content: `CRITICAL: ${ship.name} hull integrity at ${(hullPercent * 100).toFixed(1)}%. Immediate repair needed.`,
      });
    } else if (prevPercent > 0.1 && hullPercent <= 0.1) {
      logEntries.push({
        replicantId: ship.ownerId.toString(),
        title: 'Hull emergency: 10%',
        content: `EMERGENCY: ${ship.name} hull integrity at ${(hullPercent * 100).toFixed(1)}%. Ship is failing.`,
      });
    }

    // Ship destroyed at 0 HP
    if (ship.specs.hullPoints <= 0) {
      ship.specs.hullPoints = 0;
      ship.status = 'destroyed';
      ship.miningState = null;

      // Generate salvage from wreckage
      const isNPC = ship.ownerId.toString() === '000000000000000000000000';
      const isPirate = ship.ownerId.toString() === '000000000000000000000001';
      await generateSalvageFromShip(ship, tick, isPirate ? 'pirate' : isNPC ? 'npc' : 'player');

      logEntries.push({
        replicantId: ship.ownerId.toString(),
        title: 'Ship destroyed',
        content: `${ship.name} has been destroyed. Hull integrity reached 0%. Wreckage and salvage may be recoverable at the last known position.`,
      });

      // Dashboard notification
      await Notification.create({
        type: 'ship_destroyed',
        title: `Ship Destroyed: ${ship.name}`,
        body: `${ship.name} was destroyed at position (${ship.position.x.toFixed(2)}, ${ship.position.y.toFixed(2)}) AU. Salvage generated.`,
        data: { shipName: ship.name, ownerId: ship.ownerId.toString(), position: ship.position },
        tick,
      });
    }

    await ship.save();
  }

  // Write warning/destruction log entries
  if (logEntries.length > 0) {
    await MemoryLog.insertMany(
      logEntries.map(e => ({
        replicantId: e.replicantId,
        category: 'log' as const,
        title: e.title,
        content: e.content,
        tags: ['auto', 'maintenance'],
        tick,
      })),
    );
  }
}
