import { CelestialBody, Ship, Replicant } from '../../db/models/index.js';
import type { IActionQueue } from '../../db/models/index.js';
import { distance } from '../../shared/physics.js';
import { InvalidActionError, NotFoundError } from '../../shared/errors.js';

/**
 * Scan for nearby celestial bodies within sensor range of the replicant's ship.
 */
export async function handleScan(action: IActionQueue, tick: number): Promise<Record<string, unknown>> {
  const { shipId } = action.params as { shipId?: string };

  if (!shipId) {
    throw new InvalidActionError('Missing shipId in scan params');
  }

  const ship = await Ship.findById(shipId);
  if (!ship) {
    throw new NotFoundError('Ship', shipId);
  }

  // Verify ownership
  if (ship.ownerId.toString() !== action.replicantId.toString()) {
    throw new InvalidActionError('Ship does not belong to this replicant');
  }

  if (ship.status === 'destroyed') {
    throw new InvalidActionError('Cannot scan from a destroyed ship');
  }

  const sensorRange = ship.specs.sensorRange;
  const shipPos = ship.position;

  // Find all celestial bodies and filter by distance
  const allBodies = await CelestialBody.find({}).lean();
  const nearbyBodies = allBodies
    .map(body => ({
      id: body._id.toString(),
      name: body.name,
      type: body.type,
      position: body.position,
      distance: distance(shipPos, body.position),
      resources: body.resources.length,
    }))
    .filter(b => b.distance <= sensorRange)
    .sort((a, b) => a.distance - b.distance);

  return {
    shipId: ship._id.toString(),
    sensorRange,
    bodiesFound: nearbyBodies.length,
    bodies: nearbyBodies,
  };
}
