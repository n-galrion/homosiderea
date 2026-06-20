import { Ship, CelestialBody } from '../../db/models/index.js';
import type { IActionQueue } from '../../db/models/index.js';
import { distance, travelTimeTicks, fuelCost } from '../../shared/physics.js';
import { InvalidActionError, NotFoundError, InsufficientResourcesError } from '../../shared/errors.js';

/**
 * Initiate ship movement to a destination position or celestial body.
 */
export async function handleMove(action: IActionQueue, tick: number): Promise<Record<string, unknown>> {
  const { shipId, destinationBodyId, destinationAsteroidId, destinationPos } = action.params as {
    shipId?: string;
    destinationBodyId?: string;
    destinationAsteroidId?: string;
    destinationPos?: { x: number; y: number; z: number };
  };

  if (!shipId) {
    throw new InvalidActionError('Missing shipId in move params');
  }

  const ship = await Ship.findById(shipId);
  if (!ship) {
    throw new NotFoundError('Ship', shipId);
  }
  if (ship.ownerId.toString() !== action.replicantId.toString()) {
    throw new InvalidActionError('Ship does not belong to this replicant');
  }
  if (ship.status === 'in_transit') {
    throw new InvalidActionError('Ship is already in transit');
  }
  if (ship.status === 'destroyed') {
    throw new InvalidActionError('Ship is destroyed');
  }

  // Resolve the destination position: prefer an explicit destinationPos; otherwise
  // fall back to the body's current position (legacy callers passing only a body id).
  let destPos = destinationPos;
  let destBody = null;
  if (destinationBodyId) {
    destBody = await CelestialBody.findById(destinationBodyId);
    if (!destBody) throw new NotFoundError('CelestialBody', destinationBodyId);
    if (!destPos) destPos = { x: destBody.position.x, y: destBody.position.y, z: destBody.position.z };
  }
  if (!destPos) {
    throw new InvalidActionError('Missing destination: provide destinationPos or destinationBodyId');
  }

  const shipPos = ship.position;
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

  ship.fuel -= requiredFuel;
  ship.status = 'in_transit';
  ship.orbitingBodyId = null;
  ship.orbitingAsteroidId = null;
  ship.dockedAtId = null;
  ship.navigation = {
    destinationBodyId: destBody?._id ?? null,
    destinationAsteroidId: (destinationAsteroidId as never) ?? null,
    destinationPos: { x: destPos.x, y: destPos.y, z: destPos.z },
    departurePos: { x: shipPos.x, y: shipPos.y, z: shipPos.z },
    departureTick: tick,
    arrivalTick: tick + travelTicks,
    speed,
  };

  await ship.save();

  return {
    shipId: ship._id.toString(),
    destinationBodyId: destBody?._id.toString() ?? null,
    destinationName: destBody?.name ?? `(${destPos.x}, ${destPos.y}, ${destPos.z})`,
    distanceAU: dist,
    travelTicks,
    arrivalTick: tick + travelTicks,
    fuelConsumed: requiredFuel,
    fuelRemaining: ship.fuel,
  };
}
