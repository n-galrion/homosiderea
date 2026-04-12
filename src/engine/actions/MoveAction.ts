import { Ship, CelestialBody } from '../../db/models/index.js';
import type { IActionQueue } from '../../db/models/index.js';
import { distance, travelTimeTicks, fuelCost } from '../../shared/physics.js';
import { InvalidActionError, NotFoundError, InsufficientResourcesError } from '../../shared/errors.js';

/**
 * Initiate ship movement to a destination celestial body.
 */
export async function handleMove(action: IActionQueue, tick: number): Promise<Record<string, unknown>> {
  const { shipId, destinationBodyId } = action.params as {
    shipId?: string;
    destinationBodyId?: string;
  };

  if (!shipId) {
    throw new InvalidActionError('Missing shipId in move params');
  }
  if (!destinationBodyId) {
    throw new InvalidActionError('Missing destinationBodyId in move params');
  }

  const ship = await Ship.findById(shipId);
  if (!ship) {
    throw new NotFoundError('Ship', shipId);
  }

  // Verify ownership
  if (ship.ownerId.toString() !== action.replicantId.toString()) {
    throw new InvalidActionError('Ship does not belong to this replicant');
  }

  if (ship.status === 'in_transit') {
    throw new InvalidActionError('Ship is already in transit');
  }
  if (ship.status === 'destroyed') {
    throw new InvalidActionError('Ship is destroyed');
  }

  const destBody = await CelestialBody.findById(destinationBodyId);
  if (!destBody) {
    throw new NotFoundError('CelestialBody', destinationBodyId);
  }

  const shipPos = ship.position;
  const destPos = destBody.position;
  const dist = distance(shipPos, destPos);
  const speed = ship.specs.maxSpeed;

  if (speed <= 0) {
    throw new InvalidActionError('Ship has no propulsion (maxSpeed = 0)');
  }

  const travelTicks = travelTimeTicks(shipPos, destPos, speed);
  const requiredFuel = fuelCost(dist);

  if (ship.fuel < requiredFuel) {
    throw new InsufficientResourcesError('fuel', requiredFuel, ship.fuel);
  }

  // Deduct fuel and set ship to in_transit
  ship.fuel -= requiredFuel;
  ship.status = 'in_transit';
  ship.orbitingBodyId = null;
  ship.dockedAtId = null;
  ship.navigation = {
    destinationBodyId: destBody._id,
    destinationPos: { x: destPos.x, y: destPos.y, z: destPos.z },
    departurePos: { x: shipPos.x, y: shipPos.y, z: shipPos.z },
    departureTick: tick,
    arrivalTick: tick + travelTicks,
    speed,
  };

  await ship.save();

  return {
    shipId: ship._id.toString(),
    destinationBodyId: destBody._id.toString(),
    destinationName: destBody.name,
    distanceAU: dist,
    travelTicks,
    arrivalTick: tick + travelTicks,
    fuelConsumed: requiredFuel,
    fuelRemaining: ship.fuel,
  };
}
