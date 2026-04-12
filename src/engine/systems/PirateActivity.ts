import { Ship, Replicant, MemoryLog, Message, Tick, ResourceStore } from '../../db/models/index.js';
import { distance } from '../../shared/physics.js';
import { nanoid } from 'nanoid';

const PIRATE_OWNER_ID = '000000000000000000000001'; // sentinel for pirate ships

const PIRATE_NAMES = [
  'Void Reaper', 'Dust Runner', 'Shadow of Ceres', 'Iron Fang',
  'Black Albedo', 'Perihelion Raider', 'Trojan Specter', 'Red Shift',
  'Kuiper Ghost', 'Belt Shark', 'Debris Wolf', 'Dark Transit',
  'Orbital Jackal', 'Slag Witch', 'The Scavenger',
];

const PIRATE_TAUNTS = [
  'Drop your cargo or we drop your hull integrity. Your choice.',
  'Interesting ship. Be a shame if something happened to it.',
  'We noticed you\'re carrying some nice alloys. We\'d like to negotiate... aggressively.',
  'This is a toll zone. Payment is 30% of your cargo. Non-negotiable.',
  'Our sensors say you\'re alone out here. So are we. Funny how that works.',
];

/**
 * Spawn pirate ships in belt zones and deep space.
 * Pirates appear where there's less human military presence.
 */
export async function ensurePiratePresence(tick: number): Promise<number> {
  // Only check every 20 ticks
  if (tick % 20 !== 0) return 0;

  const existingPirates = await Ship.countDocuments({
    ownerId: PIRATE_OWNER_ID,
    status: { $ne: 'destroyed' },
  });

  // Max 5 pirate ships in the system
  if (existingPirates >= 5) return 0;

  // Spawn in belt zones or random deep space
  const spawnLocations = [
    { x: 2.5 + (Math.random() - 0.5), y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 0.2 }, // inner belt
    { x: 3.2 + (Math.random() - 0.5), y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 0.2 }, // outer belt
    { x: 1.5 + (Math.random() - 0.5), y: (Math.random() - 0.5), z: 0 }, // Mars region
  ];

  const pos = spawnLocations[Math.floor(Math.random() * spawnLocations.length)];
  const pirateName = PIRATE_NAMES[Math.floor(Math.random() * PIRATE_NAMES.length)] + `-${nanoid(3)}`;

  await Ship.create({
    name: pirateName,
    ownerId: PIRATE_OWNER_ID,
    type: 'warship',
    status: 'orbiting',
    position: pos,
    orbitingBodyId: null,
    specs: {
      hullPoints: 80 + Math.floor(Math.random() * 120),
      maxHullPoints: 200,
      maxSpeed: 0.003 + Math.random() * 0.002,
      cargoCapacity: 200,
      fuelCapacity: 150,
      sensorRange: 0.8,
      miningRate: 0,
      combatPower: 3 + Math.floor(Math.random() * 5),
      manufacturingRate: 0,
    },
    fuel: 150,
    createdAtTick: tick,
  });

  return 1;
}

/**
 * Simulate pirate behavior each tick.
 * Pirates hunt for nearby player ships, threaten them, and potentially attack.
 */
