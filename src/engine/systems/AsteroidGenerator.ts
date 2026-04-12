import { CelestialBody, Asteroid } from '../../db/models/index.js';
import { solarEnergyFactor } from '../../shared/physics.js';

interface CompositionProfile {
  resources: Array<{
    resourceType: string;
    abundanceRange: [number, number];
    depositMultiplier: number;
  }>;
}

const COMPOSITION_PROFILES: Record<string, CompositionProfile> = {
  metallic: {
    resources: [
      { resourceType: 'metals', abundanceRange: [0.5, 0.9], depositMultiplier: 1.0 },
      { resourceType: 'rareEarths', abundanceRange: [0.1, 0.4], depositMultiplier: 0.3 },
      { resourceType: 'silicates', abundanceRange: [0.05, 0.2], depositMultiplier: 0.2 },
    ],
  },
  carbonaceous: {
    resources: [
      { resourceType: 'carbon', abundanceRange: [0.4, 0.8], depositMultiplier: 0.8 },
      { resourceType: 'organics', abundanceRange: [0.2, 0.5], depositMultiplier: 0.5 },
      { resourceType: 'metals', abundanceRange: [0.05, 0.2], depositMultiplier: 0.3 },
      { resourceType: 'ice', abundanceRange: [0.1, 0.3], depositMultiplier: 0.4 },
    ],
  },
  siliceous: {
    resources: [
      { resourceType: 'silicates', abundanceRange: [0.4, 0.8], depositMultiplier: 0.9 },
      { resourceType: 'metals', abundanceRange: [0.1, 0.3], depositMultiplier: 0.4 },
      { resourceType: 'rareEarths', abundanceRange: [0.05, 0.15], depositMultiplier: 0.2 },
    ],
  },
  icy: {
    resources: [
      { resourceType: 'ice', abundanceRange: [0.5, 0.95], depositMultiplier: 1.0 },
      { resourceType: 'hydrogen', abundanceRange: [0.1, 0.4], depositMultiplier: 0.5 },
      { resourceType: 'organics', abundanceRange: [0.05, 0.2], depositMultiplier: 0.3 },
    ],
  },
};

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickComposition(weights: { metallic: number; carbonaceous: number; siliceous: number; icy: number }): string {
  const r = Math.random();
  let cumulative = 0;
  for (const [comp, weight] of Object.entries(weights)) {
    cumulative += weight;
    if (r <= cumulative) return comp;
  }
  return 'metallic';
}

/**
 * Generate procedural asteroids for a belt zone.
 */
export async function generateForBeltZone(
  beltZoneId: string,
  count: number,
  tick: number,
): Promise<number> {
  const beltZone = await CelestialBody.findById(beltZoneId);
  if (!beltZone || beltZone.type !== 'belt_zone' || !beltZone.beltConfig) return 0;

  const { maxAsteroids, generatedCount, compositionWeights } = beltZone.beltConfig;
  const remaining = maxAsteroids - generatedCount;
  if (remaining <= 0) return 0;

  const toGenerate = Math.min(count, remaining);
  const asteroids = [];

  for (let i = 0; i < toGenerate; i++) {
    const seqNum = generatedCount + i + 1;
    const zoneName = beltZone.name.replace(/ Zone$/, '').replace(/ /g, '');
    const name = `AST-${zoneName}-${String(seqNum).padStart(4, '0')}`;

    const composition = pickComposition(compositionWeights);
    const profile = COMPOSITION_PROFILES[composition];

    // Random size: radius 0.1-50 km
    const radius = rand(0.1, 50);
    const mass = (4 / 3) * Math.PI * Math.pow(radius, 3) * 3000; // rough density 3000 kg/m³
    const volumeFactor = Math.pow(radius / 10, 3); // normalized to 10km reference

    // Generate resources based on composition
    const resources = profile.resources.map(r => {
      const abundance = rand(r.abundanceRange[0], r.abundanceRange[1]);
      const baseDeposit = rand(100, 5000);
      const totalDeposit = Math.round(baseDeposit * volumeFactor * r.depositMultiplier);
      return {
        resourceType: r.resourceType,
        abundance: parseFloat(abundance.toFixed(3)),
        totalDeposit,
        remaining: totalDeposit,
        accessible: true,
      };
    });

    // Position: belt zone position ± random offset
    const spread = rand(0.05, 0.3);
    const angle = rand(0, 2 * Math.PI);
    const zSpread = rand(-0.02, 0.02);

    // Orbit: perturbed from belt zone
    const beltOrbit = beltZone.orbit!;
    const orbit = {
      semiMajorAxis: beltOrbit.semiMajorAxis + rand(-0.3, 0.3),
      eccentricity: Math.max(0.01, beltOrbit.eccentricity + rand(-0.05, 0.05)),
      inclination: beltOrbit.inclination + rand(-3, 3),
      longitudeOfAscendingNode: rand(0, 360),
      argumentOfPeriapsis: rand(0, 360),
      meanAnomalyAtEpoch: rand(0, 2 * Math.PI),
      orbitalPeriod: beltOrbit.orbitalPeriod + rand(-2000, 2000),
    };

    const pos = {
      x: beltZone.position.x + spread * Math.cos(angle),
      y: beltZone.position.y + spread * Math.sin(angle),
      z: beltZone.position.z + zSpread,
    };

    asteroids.push({
      name,
      beltZoneId: beltZone._id,
      position: pos,
      discovered: false,
      discoveredBy: null,
      discoveredAtTick: null,
      physical: {
        radius: parseFloat(radius.toFixed(2)),
        mass: Math.round(mass),
        composition,
      },
      resources,
      depleted: false,
      orbit,
      solarEnergyFactor: parseFloat(solarEnergyFactor(pos).toFixed(4)),
    });
  }

  if (asteroids.length > 0) {
    await Asteroid.insertMany(asteroids);
    beltZone.beltConfig.generatedCount += asteroids.length;
    await beltZone.save();
  }

  return asteroids.length;
}

/**
 * Discover asteroids near a given position for a replicant.
 * Marks undiscovered asteroids within range as discovered.
 */
export async function discoverNearby(
  position: { x: number; y: number; z: number },
  sensorRange: number,
  replicantId: string,
  tick: number,
): Promise<number> {
  // Find undiscovered asteroids within range
  // MongoDB doesn't do 3D distance queries natively, so we do a box filter then refine
  const margin = sensorRange;
  const candidates = await Asteroid.find({
    discovered: false,
    depleted: false,
    'position.x': { $gte: position.x - margin, $lte: position.x + margin },
    'position.y': { $gte: position.y - margin, $lte: position.y + margin },
    'position.z': { $gte: position.z - margin, $lte: position.z + margin },
  });

  let discovered = 0;
  for (const ast of candidates) {
    const dx = ast.position.x - position.x;
    const dy = ast.position.y - position.y;
    const dz = ast.position.z - position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist <= sensorRange) {
      ast.discovered = true;
      ast.discoveredBy = replicantId as unknown as typeof ast.discoveredBy;
      ast.discoveredAtTick = tick;
      await ast.save();
      discovered++;
    }
  }

  return discovered;
}
