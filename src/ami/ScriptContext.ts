import type { IAMI } from '../db/models/AMI.js';
import type { IShip } from '../db/models/Ship.js';
import type { IResourceStore } from '../db/models/ResourceStore.js';
import type { ICelestialBody } from '../db/models/CelestialBody.js';
import type { AMIContext } from './types.js';
import { Ship, ResourceStore, CelestialBody } from '../db/models/index.js';

/**
 * Build the execution context for an AMI script from current game state.
 */
export async function buildAMIContext(
  ami: IAMI,
  tick: number,
): Promise<AMIContext> {
  let cargo: Record<string, number> = {};
  let cargoUsed = 0;
  let cargoCapacity = ami.specs.cargoCapacity;
  let hullPercent = 100;
  let fuelPercent = 100;
  let bodyId: string | null = null;
  let bodyName: string | null = null;
  let bodyType: string | null = null;
  let inTransit = false;

  // Get ship data if AMI is on a ship
  if (ami.shipId) {
    const ship = await Ship.findById(ami.shipId).lean();
    if (ship) {
      // Load ship's cargo
      const store = await ResourceStore.findOne({
        'ownerRef.kind': 'Ship',
        'ownerRef.item': ship._id,
      }).lean();

      if (store) {
        cargo = {
          metals: store.metals,
          ice: store.ice,
          silicates: store.silicates,
          rareEarths: store.rareEarths,
          helium3: store.helium3,
          organics: store.organics,
          hydrogen: store.hydrogen,
          uranium: store.uranium,
          carbon: store.carbon,
          alloys: store.alloys,
          fuel: store.fuel,
          electronics: store.electronics,
          hullPlating: store.hullPlating,
        };
        cargoUsed = Object.values(cargo).reduce((a, b) => a + b, 0);
      }

      cargoCapacity = ship.specs.cargoCapacity;
      hullPercent = (ship.specs.hullPoints / ship.specs.maxHullPoints) * 100;
      fuelPercent = (ship.fuel / ship.specs.fuelCapacity) * 100;
      inTransit = ship.status === 'in_transit';

      if (ship.orbitingBodyId) {
        const body = await CelestialBody.findById(ship.orbitingBodyId).lean();
        if (body) {
          bodyId = body._id.toString();
          bodyName = body.name;
          bodyType = body.type;
        }
      }
    }
  }

  // Get structure location if AMI is on a structure
  if (ami.structureId && !bodyId) {
    const { Structure } = await import('../db/models/index.js');
    const structure = await Structure.findById(ami.structureId).lean();
    if (structure) {
      const body = await CelestialBody.findById(structure.bodyId).lean();
      if (body) {
        bodyId = body._id.toString();
        bodyName = body.name;
        bodyType = body.type;
      }
    }
  }

  return {
    cargo,
    cargoUsed,
    cargoCapacity,
    cargoFull: cargoUsed >= cargoCapacity,
    cargoEmpty: cargoUsed === 0,
    location: { bodyId, bodyName, bodyType, inTransit },
    status: ami.status,
    hullPercent,
    fuelPercent,
    nearbyHostiles: 0, // TODO: implement proximity scan
    nearbyAllies: 0,
    tick,
    scriptState: ami.scriptState || {},
  };
}