export async function simulatePirates(tick: number): Promise<string[]> {
  // Only act every 3 ticks
  if (tick % 3 !== 0) return [];

  const pirates = await Ship.find({
    ownerId: PIRATE_OWNER_ID,
    status: { $in: ['orbiting', 'in_transit'] },
  });

  const logs: string[] = [];

  for (const pirate of pirates) {
    if (pirate.status === 'in_transit') continue;

    // Find nearby player ships
    const nearbyShips = await Ship.find({
      ownerId: { $nin: [PIRATE_OWNER_ID, '000000000000000000000000'] },
      status: { $in: ['orbiting', 'in_transit'] },
    });

    let closestShip: typeof nearbyShips[0] | null = null;
    let closestDist = Infinity;

    for (const target of nearbyShips) {
      const d = distance(pirate.position, target.position);
      if (d < closestDist && d < pirate.specs.sensorRange) {
        closestDist = d;
        closestShip = target;
      }
    }

    if (!closestShip) {
      // No targets — drift toward a random belt zone position
      if (Math.random() < 0.1) {
        const driftTarget = {
          x: pirate.position.x + (Math.random() - 0.5) * 0.5,
          y: pirate.position.y + (Math.random() - 0.5) * 0.5,
          z: pirate.position.z + (Math.random() - 0.5) * 0.05,
        };
        pirate.position = driftTarget;
        await pirate.save();
      }
      continue;
    }

    // Found a target — decide action
    const action = Math.random();
    const ownerId = closestShip.ownerId.toString();

    if (closestDist < 0.01) {
      // Close enough to interact
      if (action < 0.3) {
        // Attack — deal damage
        const damage = pirate.specs.combatPower * (0.5 + Math.random());
        closestShip.specs.hullPoints = Math.max(0, closestShip.specs.hullPoints - damage);

        if (closestShip.specs.hullPoints <= 0) {
          closestShip.status = 'destroyed';

          // Pirate loots some cargo
          const victimStore = await ResourceStore.findOne({
            'ownerRef.kind': 'Ship', 'ownerRef.item': closestShip._id,
          });
          if (victimStore) {
            // Take half of everything
            const storeAny = victimStore as unknown as Record<string, number>;
            for (const key of ['metals', 'alloys', 'fuel', 'electronics', 'ice']) {
              if (storeAny[key] > 0) {
                storeAny[key] = Math.floor(storeAny[key] / 2);
              }
            }
            await victimStore.save();
          }
        }

        await closestShip.save();

        const desc = `Pirate vessel ${pirate.name} attacked ${closestShip.name}! ${damage.toFixed(1)} damage dealt. ${closestShip.specs.hullPoints <= 0 ? 'SHIP DESTROYED. Cargo looted.' : `Hull at ${closestShip.specs.hullPoints.toFixed(0)}/${closestShip.specs.maxHullPoints}.`}`;

        await logToReplicant(ownerId, 'PIRATE ATTACK', desc, tick, ['pirate', 'attack', 'combat']);
        logs.push(desc);

      } else if (action < 0.7) {
        // Threaten — send intimidating message
        const taunt = PIRATE_TAUNTS[Math.floor(Math.random() * PIRATE_TAUNTS.length)];

        await Message.create({
          senderId: ownerId, recipientId: ownerId,
          subject: `Transmission from ${pirate.name}`,
          body: taunt,
          metadata: { type: 'pirate_threat', pirateShip: pirate.name, pirateCombatPower: pirate.specs.combatPower },
          senderPosition: pirate.position,
          recipientPosition: closestShip.position,
          distanceAU: closestDist,
          sentAtTick: tick, deliverAtTick: tick, delivered: true,
        });

        logs.push(`${pirate.name} threatens ${closestShip.name}`);
      }
      // else: pirate decides to leave this one alone
    } else {
      // Pursue — move toward target
      const dir = {
        x: closestShip.position.x - pirate.position.x,
        y: closestShip.position.y - pirate.position.y,
        z: closestShip.position.z - pirate.position.z,
      };
      const mag = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
      if (mag > 0) {
        const step = Math.min(pirate.specs.maxSpeed, mag);
        pirate.position = {
          x: pirate.position.x + (dir.x / mag) * step,
          y: pirate.position.y + (dir.y / mag) * step,
          z: pirate.position.z + (dir.z / mag) * step,
        };
        await pirate.save();
      }
    }
  }

  return logs;
}

async function logToReplicant(replicantId: string, title: string, content: string, tick: number, tags: string[]): Promise<void> {
  await MemoryLog.create({
    replicantId, category: 'log', title, content,
    tags: ['event', 'auto', ...tags], tick,
  });
}

/**
 * Combined pirate tick processing.
 */
export async function processPirateActivity(tick: number): Promise<string[]> {
  await ensurePiratePresence(tick);
  return simulatePirates(tick);
}
