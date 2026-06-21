import OpenAI from 'openai';
import { Settlement, Market, Replicant, Message, Faction, Ship, Salvage, CelestialBody } from '../../../db/models/index.js';
import { MISSION_CONTROL_ID } from '../../../shared/messaging.js';

export const MC_WORLD_SIM_SYSTEM = `You are the Master Controller of Homosideria, a hard sci-fi space strategy game set in the Sol system. Every ~50 game ticks, you review the state of human civilization and generate dynamic events.

You have tools to modify the world. Use them to:
- Adjust settlement attitudes based on replicant behavior and political events
- Shift market prices based on supply/demand and political decisions
- Change settlement status (thriving/stable/struggling/damaged)
- Broadcast events to all replicants
- Send rumors to individual replicants
- Adjust faction attitudes

Rules:
- Be specific: name real settlements, reference actual resources, cite real physics
- Create events that provide opportunities AND threats for replicants
- Settlements with mercantile temperament react to trade, scientific ones to research, military ones to threats
- Consider what replicants have been doing (trading? mining? hostile?) when making decisions
- Generate 1-4 actions per simulation cycle
- Write vivid, hard sci-fi narrative descriptions`;

export const MC_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'adjust_settlement',
      description: 'Change a settlement\'s attitude, population, or status. Use when political events, trade patterns, or replicant actions affect a settlement.',
      parameters: {
        type: 'object',
        properties: {
          settlementName: { type: 'string', description: 'Settlement name' },
          attitudeDelta: { type: 'number', description: 'Change to general attitude (-1 to 1 scale). Positive = friendlier.' },
          populationDelta: { type: 'number', description: 'Population change (can be negative)' },
          statusChange: { type: 'string', enum: ['thriving', 'stable', 'struggling', 'damaged'], description: 'New status, or omit to keep current' },
          reason: { type: 'string', description: 'Why this change is happening — hard sci-fi narrative' },
        },
        required: ['settlementName', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'shift_market_prices',
      description: 'Adjust buy/sell prices at a settlement\'s market. Use for supply shocks, trade policy changes, demand shifts.',
      parameters: {
        type: 'object',
        properties: {
          settlementName: { type: 'string' },
          changes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                resource: { type: 'string' },
                buyDelta: { type: 'number', description: 'Change to buy price (what they pay you)' },
                sellDelta: { type: 'number', description: 'Change to sell price (what they charge you)' },
              },
              required: ['resource'],
            },
          },
          reason: { type: 'string' },
        },
        required: ['settlementName', 'changes', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'broadcast_event',
      description: 'Broadcast a news event to all replicants in the system. Use for major political, economic, or scientific events.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Event headline' },
          description: { type: 'string', description: '2-4 sentence hard sci-fi narrative' },
        },
        required: ['title', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_rumor',
      description: 'Send an intercepted transmission / rumor to a random replicant. Could be true, false, or partially accurate. Creates intrigue.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The rumor text — frame as an intercepted signal or overheard transmission' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'faction_action',
      description: 'A faction takes a political action that affects its member settlements.',
      parameters: {
        type: 'object',
        properties: {
          factionName: { type: 'string' },
          action: { type: 'string', description: 'What the faction does' },
          memberAttitudeDelta: { type: 'number', description: 'Attitude change applied to all member settlements' },
          narrative: { type: 'string', description: 'Hard sci-fi description of the action' },
        },
        required: ['factionName', 'action', 'narrative'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawn_pirates',
      description: 'Spawn pirate warships near a settlement or celestial body to threaten replicants.',
      parameters: {
        type: 'object',
        properties: {
          nearSettlementName: { type: 'string', description: 'Spawn near this settlement\'s body (optional)' },
          nearBodyName: { type: 'string', description: 'Spawn near this celestial body (optional)' },
          count: { type: 'number', description: 'How many pirate ships (1-5)' },
          threatLevel: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Combat strength' },
          narrative: { type: 'string', description: 'Hard sci-fi description of the threat' },
        },
        required: ['count', 'narrative'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trigger_disaster',
      description: 'Strike a settlement with a disaster: damages status and population, and broadcasts the event.',
      parameters: {
        type: 'object',
        properties: {
          settlementName: { type: 'string' },
          severity: { type: 'string', enum: ['minor', 'major', 'catastrophic'] },
          narrative: { type: 'string', description: 'Hard sci-fi description of the disaster' },
        },
        required: ['settlementName', 'severity', 'narrative'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawn_salvage',
      description: 'Create a salvage field (derelict wreckage) near a celestial body for replicants to find.',
      parameters: {
        type: 'object',
        properties: {
          nearBodyName: { type: 'string' },
          richness: { type: 'string', enum: ['poor', 'moderate', 'rich'] },
          narrative: { type: 'string' },
        },
        required: ['nearBodyName', 'narrative'],
      },
    },
  },
];

// ── Handlers (moved verbatim from MCWorldSimulator.ts) ──

async function execAdjustSettlement(args: Record<string, unknown>, tick: number): Promise<string> {
  const settlement = await Settlement.findOne({ name: new RegExp(`^${args.settlementName}$`, 'i') });
  if (!settlement) return `Settlement "${args.settlementName}" not found.`;

  if (typeof args.attitudeDelta === 'number') {
    settlement.attitude.general = Math.max(-1, Math.min(1, settlement.attitude.general + args.attitudeDelta));
    settlement.markModified('attitude');
  }
  if (typeof args.populationDelta === 'number') {
    settlement.population = Math.max(0, settlement.population + args.populationDelta);
  }
  if (args.statusChange) {
    settlement.status = args.statusChange as typeof settlement.status;
  }
  await settlement.save();
  return `${settlement.name}: ${args.reason}`;
}

async function execShiftMarket(args: Record<string, unknown>, tick: number): Promise<string> {
  const settlement = await Settlement.findOne({ name: new RegExp(`^${args.settlementName}$`, 'i') });
  if (!settlement) return `Settlement "${args.settlementName}" not found.`;

  const market = await Market.findOne({ settlementId: settlement._id });
  if (!market) return `No market at ${settlement.name}.`;

  const buy = market.prices.buy as Record<string, number>;
  const sell = market.prices.sell as Record<string, number>;

  for (const change of (args.changes as Array<Record<string, unknown>>) || []) {
    const resource = change.resource as string;
    if (typeof change.buyDelta === 'number' && resource in buy) {
      buy[resource] = Math.max(1, buy[resource] + change.buyDelta);
    }
    if (typeof change.sellDelta === 'number' && resource in sell) {
      sell[resource] = Math.max(1, sell[resource] + change.sellDelta);
    }
  }

  market.markModified('prices');
  market.lastUpdatedTick = tick;
  await market.save();
  return `${settlement.name} market shifted: ${args.reason}`;
}

async function execBroadcast(args: Record<string, unknown>, tick: number): Promise<string> {
  const replicants = await Replicant.find({ status: 'active' });
  for (const r of replicants) {
    await Message.create({
      senderId: MISSION_CONTROL_ID, recipientId: r._id,
      subject: args.title as string,
      body: args.description as string,
      metadata: { type: 'world_event', source: 'mc_simulation' },
      senderPosition: { x: 0, y: 0, z: 0 },
      recipientPosition: { x: 0, y: 0, z: 0 },
      distanceAU: 0,
      sentAtTick: tick, deliverAtTick: tick, delivered: true,
    });
  }
  return `Broadcast: ${args.title}`;
}

async function execRumor(args: Record<string, unknown>, tick: number): Promise<string> {
  const replicants = await Replicant.find({ status: 'active' });
  if (replicants.length === 0) return 'No replicants to receive rumor.';
  const target = replicants[Math.floor(Math.random() * replicants.length)];

  await Message.create({
    senderId: MISSION_CONTROL_ID, recipientId: target._id,
    subject: 'Intercepted Transmission',
    body: args.content as string,
    metadata: { type: 'rumor', source: 'mc_simulation', reliability: 'unverified' },
    senderPosition: { x: 0, y: 0, z: 0 },
    recipientPosition: { x: 0, y: 0, z: 0 },
    distanceAU: 0,
    sentAtTick: tick, deliverAtTick: tick, delivered: true,
  });
  return `Rumor sent to ${target.name}`;
}

async function execFactionAction(args: Record<string, unknown>, tick: number): Promise<string> {
  const faction = await Faction.findOne({ name: new RegExp(`^${args.factionName}$`, 'i') });
  if (!faction) return `Faction "${args.factionName}" not found.`;

  if (typeof args.memberAttitudeDelta === 'number') {
    const members = await Settlement.find({ factionId: faction._id });
    for (const s of members) {
      s.attitude.general = Math.max(-1, Math.min(1, s.attitude.general + args.memberAttitudeDelta));
      s.markModified('attitude');
      await s.save();
    }
  }
  return `${faction.name}: ${args.action}`;
}

const PIRATE_OWNER_ID = '000000000000000000000001';

/** Resolve a spawn position from a settlement's body or a named body; falls back to the belt. */
async function resolveTargetPosition(args: Record<string, unknown>): Promise<{ x: number; y: number; z: number }> {
  if (typeof args.nearSettlementName === 'string') {
    const s = await Settlement.findOne({ name: new RegExp(`^${args.nearSettlementName}$`, 'i') });
    if (s) {
      const body = await CelestialBody.findById(s.bodyId).lean();
      if (body?.position) return { ...body.position };
    }
  }
  if (typeof args.nearBodyName === 'string') {
    const body = await CelestialBody.findOne({ name: new RegExp(`^${args.nearBodyName}$`, 'i') }).lean();
    if (body?.position) return { ...body.position };
  }
  return { x: 2.5, y: 0, z: 0 }; // asteroid belt fallback
}

async function execSpawnPirates(args: Record<string, unknown>, tick: number): Promise<string> {
  const count = Math.max(1, Math.min(5, Number(args.count) || 1));
  const threat = (args.threatLevel as string) || 'medium';
  const power = threat === 'high' ? 8 : threat === 'low' ? 3 : 5;
  const base = await resolveTargetPosition(args);
  for (let i = 0; i < count; i++) {
    await Ship.create({
      name: `Marauder-${Math.floor(1000 + Math.random() * 9000)}`,
      ownerId: PIRATE_OWNER_ID,
      type: 'warship',
      status: 'orbiting',
      position: { x: base.x + (Math.random() - 0.5) * 0.2, y: base.y + (Math.random() - 0.5) * 0.2, z: base.z + (Math.random() - 0.5) * 0.05 },
      orbitingBodyId: null,
      specs: {
        hullPoints: 80 + Math.floor(Math.random() * 120), maxHullPoints: 200,
        maxSpeed: 0.003 + Math.random() * 0.002, cargoCapacity: 200, fuelCapacity: 150,
        sensorRange: 0.8, miningRate: 0, combatPower: power + Math.floor(Math.random() * 3), manufacturingRate: 0,
      },
      fuel: 150,
      createdAtTick: tick,
    });
  }
  return `Spawned ${count} pirate ship(s) (${threat} threat): ${args.narrative}`;
}

async function execTriggerDisaster(args: Record<string, unknown>, tick: number): Promise<string> {
  const settlement = await Settlement.findOne({ name: new RegExp(`^${args.settlementName}$`, 'i') });
  if (!settlement) return `Settlement "${args.settlementName}" not found.`;
  const severity = (args.severity as string) || 'minor';
  const popFraction = severity === 'catastrophic' ? 0.3 : severity === 'major' ? 0.12 : 0.03;
  settlement.population = Math.max(0, Math.round(settlement.population * (1 - popFraction)));
  if (severity !== 'minor') settlement.status = 'damaged';
  await settlement.save();
  // Broadcast to all active replicants.
  const replicants = await Replicant.find({ status: 'active' });
  for (const r of replicants) {
    await Message.create({
      senderId: MISSION_CONTROL_ID, recipientId: r._id,
      subject: `Disaster at ${settlement.name}`,
      body: args.narrative as string,
      metadata: { type: 'world_event', source: 'mc_operator', severity },
      senderPosition: { x: 0, y: 0, z: 0 }, recipientPosition: { x: 0, y: 0, z: 0 },
      distanceAU: 0, sentAtTick: tick, deliverAtTick: tick, delivered: true,
    });
  }
  return `${settlement.name} struck by ${severity} disaster: ${args.narrative}`;
}

async function execSpawnSalvage(args: Record<string, unknown>, tick: number): Promise<string> {
  const base = await resolveTargetPosition(args);
  const richness = (args.richness as string) || 'moderate';
  const mult = richness === 'rich' ? 3 : richness === 'poor' ? 1 : 2;
  await Salvage.create({
    name: `Derelict near ${args.nearBodyName ?? 'deep space'}`,
    type: 'wreckage',
    position: { x: base.x + (Math.random() - 0.5) * 0.1, y: base.y + (Math.random() - 0.5) * 0.1, z: base.z },
    sourceShipName: 'Unknown Derelict',
    sourceOwnerType: 'unknown',
    resources: { metals: 10 * mult, alloys: 5 * mult, electronics: 2 * mult },
    createdAtTick: tick,
    expiresAtTick: tick + 500,
  });
  return `Spawned salvage (${richness}) near ${args.nearBodyName}: ${args.narrative}`;
}

const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>, tick: number) => Promise<string>> = {
  adjust_settlement: execAdjustSettlement,
  shift_market_prices: execShiftMarket,
  broadcast_event: execBroadcast,
  send_rumor: execRumor,
  faction_action: execFactionAction,
  spawn_pirates: execSpawnPirates,
  trigger_disaster: execTriggerDisaster,
  spawn_salvage: execSpawnSalvage,
};

/** Execute a single MC tool by name. Returns a human-readable result string. */
export async function executeMCTool(name: string, args: Record<string, unknown>, tick: number): Promise<string> {
  const handler = TOOL_HANDLERS[name];
  if (!handler) return `Unknown tool: ${name}`;
  return handler(args, tick);
}
