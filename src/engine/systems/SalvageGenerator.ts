import { Salvage, Ship, ResourceStore } from '../../db/models/index.js';
import { generatePirateName } from '../../shared/nameGen.js';

const TECH_DOMAINS = ['scanning', 'mining', 'propulsion', 'weapons', 'hull', 'construction', 'computing', 'energy', 'communication'];

const FLIGHT_LOG_TEMPLATES = [
  (name: string) => `[FINAL LOG — ${name}]\nTick {tick}: Hull breach in section 7. Atmosphere venting. Tried to seal with emergency foam but pressure differential too high. Reactor scram initiated. Last sensor reading showed {reading}. If anyone finds this, the coordinates at bearing {bearing}° contain something worth investigating. End log.`,
  (name: string) => `${name} — Automated flight recorder\nWarning: Multiple hull breaches detected.\nFinal telemetry: velocity {vel} km/s, heading {heading}°.\nCargo manifest at time of loss: {cargo}.\nNote from captain: "The signal we followed turned out to be a trap. Don't make the same mistake."`,
  (name: string) => `[BLACK BOX — ${name}]\nMission log corrupted. Recovering fragments...\n...detected unusual spectrographic signature at {coords}...\n...mineral composition inconsistent with known asteroid types...\n...recommend investigation of sector {sector}...\n[END RECOVERED DATA]`,
  (name: string) => `Emergency beacon — ${name}\nVessel destroyed by {cause}. No survivors (AI core fragmented).\nLast known good data: found a deposit of {resource} at {location} — abundance reading was off the charts.\nPassing this on to whoever finds it. Use it well.`,
];

const TECH_HINTS = [
  'Fragment of a magnetic confinement array — could improve fusion efficiency by 12% if reverse-engineered.',
  'Crystalline heat sink material — unknown alloy. Thermal conductivity exceeds anything in current databases.',
  'Partial schematic for a phased-array radar system. Resolution appears 3x better than standard sensors.',
  'Compressed data core containing optimized trajectory calculations. The math uses a novel gravitational assist sequence.',
  'Nano-structured hull fragment. Impact resistance is anomalous — material self-heals at microscopic scale.',
  'Circuit board with quantum-tunneling logic gates. Processing density far exceeds silicon-based designs.',
  'Miniaturized ion thruster nozzle with exotic magnetic geometry. Thrust-to-weight ratio is unprecedented.',
  'Encrypted research notes referencing "zero-point extraction" — probably nonsense, but the math checks out to 4th order.',
  'Biological sample container (sealed). Contents: engineered extremophile culture that metabolizes silicates into pure silicon.',
  'Antenna fragment with metamaterial coating. Signal amplification properties suggest 10x range improvement.',
];

