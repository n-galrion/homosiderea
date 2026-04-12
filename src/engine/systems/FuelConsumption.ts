import { Ship, MemoryLog } from '../../db/models/index.js';

const ORBIT_FUEL_COST_PER_TICK = 0.1;

/**
 * Ships orbiting consume a tiny amount of fuel per tick for station-keeping.
 * Ships that run out of fuel can't move but don't die -- they drift.
 */
export async function processOrbitFuelDrain(tick: number): Promise<void> {
  const orbitingShips = await Ship.find({
    status: 'orbiting',
  });

  if (orbitingShips.length === 0) return;

  const logEntries: Array<{
    replicantId: string;
    title: string;
    content: string;
  }> = [];

  for (const ship of orbitingShips) {
    const prevFuel = ship.fuel;

    if (ship.fuel > 0) {
      ship.fuel = Math.max(0, parseFloat((ship.fuel - ORBIT_FUEL_COST_PER_TICK).toFixed(4)));

      // Just ran out of fuel
      if (prevFuel > 0 && ship.fuel <= 0) {
        logEntries.push({
          replicantId: ship.ownerId.toString(),
          title: 'Fuel depleted',
          content: `${ship.name} has exhausted its fuel reserves. The ship is now drifting and cannot maneuver. Resupply required.`,
        });
      }
    }

    await ship.save();
  }

  if (logEntries.length > 0) {
    await MemoryLog.insertMany(
      logEntries.map(e => ({
        replicantId: e.replicantId,
        category: 'log' as const,
        title: e.title,
        content: e.content,
        tags: ['auto', 'fuel'],
        tick,
      })),
    );
  }
}
