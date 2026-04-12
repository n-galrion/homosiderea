import { Ship, CelestialBody, Settlement, type ICelestialBody } from '../../db/models/index.js';
import { KnownEntity } from '../../db/models/KnownEntity.js';
import { interpolatePosition } from '../../shared/physics.js';

/**
 * Upsert a known entity for a replicant on arrival. Upgrades intel level if new level is higher.
 */
async function upsertKnownEntity(
  replicantId: string,
  entityType: 'celestial_body' | 'asteroid' | 'ship' | 'structure' | 'settlement' | 'replicant',
  entityId: string,
  entityName: string,
  position: { x: number; y: number; z: number } | null,
  discoveredBy: 'initial' | 'scan' | 'visit' | 'shared' | 'broadcast' | 'research',
  intelLevel: 'vague' | 'basic' | 'detailed' | 'complete',
  currentTick: number,
): Promise<void> {
  const intelOrder = ['vague', 'basic', 'detailed', 'complete'];
  const existing = await KnownEntity.findOne({
    replicantId,
    entityType,
    entityId,
  });

  if (existing) {
    const existingIdx = intelOrder.indexOf(existing.intelLevel);
    const newIdx = intelOrder.indexOf(intelLevel);
    if (newIdx > existingIdx) {
      existing.intelLevel = intelLevel;
    }
    existing.lastUpdatedTick = currentTick;
    if (position) {
      existing.lastKnownPosition = position;
    }
    await existing.save();
  } else {
    await KnownEntity.create({
      replicantId,
      entityType,
      entityId,
      entityName,
      discoveredAtTick: currentTick,
      discoveredBy,
      lastUpdatedTick: currentTick,
      lastKnownPosition: position,
      intelLevel,
    });
  }
}

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
      let destBody: ICelestialBody | null = null;
      if (nav.destinationBodyId) {
        destBody = await CelestialBody.findById(nav.destinationBodyId);
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

      // --- Upsert KnownEntity: visiting a body grants complete intel ---
      if (destBody) {
        const ownerId = ship.ownerId.toString();

        await upsertKnownEntity(
          ownerId, 'celestial_body', destBody._id.toString(), destBody.name,
          destBody.position, 'visit', 'complete', tick,
        );

        // Also add any settlements on this body
        const settlements = await Settlement.find({ bodyId: destBody._id }).lean();
        for (const s of settlements) {
          await upsertKnownEntity(
            ownerId, 'settlement', s._id.toString(), s.name,
            null, 'visit', 'complete', tick,
          );
        }
      }
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
