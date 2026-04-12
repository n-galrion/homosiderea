import {
  Ship, Replicant, Settlement, CelestialBody,
  MemoryLog, Message,
} from '../../db/models/index.js';
import { distance } from '../../shared/physics.js';
import { generateContent } from './MCGenerator.js';

interface GameEvent {
  name: string;
  weight: number;
  minTick: number;
  check: (tick: number) => Promise<boolean>;
  execute: (tick: number) => Promise<string[]>;
}

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

async function logToReplicant(replicantId: string, title: string, content: string, tick: number, tags: string[]): Promise<void> {
  await MemoryLog.create({ replicantId, category: 'log', title, content, tags: ['event', 'auto', ...tags], tick });
}

async function sendSignal(recipientId: string, subject: string, body: string, tick: number, metadata: Record<string, unknown> = {}): Promise<void> {
  await Message.create({
    senderId: recipientId, recipientId, subject, body,
    metadata: { type: 'system_event', ...metadata },
    senderPosition: { x: 0, y: 0, z: 0 }, recipientPosition: { x: 0, y: 0, z: 0 },
    distanceAU: 0, sentAtTick: tick, deliverAtTick: tick, delivered: true,
  });
}

const EVENT_NARRATOR = `You are the narrator of Homosideria, a hard sci-fi space game. Write vivid, scientifically specific descriptions. Reference real physics. Include numbers, bearings, distances. Under 150 words.`;