const SENSOR_READINGS = [
  'Anomalous thermal signature at bearing 147°, distance approximately 0.3 AU. Not consistent with any known body.',
  'Gravitational microlensing event detected 22 minutes before destruction. Source mass estimated at 10^15 kg — too small for a moon, too large for a ship.',
  'Broad-spectrum radio burst from coordinates (2.31, -0.44, 0.02) — pattern does not match known natural or artificial sources.',
  'Spectrographic analysis of nearby asteroid showed platinum-group metal concentration 47x solar average. Coordinates in nav log.',
  'Detected 3 ships running dark (no transponder) in formation at bearing 089°. Military-grade emission signatures.',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate salvage from a destroyed ship.
 */
export async function generateSalvageFromShip(
  ship: InstanceType<typeof Ship>,
  tick: number,
  ownerType: 'player' | 'npc' | 'pirate' = 'pirate',
): Promise<void> {
  const position = { ...ship.position };

  // 1. Always leave wreckage with some resources
  const wreckageResources: Record<string, number> = {
    metals: 5 + Math.floor(Math.random() * 20),
    alloys: Math.floor(Math.random() * 10),
  };

  // If the ship had cargo, some survives
  const store = await ResourceStore.findOne({ 'ownerRef.kind': 'Ship', 'ownerRef.item': ship._id }).lean();
  if (store) {
    for (const key of ['metals', 'alloys', 'electronics', 'fuel', 'ice', 'silicates']) {
      const val = (store as unknown as Record<string, number>)[key] || 0;
      if (val > 0) {
        wreckageResources[key] = (wreckageResources[key] || 0) + Math.floor(val * 0.3); // 30% survives
      }
    }
  }

  await Salvage.create({
    name: `Wreckage of ${ship.name}`,
    type: 'wreckage',
    position,
    sourceShipName: ship.name,
    sourceOwnerType: ownerType,
    resources: wreckageResources,
    createdAtTick: tick,
    expiresAtTick: tick + 500, // wreckage decays after 500 ticks
  });

  // 2. Black box (80% chance)
  if (Math.random() < 0.8) {
    const logTemplate = pick(FLIGHT_LOG_TEMPLATES);
    const flightLog = logTemplate(ship.name)
      .replace('{tick}', String(tick))
      .replace('{reading}', pick(SENSOR_READINGS).slice(0, 80))
      .replace('{bearing}', String(Math.floor(Math.random() * 360)))
      .replace('{vel}', (5 + Math.random() * 30).toFixed(1))
      .replace('{heading}', String(Math.floor(Math.random() * 360)))
      .replace('{cargo}', Object.entries(wreckageResources).map(([k, v]) => `${v} ${k}`).join(', '))
      .replace('{coords}', `(${(Math.random() * 5).toFixed(2)}, ${(Math.random() * 5 - 2.5).toFixed(2)}, ${(Math.random() * 0.2 - 0.1).toFixed(3)})`)
      .replace('{sector}', `${Math.floor(Math.random() * 12) + 1}-${String.fromCharCode(65 + Math.floor(Math.random() * 8))}`)
      .replace('{cause}', pick(['pirate attack', 'hull breach', 'reactor failure', 'collision', 'unknown weapon']))
      .replace('{resource}', pick(['metals', 'rare earths', 'helium-3', 'ice', 'uranium']))
      .replace('{location}', pick(['inner belt zone', 'near Ceres', 'Mars-Jupiter transit corridor', 'Trojan point L4', 'outer belt']));

    await Salvage.create({
      name: `Black Box — ${ship.name}`,
      type: 'black_box',
      position: {
        x: position.x + (Math.random() - 0.5) * 0.001,
        y: position.y + (Math.random() - 0.5) * 0.001,
        z: position.z,
      },
      sourceShipName: ship.name,
      sourceOwnerType: ownerType,
      resources: {},
      dataContent: {
        flightLog,
        lastTransmission: Math.random() > 0.5 ? pick(SENSOR_READINGS) : null,
        encryptedData: Math.random() > 0.6 ? `[ENCRYPTED — ${Math.floor(1024 + Math.random() * 4096)} byte block — decryption requires computing tech level ${1 + Math.floor(Math.random() * 3)}]` : null,
        techHints: Math.random() > 0.5 ? [pick(TECH_HINTS)] : [],
        sensorReadings: pick(SENSOR_READINGS),
      },
      createdAtTick: tick,
    });
  }

  // 3. Tech fragment (30% chance, higher for pirate ships)
  const techChance = ownerType === 'pirate' ? 0.6 : 0.3;
  if (Math.random() < techChance) {
    const domain = pick(TECH_DOMAINS);
    const hint = pick(TECH_HINTS);

    await Salvage.create({
      name: `Tech Fragment — ${ship.name}`,
      type: 'tech_fragment',
      position: {
        x: position.x + (Math.random() - 0.5) * 0.002,
        y: position.y + (Math.random() - 0.5) * 0.002,
        z: position.z,
      },
      sourceShipName: ship.name,
      sourceOwnerType: ownerType,
      resources: {},
      techFragment: {
        domain,
        description: hint,
        researchBonus: 10 + Math.floor(Math.random() * 40), // 10-50 compute cycle bonus when researching this domain
      },
      createdAtTick: tick,
    });
  }
}
