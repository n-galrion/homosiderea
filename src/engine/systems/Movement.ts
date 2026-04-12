import { Ship, CelestialBody } from '../../db/models/index.js';
import { interpolatePosition } from '../../shared/physics.js';

/**
 * Advance all ships that are currently in transit.
 * Ships that have arrived snap to their destination; others get their position interpolated.
 */
export async function advanceAll(tick: number): Promise<void> {
  const ships = await Ship.find({ status: 'in_transit' });

  if (ships.length === 0) return;

  const savePromises: Promise<unknown>[] = [];

  for (const ship of ships) {
    const nav = ship.navigation;

    if (nav.arrivalTick != null && nav.arrivalTick <= tick) {
      // Ship has arrived
      // If there's a destination body, look up its current position to snap to
      if (nav.destinationBodyId) {
        const destBody = await CelestialBody.findById(nav.destinationBodyId);
        if (destBody) {
          ship.position = { x: destBody.position.x, y: destBody.position.y, z: destBody.position.z };
        } else if (nav.destinationPos) {
          ship.position = { x: nav.destinationPos.x, y: nav.destinationPos.y, z: nav.destinationPos.z };
        }
      } else if (nav.destinationPos) {
        ship.position = { x: nav.destinationPos.x, y: nav.destinationPos.y, z: nav.destinationPos.z };
      }

      ship.status = 'orbiting';
      ship.orbitingBodyId = nav.destinationBodyId ?? null;

      // Clear navigation
      ship.navigation = {
        destinationBodyId: null,
        destinationPos: null,
        departurePos: null,
        departureTick: null,
        arrivalTick: null,
        speed: null,
      };
    } else if (nav.departurePos && nav.destinationPos && nav.departureTick != null && nav.arrivalTick != null) {
      // Interpolate position
      const totalTicks = nav.arrivalTick - nav.departureTick;
      const elapsed = tick - nav.departureTick;
      const progress = totalTicks > 0 ? elapsed / totalTicks : 1;

      const newPos = interpolatePosition(nav.departurePos, nav.destinationPos, progress);
      ship.position = { x: newPos.x, y: newPos.y, z: newPos.z };
    }

    savePromises.push(ship.save());
  }

  await Promise.all(savePromises);
}