const EVENTS: GameEvent[] = [

  // ── Micrometeorite Impact ──────────────────────────────
  {
    name: 'micrometeorite_impact',
    weight: 0.08,
    minTick: 3,
    async check() { return true; },
    async execute(tick) {
      const ships = await Ship.find({ status: { $in: ['orbiting', 'in_transit'] } });
      if (ships.length === 0) return [];

      const target = ships[Math.floor(Math.random() * ships.length)];
      const damage = 0.5 + Math.random() * 2.5;
      target.specs.hullPoints = Math.max(0, target.specs.hullPoints - damage);
      if (target.specs.hullPoints <= 0) target.status = 'destroyed';
      await target.save();

      const desc = await generateContent(
        EVENT_NARRATOR,
        `A micrometeorite hit the ship "${target.name}" at position (${target.position.x.toFixed(2)}, ${target.position.y.toFixed(2)}) AU. Damage: ${damage.toFixed(1)} HP. Hull now at ${target.specs.hullPoints.toFixed(1)}/${target.specs.maxHullPoints}. ${target.specs.hullPoints <= 0 ? 'The ship was destroyed.' : ''} Describe the impact — particle size, velocity, where it struck, what systems were affected. Be specific.`,
        `Micrometeorite impact on ${target.name}. A ${(0.1 + Math.random() * 2).toFixed(1)}mm ferrous particle at ${(15 + Math.random() * 45).toFixed(0)} km/s penetrated the hull plating. Damage: ${damage.toFixed(1)} HP. Hull at ${target.specs.hullPoints.toFixed(1)}/${target.specs.maxHullPoints}.`,
      );

      await logToReplicant(target.ownerId.toString(), 'Micrometeorite Impact', desc, tick, ['damage', 'micrometeorite']);
      return [desc];
    },
  },

  // ── Stray Signal ──────────────────────────────────────
  {
    name: 'stray_signal',
    weight: 0.05,
    minTick: 5,
    async check() { return (await Replicant.countDocuments({ status: 'active' })) > 0; },
    async execute(tick) {
      const replicants = await Replicant.find({ status: 'active' });
      if (replicants.length === 0) return [];
      const target = replicants[Math.floor(Math.random() * replicants.length)];

      const signalType = ['unknown_signal', 'distress_beacon', 'encrypted_intercept', 'solar_flare', 'anomaly'][Math.floor(Math.random() * 5)];

      const body = await generateContent(
        `${EVENT_NARRATOR} You are generating a "${signalType}" event for a Replicant's sensor array. Make it mysterious, specific, and potentially actionable — the Replicant should want to investigate. Include frequency, bearing, distance, and one detail that makes this signal unique.`,
        `Generate a ${signalType.replace(/_/g, ' ')} detected by replicant "${target.name}" at tick ${tick}. Their position is approximately (${Math.random() * 3 > 1.5 ? '1.0, 0.0' : '2.5, 0.3'}) AU. Make it intriguing.`,
        `Your sensors detected a ${signalType.replace(/_/g, ' ')} at bearing ${Math.floor(Math.random() * 360)}°, distance ${(0.5 + Math.random() * 10).toFixed(1)} AU. Signal characteristics are unusual. Further investigation recommended.`,
      );

      const subject = signalType === 'distress_beacon' ? 'Distress Beacon Detected'
        : signalType === 'solar_flare' ? 'Solar Flare Warning'
        : signalType === 'encrypted_intercept' ? 'Encrypted Transmission Intercepted'
        : signalType === 'anomaly' ? 'Anomalous Sensor Reading'
        : 'Unknown Signal Detected';

      await sendSignal(target._id.toString(), subject, body, tick, { signalType });
      await logToReplicant(target._id.toString(), subject, body, tick, ['signal', signalType]);
      return [`Signal event for ${target.name}: ${subject}`];
    },
  },

  // ── Settlement Broadcast ──────────────────────────────
  {
    name: 'settlement_broadcast',
    weight: 0.03,
    minTick: 10,
    async check() { return (await Settlement.countDocuments({ status: { $ne: 'destroyed' } })) > 0; },
    async execute(tick) {
      const settlements = await Settlement.find({ status: { $ne: 'destroyed' } });
      if (settlements.length === 0) return [];
      const settlement = settlements[Math.floor(Math.random() * settlements.length)];

      const broadcast = await generateContent(
        `You are a news broadcaster at ${settlement.name} (${settlement.nation}). Write a brief radio broadcast (2-3 sentences) about current events at your settlement. Your temperament is ${settlement.culture?.temperament || 'neutral'}. Your priorities are ${(settlement.culture?.priorities || []).join(', ')}. Your status is ${settlement.status}, population ${settlement.population.toLocaleString()}. Reference your leader ${settlement.leadership?.leaderName || 'the director'} if relevant. Stay in character as a human broadcaster.`,
        `Generate a news broadcast from ${settlement.name} at tick ${tick}. Make it relevant to the settlement's current situation and personality.`,
        `${settlement.name} Broadcasting: Normal operations continue. ${settlement.leadership?.leaderName || 'Leadership'} reports stable conditions. Markets open for standard trading hours.`,
      );

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
    weight: 0.02,
    minTick: 20,
    async check() { return true; },
    async execute(tick) {
      const ships = await Ship.find({ status: 'orbiting', orbitingBodyId: { $ne: null } });
      if (ships.length === 0) return [];
      const ship = ships[Math.floor(Math.random() * ships.length)];
      const body = await CelestialBody.findById(ship.orbitingBodyId);
      if (!body) return [];

      const inaccessible = body.resources.filter(r => !r.accessible && r.totalDeposit > 0);
      if (inaccessible.length === 0) return [];

      const resource = inaccessible[Math.floor(Math.random() * inaccessible.length)];
      resource.accessible = true;
      resource.remaining = Math.round(resource.totalDeposit * 0.3);
      await body.save();

      const desc = await generateContent(
        EVENT_NARRATOR,
        `Ship "${ship.name}" orbiting ${body.name} discovered a new ${resource.resourceType} deposit. Total: ${resource.remaining.toLocaleString()} units at ${(resource.abundance * 100).toFixed(0)}% concentration. Describe the geological discovery — what sensors detected it, what kind of formation it is, why it wasn't found before.`,
        `Passive seismic analysis of ${body.name}'s subsurface has revealed a ${resource.resourceType} deposit. Estimated yield: ${resource.remaining.toLocaleString()} units at ${(resource.abundance * 100).toFixed(0)}% concentration.`,
      );

      await logToReplicant(ship.ownerId.toString(), `Resource Discovery: ${resource.resourceType} on ${body.name}`, desc, tick, ['discovery', 'resource']);
      return [desc];
    },
  },

  // ── Political Event (MC-generated, no more static list) ──
  {
    name: 'political_event',
    weight: 0.01,
    minTick: 50,
    async check() { return true; },
    async execute(tick) {
      const settlements = await Settlement.find({ status: { $ne: 'destroyed' } });
      if (settlements.length === 0) return [];

      // Pick a settlement to be the focus
      const focus = settlements[Math.floor(Math.random() * settlements.length)];
      const isPositive = Math.random() > 0.4;
      const attitudeDelta = isPositive ? (0.02 + Math.random() * 0.05) : -(0.01 + Math.random() * 0.04);

      const desc = await generateContent(
        `You are a Sol system political analyst. Generate a brief (2-3 sentence) political event centered on ${focus.name} (${focus.nation}). The event should ${isPositive ? 'improve' : 'worsen'} attitudes toward Replicants. Reference the settlement's leader ${focus.leadership?.leaderName}, their government type (${focus.leadership?.governmentType}), and their priorities (${(focus.culture?.priorities || []).join(', ')}). Be specific about what happened and why.`,
        `Generate a political event at tick ${tick}. Focus settlement: ${focus.name}. Attitude change: ${attitudeDelta > 0 ? 'positive' : 'negative'}.`,
        `${isPositive ? 'Diplomatic progress' : 'Political tensions'} at ${focus.name}. ${focus.leadership?.leaderName || 'Leadership'} ${isPositive ? 'announces cooperation measures' : 'imposes new restrictions'} affecting Replicant operations.`,
      );

      for (const s of settlements) {
        s.attitude.general = Math.max(-1, Math.min(1, s.attitude.general + attitudeDelta));
        s.markModified('attitude');
        await s.save();
      }

      const replicants = await Replicant.find({ status: 'active' });
      for (const r of replicants) {
        await sendSignal(r._id.toString(), 'System-Wide News', desc, tick, { type: 'political_event' });
      }
      return [`Political event: ${desc.slice(0, 100)}...`];
    },
  },
];
