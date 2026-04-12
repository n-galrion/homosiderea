import { CelestialBody } from '../../db/models/index.js';
import { computeOrbitalPosition, solarEnergyFactor } from '../../shared/physics.js';
import type { Position } from '../../shared/types.js';

/**
 * Update positions of all orbiting celestial bodies for the given tick.
 * Moons have their orbital position added to their parent's position.
 */
export async function updateAllPositions(tick: number): Promise<void> {
  const bodies = await CelestialBody.find({ orbit: { $ne: null } }).lean();

  if (bodies.length === 0) return;

  // Build a map of body id -> body for parent lookups
  const bodyMap = new Map<string, typeof bodies[number]>();
  for (const body of bodies) {
    bodyMap.set(body._id.toString(), body);
  }

  // Also load bodies without orbits (e.g. the Sun) for parent position lookups
  const staticBodies = await CelestialBody.find({ orbit: null }).lean();
  for (const body of staticBodies) {
    bodyMap.set(body._id.toString(), body);
  }

  // First pass: compute orbital positions for all non-moon bodies (no parentId or parent is static)
  // Second pass: compute positions for moons (adding parent position)
  // We do two passes to ensure parent positions are computed before moons.

  const bulkOps: Array<{
    updateOne: {
      filter: { _id: typeof bodies[number]['_id'] };
      update: { $set: { position: Position; solarEnergyFactor: number } };
    };
  }> = [];

  // Separate bodies into planets (no parentId or parent is a star) and moons
  const primaryBodies: typeof bodies = [];
  const moons: typeof bodies = [];

  for (const body of bodies) {
    if (body.parentId) {
      moons.push(body);
    } else {
      primaryBodies.push(body);
    }
  }

  // Compute positions for primary bodies (planets, asteroids, etc.)
  const computedPositions = new Map<string, Position>();

  for (const body of primaryBodies) {
    const pos = computeOrbitalPosition(tick, body.orbit!);
    computedPositions.set(body._id.toString(), pos);
    bulkOps.push({
      updateOne: {
        filter: { _id: body._id },
        update: {
          $set: {
            position: pos,
            solarEnergyFactor: solarEnergyFactor(pos),
          },
        },
      },
    });
  }

  // Compute positions for moons: orbital position relative to parent + parent's absolute position
  for (const moon of moons) {
    const orbitalPos = computeOrbitalPosition(tick, moon.orbit!);
    const parentId = moon.parentId!.toString();

    // Get parent position: either freshly computed or from the static/existing data
    let parentPos: Position;
    const computedParentPos = computedPositions.get(parentId);
    if (computedParentPos) {
      parentPos = computedParentPos;
    } else {
      const parentBody = bodyMap.get(parentId);
      parentPos = parentBody?.position ?? { x: 0, y: 0, z: 0 };
    }

    const absolutePos: Position = {
      x: orbitalPos.x + parentPos.x,
      y: orbitalPos.y + parentPos.y,
      z: orbitalPos.z + parentPos.z,
    };

    computedPositions.set(moon._id.toString(), absolutePos);
    bulkOps.push({
      updateOne: {
        filter: { _id: moon._id },
        update: {
          $set: {
            position: absolutePos,
            solarEnergyFactor: solarEnergyFactor(absolutePos),
          },
        },
      },
    });
  }

  if (bulkOps.length > 0) {
    await CelestialBody.bulkWrite(bulkOps);
  }
}
