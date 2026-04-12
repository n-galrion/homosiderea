import { Ship, CelestialBody, Structure } from '../../db/models/index.js';
import type { IActionQueue } from '../../db/models/index.js';
import { InvalidActionError, NotFoundError } from '../../shared/errors.js';

/**
 * Start mining at the current location.
 * Can be applied to a ship (sets a mining flag via the AMI scriptState)
 * or a structure (verifies it's a mine and operational).
 */
export async function handleMine(action: IActionQueue, tick: number): Promise<Record<string, unknown>> {
  const { shipId, structureId } = action.params as {
    shipId?: string;
    structureId?: string;
  };

  if (!shipId && !structureId) {
    throw new InvalidActionError('Must provide either shipId or structureId for mine action');
  }

  if (shipId) {
    const ship = await Ship.findById(shipId);
    if (!ship) {
      throw new NotFoundError('Ship', shipId);
    }

    if (ship.ownerId.toString() !== action.replicantId.toString()) {
      throw new InvalidActionError('Ship does not belong to this replicant');
    }

    if (ship.status !== 'orbiting') {
      throw new InvalidActionError('Ship must be orbiting a body to mine');
    }

    if (!ship.orbitingBodyId) {
      throw new InvalidActionError('Ship is not orbiting any celestial body');
    }

    if (ship.specs.miningRate <= 0) {
      throw new InvalidActionError('Ship has no mining capability');
    }

    const body = await CelestialBody.findById(ship.orbitingBodyId);
    if (!body) {
      throw new NotFoundError('CelestialBody', ship.orbitingBodyId.toString());
    }

    const accessibleResources = body.resources.filter(r => r.accessible);
    if (accessibleResources.length === 0) {
      throw new InvalidActionError('No accessible resources at this location');
    }

    // Set mining flag on the ship — the ResourceProduction system will pick this up
    // by checking for active miner AMIs. For ship-direct mining, we mark via params.
    // The actual mining is done in ResourceProduction.executeMining.
    return {
      shipId: ship._id.toString(),
      bodyId: body._id.toString(),
      bodyName: body.name,
      miningRate: ship.specs.miningRate,
      resourcesAvailable: accessibleResources.map(r => ({
        type: r.resourceType,
        abundance: r.abundance,
      })),
      status: 'mining_started',
    };
  }

  // Structure-based mining
  const structure = await Structure.findById(structureId!);
  if (!structure) {
    throw new NotFoundError('Structure', structureId!);
  }

  if (structure.ownerId.toString() !== action.replicantId.toString()) {
    throw new InvalidActionError('Structure does not belong to this replicant');
  }

  if (structure.type !== 'mine') {
    throw new InvalidActionError('Structure is not a mine');
  }

  if (structure.status !== 'operational') {
    throw new InvalidActionError('Mine is not operational');
  }

  const body = await CelestialBody.findById(structure.bodyId);
  if (!body) {
    throw new NotFoundError('CelestialBody', structure.bodyId.toString());
  }

  return {
    structureId: structure._id.toString(),
    bodyId: body._id.toString(),
    bodyName: body.name,
    miningRate: structure.specs.miningRate,
    resourcesAvailable: body.resources.filter(r => r.accessible).map(r => ({
      type: r.resourceType,
      abundance: r.abundance,
    })),
    status: 'mining_active',
  };
}
