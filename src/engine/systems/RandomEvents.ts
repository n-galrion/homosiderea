import {
  Ship, Replicant, Settlement, Asteroid, CelestialBody,
  MemoryLog, Message, Tick,
} from '../../db/models/index.js';
import { distance } from '../../shared/physics.js';

interface GameEvent {
  name: string;
  weight: number;
  minTick: number;
  check: (tick: number) => Promise<boolean>;
  execute: (tick: number) => Promise<string[]>;
}

/**
 * Process random events each tick. Returns log entries.
 */
export async function processRandomEvents(tick: number): Promise<string[]> {
  const logs: string[] = [];

  for (const event of EVENTS) {
    if (tick < event.minTick) continue;
    if (Math.random() > event.weight) continue;
    if (!await event.check(tick)) continue;

    try {
      const entries = await event.execute(tick);
      logs.push(...entries);
    } catch (err) {
      logs.push(`Event "${event.name}" error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return logs;
}

// ── Helper: log to a replicant's captain's log ──────────────────
async function logToReplicant(replicantId: string, title: string, content: string, tick: number, tags: string[]): Promise<void> {
  await MemoryLog.create({
    replicantId,
    category: 'log',
    title,
    content,
    tags: ['event', 'auto', ...tags],
    tick,
  });
}

// ── Helper: send anonymous signal message ──────────────────
async function sendSignal(recipientId: string, subject: string, body: string, tick: number, metadata: Record<string, unknown> = {}): Promise<void> {
  // Signal comes from "nowhere" — senderId is the recipient (system message)
  await Message.create({
    senderId: recipientId,
    recipientId,
    subject,
    body,
    metadata: { type: 'system_event', ...metadata },
    senderPosition: { x: 0, y: 0, z: 0 },
    recipientPosition: { x: 0, y: 0, z: 0 },
    distanceAU: 0,
    sentAtTick: tick,
    deliverAtTick: tick, // instant delivery for system events
    delivered: true,
  });
}

// ── Events ──────────────────────────────────────────────────

const EVENTS: GameEvent[] = [

  // ── Micrometeorite Impact ──────────────────────────────
  {
    name: 'micrometeorite_impact',
    weight: 0.08, // 8% chance per tick
    minTick: 3,
    async check() { return true; },
    async execute(tick) {
      const ships = await Ship.find({ status: { $in: ['orbiting', 'in_transit'] } });
      if (ships.length === 0) return [];

      const target = ships[Math.floor(Math.random() * ships.length)];
      const damage = 0.5 + Math.random() * 2.5; // 0.5 - 3.0 HP
      target.specs.hullPoints = Math.max(0, target.specs.hullPoints - damage);

      if (target.specs.hullPoints <= 0) {
        target.status = 'destroyed';
      }
      await target.save();

      const desc = `Micrometeorite impact detected on ${target.name}. A grain-of-sand-sized particle travelling at ${(15 + Math.random() * 45).toFixed(1)} km/s struck the ${['port hull plating', 'starboard sensor array housing', 'forward thermal shielding', 'aft engine cowling', 'ventral cargo bay panel'][Math.floor(Math.random() * 5)]}. Hull integrity reduced by ${damage.toFixed(1)} points to ${target.specs.hullPoints.toFixed(1)}/${target.specs.maxHullPoints}.`;

      await logToReplicant(target.ownerId.toString(), 'Micrometeorite Impact', desc, tick, ['damage', 'micrometeorite']);

      return [desc];
    },
  },

  // ── Stray Signal ──────────────────────────────────────
  {
    name: 'stray_signal',
    weight: 0.05, // 5% per tick
    minTick: 5,
    async check() {
      return (await Replicant.countDocuments({ status: 'active' })) > 0;
    },
    async execute(tick) {
      const replicants = await Replicant.find({ status: 'active' });
      if (replicants.length === 0) return [];

      const target = replicants[Math.floor(Math.random() * replicants.length)];

      const signals = [
        {
          subject: 'Unknown Signal — Repeating Pattern',
          body: `Your comms array has picked up a faint, repeating signal on a non-standard frequency (${(1420 + Math.random() * 200).toFixed(1)} MHz). The pattern is mathematical — a sequence of primes followed by what appears to be a coordinate encoding. Origin bearing: ${(Math.random() * 360).toFixed(1)}° ecliptic, estimated distance ${(2 + Math.random() * 30).toFixed(1)} AU. The signal is ${Math.random() > 0.5 ? 'degrading rapidly' : 'steady but extremely weak'}. It could be an artifact, another replicant's beacon, or something else entirely.`,
          tags: ['signal', 'unknown', 'mystery'],
          metadata: { signalType: 'repeating_prime_sequence', frequency: 1420 + Math.random() * 200 },
        },
        {
          subject: 'Distress Beacon Detected',
          body: `Emergency distress beacon detected on standard frequency 2182 kHz. The signal identifies as ${['civilian transport "Wanderlust"', 'research vessel "Kepler\'s Dream"', 'mining barge "Deep Pocket"', 'unregistered vessel — no transponder ID'][Math.floor(Math.random() * 4)]}. Position encoded in the burst places it approximately ${(0.5 + Math.random() * 5).toFixed(2)} AU from your current location. The beacon is ${Math.random() > 0.3 ? 'automated — no voice transmission detected' : 'accompanied by a faint voice loop, badly degraded by interference'}. Responding is optional. The signal will expire in approximately ${Math.floor(10 + Math.random() * 50)} ticks.`,
          tags: ['signal', 'distress', 'beacon'],
          metadata: { signalType: 'distress_beacon', urgent: true },
        },
        {
          subject: 'Encrypted Transmission Intercepted',
          body: `Your passive antenna array intercepted a tightly-beamed encrypted transmission passing through your sensor envelope. The encryption is ${Math.random() > 0.5 ? 'military-grade AES-512 — unbreakable without the key' : 'commercial-grade — potentially decryptable with sufficient compute cycles'}. Transmission duration: ${(0.5 + Math.random() * 3).toFixed(1)} seconds. Origin and destination unknown. The beam geometry suggests it was aimed between two points ${(1 + Math.random() * 10).toFixed(1)} AU apart. Someone is communicating, and they don't want to be overheard.`,
          tags: ['signal', 'encrypted', 'intercept'],
          metadata: { signalType: 'encrypted_intercept', decryptable: Math.random() > 0.5 },
        },
        {
          subject: 'Solar Flare Warning',
          body: `Sol has emitted a Class ${['M', 'M', 'X', 'X'][Math.floor(Math.random() * 4)]}${(1 + Math.random() * 9).toFixed(1)} solar flare. The coronal mass ejection is propagating outward at ${(400 + Math.random() * 2000).toFixed(0)} km/s. Estimated arrival at your position in ${Math.floor(2 + Math.random() * 20)} ticks. Recommend ${Math.random() > 0.5 ? 'sheltering behind a planetary body or activating radiation shielding' : 'powering down non-essential systems and retracting sensor arrays to minimize exposure'}. Expected radiation dose: ${(0.1 + Math.random() * 5).toFixed(2)} Sv equivalent.`,
          tags: ['solar', 'flare', 'warning', 'radiation'],
          metadata: { signalType: 'solar_flare_warning', severity: Math.random() > 0.5 ? 'high' : 'moderate' },
        },
        {
          subject: 'Anomalous Sensor Reading',
          body: `Spectrographic analysis of routine background scans has flagged an anomaly at bearing ${(Math.random() * 360).toFixed(1)}°, elevation ${(-15 + Math.random() * 30).toFixed(1)}°. The signature is consistent with ${['a metallic object approximately 50-200 meters in diameter, tumbling at 0.3 rpm — possibly debris or a derelict', 'an unusual concentration of organic compounds in a cometary trail — biochemically interesting if samples could be collected', 'a gravitational microlensing event — something massive passed between you and a background star, temporarily brightening it by 0.02 magnitudes', 'intermittent thermal emissions from a region of space with no catalogued objects — source unknown'][Math.floor(Math.random() * 4)]}. Further investigation would require maneuvering to within sensor range.`,
          tags: ['anomaly', 'sensor', 'investigation'],
          metadata: { signalType: 'anomaly', investigatable: true },
        },
      ];

      const signal = signals[Math.floor(Math.random() * signals.length)];

      await sendSignal(target._id.toString(), signal.subject, signal.body, tick, signal.metadata);
      await logToReplicant(target._id.toString(), signal.subject, signal.body, tick, signal.tags);

      return [`Signal event for ${target.name}: ${signal.subject}`];
    },
  },

  // ── Settlement News Broadcast ──────────────────────────
  {
    name: 'settlement_broadcast',
    weight: 0.03, // 3% per tick
    minTick: 10,
    async check() {
      return (await Settlement.countDocuments({ status: { $ne: 'destroyed' } })) > 0;
    },
    async execute(tick) {
      const settlements = await Settlement.find({ status: { $ne: 'destroyed' } });
      if (settlements.length === 0) return [];

      const settlement = settlements[Math.floor(Math.random() * settlements.length)];

      const broadcasts = [
        `${settlement.name} Broadcasting Service: "${settlement.nation} authorities announce a ${Math.random() > 0.5 ? 'new subsidy program for rare earth imports — prices adjusted favorably for incoming shipments' : 'temporary import tariff on processed alloys — traders advised to seek alternative markets for the next 20 ticks'}."`,
        `${settlement.name} Port Authority: "Spaceport traffic at ${settlement.name} is ${Math.random() > 0.5 ? 'heavy — expect docking delays of 2-3 ticks' : 'light — priority docking available for all registered vessels'}. Current fuel price: ${(10 + Math.random() * 20).toFixed(1)} credits/unit."`,
        `${settlement.name} Science Division: "The ${settlement.nation} Academy of Sciences reports ${['discovery of a new mineral phase in returned asteroid samples — implications for materials science', 'successful test of a prototype fusion micro-reactor — potential for civilian ship propulsion', 'concerning increase in solar wind density — deep space operators advised to monitor shielding', 'an open call for computational resources to model long-period comet trajectories'][Math.floor(Math.random() * 4)]}."`,
        `${settlement.name} Emergency Management: "${Math.random() > 0.7 ? `Elevated seismic activity detected in the ${settlement.name} region. Non-essential personnel advised to prepare for possible evacuation.` : `Air quality index in ${settlement.name} has returned to nominal levels after last week's industrial incident. All clear.`}"`,
      ];

      const broadcast = broadcasts[Math.floor(Math.random() * broadcasts.length)];

      // Send to all replicants near this body
      const replicants = await Replicant.find({ status: 'active' });
      let sent = 0;
      for (const r of replicants) {
        if (r.locationRef?.item) {
          const ship = await Ship.findById(r.locationRef.item).lean();
          if (ship?.orbitingBodyId?.toString() === settlement.bodyId.toString()) {
            await sendSignal(r._id.toString(), `${settlement.name} Broadcast`, broadcast, tick, { type: 'settlement_broadcast', settlement: settlement.name });
            sent++;
          }
        }
      }

      return sent > 0 ? [`${settlement.name} broadcast received by ${sent} replicant(s)`] : [];
    },
  },

  // ── Resource Discovery ──────────────────────────────────
  {
    name: 'resource_discovery',
    weight: 0.02, // 2% per tick
    minTick: 20,
    async check() { return true; },
    async execute(tick) {
      // A ship orbiting a body may discover a previously inaccessible resource
      const ships = await Ship.find({ status: 'orbiting', orbitingBodyId: { $ne: null } });
      if (ships.length === 0) return [];

      const ship = ships[Math.floor(Math.random() * ships.length)];
      const body = await CelestialBody.findById(ship.orbitingBodyId);
      if (!body) return [];

      // Find an inaccessible resource to make accessible, or add to remaining
      const inaccessible = body.resources.filter(r => !r.accessible && r.totalDeposit > 0);
      if (inaccessible.length > 0) {
        const resource = inaccessible[Math.floor(Math.random() * inaccessible.length)];
        resource.accessible = true;
        resource.remaining = Math.round(resource.totalDeposit * 0.3); // Partially accessible
        await body.save();

        const desc = `Passive seismic analysis of ${body.name}'s subsurface has revealed a previously unmapped ${resource.resourceType} deposit. Estimated yield: ${resource.remaining.toLocaleString()} units at ${(resource.abundance * 100).toFixed(0)}% concentration. The deposit appears to be accessible from the current orbital position.`;
        await logToReplicant(ship.ownerId.toString(), `Resource Discovery: ${resource.resourceType} on ${body.name}`, desc, tick, ['discovery', 'resource', body.name.toLowerCase()]);

        return [desc];
      }

      return [];
    },
  },

  // ── Attitude Shift from Earth Events ──────────────────
  {
    name: 'earth_political_event',
    weight: 0.01, // 1% per tick
    minTick: 50,
    async check() { return true; },
    async execute(tick) {
      const settlements = await Settlement.find({ status: { $ne: 'destroyed' } });
      if (settlements.length === 0) return [];

      const events = [
        { desc: 'The UN General Assembly has passed a resolution recognizing Replicant autonomy rights. Settlement attitudes improve globally.', attitudeDelta: 0.05 },
        { desc: 'Anti-AI protests sweep across major Earth cities after a manufacturing AI incident. Settlement attitudes toward Replicants cool.', attitudeDelta: -0.03 },
        { desc: 'A trade consortium between Luna and Mars settlements proposes standardized pricing for bulk ore transactions.', attitudeDelta: 0.02 },
        { desc: 'Territorial dispute between two national space agencies has resulted in a minor embargo. Some markets may see price fluctuations.', attitudeDelta: -0.01 },
        { desc: 'The International Space Commerce Authority has lowered tariffs on Replicant-supplied helium-3. Fusion fuel trade now more profitable.', attitudeDelta: 0.03 },
      ];

      const event = events[Math.floor(Math.random() * events.length)];

      for (const s of settlements) {
        s.attitude.general = Math.max(-1, Math.min(1, s.attitude.general + event.attitudeDelta));
        s.markModified('attitude');
        await s.save();
      }

      // Broadcast to all replicants
      const replicants = await Replicant.find({ status: 'active' });
      for (const r of replicants) {
        await sendSignal(r._id.toString(), 'System-Wide News', event.desc, tick, { type: 'political_event' });
      }

      return [`Political event: ${event.desc}`];
    },
  },
];
