import OpenAI from 'openai';
import {
  Settlement, Market, Replicant, Ship, Faction, Message,
  MemoryLog, Colony, PriceHistory,
} from '../../db/models/index.js';
import { config } from '../../config.js';

const WORLD_SIM_SYSTEM = `You are the Master Controller of Homosideria, a hard sci-fi space strategy game set in the Sol system. Every ~50 game ticks, you review the state of human civilization and generate dynamic events.

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

const MC_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
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
];

// ── Tool execution ──────────────────────────────────────

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
      senderId: r._id, recipientId: r._id,
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
    senderId: target._id, recipientId: target._id,
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

const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>, tick: number) => Promise<string>> = {
  adjust_settlement: execAdjustSettlement,
  shift_market_prices: execShiftMarket,
  broadcast_event: execBroadcast,
  send_rumor: execRumor,
  faction_action: execFactionAction,
};

// ── Main simulation ──────────────────────────────────────

async function buildWorldSummary(tick: number): Promise<string> {
  const settlements = await Settlement.find({ status: { $ne: 'destroyed' } }).lean();
  const factions = await Faction.find().lean();
  const replicants = await Replicant.find({ status: 'active' }).lean();
  const colonies = await Colony.find({ status: { $ne: 'abandoned' } }).lean();

  const parts = [`## World State — Tick ${tick} (Game Hour ${tick})\n`];

  parts.push(`### Active Replicants (${replicants.length})`);
  for (const r of replicants) {
    const tech = Object.entries(r.techLevels as Record<string, number>).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(', ');
    parts.push(`  ${r.name}: compute=${r.computeCycles}, energy=${r.energyBudget}${tech ? `, tech=[${tech}]` : ''}`);
  }

  parts.push(`\n### Settlements (${settlements.length})`);
  for (const s of settlements) {
    parts.push(`  ${s.name} (${s.nation}, ${s.status}): pop=${s.population.toLocaleString()}, attitude=${s.attitude.general.toFixed(2)}, temperament=${s.culture?.temperament || '?'}, priorities=${(s.culture?.priorities || []).join('/')}`);
  }

  parts.push(`\n### Factions (${factions.length})`);
  for (const f of factions) {
    parts.push(`  ${f.name}: attitude=${f.attitude.general.toFixed(2)}, trade=${f.policies.tradeOpenness}, replicantTolerance=${f.policies.replicantTolerance}`);
  }

  if (colonies.length > 0) {
    parts.push(`\n### Replicant Colonies (${colonies.length})`);
    for (const c of colonies) parts.push(`  ${c.name}: ${c.status}, ${c.stats.structureCount} structures`);
  }

  return parts.join('\n');
}

/**
 * Run the MC World Simulator with tool calling.
 * The LLM reviews world state and uses tools to modify settlements,
 * shift markets, broadcast events, send rumors, and trigger faction actions.
 */
export async function simulateWorldWithMC(tick: number): Promise<string[]> {
  if (tick < 10 || tick % 50 !== 0) return [];
  if (!config.llm.apiKey) return [];

  const worldSummary = await buildWorldSummary(tick);
  const logs: string[] = [];

  try {
    const client = new OpenAI({
      baseURL: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
    });

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: WORLD_SIM_SYSTEM },
      { role: 'user', content: `Review the current state of the Sol system and take 1-4 actions to simulate world dynamics.\n\n${worldSummary}` },
    ];

    // Allow up to 5 rounds of tool calls
    for (let round = 0; round < 5; round++) {
      const response = await client.chat.completions.create({
        model: config.llm.models.worldSim,
        max_tokens: 1024,
        temperature: 0.8,
        messages,
        tools: MC_TOOLS,
      });

      const choice = response.choices[0];
      if (!choice) break;

      messages.push(choice.message);

      // If no tool calls, we're done
      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) break;

      // Execute each tool call
      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type !== 'function') continue;
        const fn = toolCall.function;
        const handler = TOOL_HANDLERS[fn.name];
        let result = 'Unknown tool.';

        if (handler) {
          try {
            const args = JSON.parse(fn.arguments);
            result = await handler(args, tick);
            logs.push(result);
          } catch (err) {
            result = `Error: ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    }
  } catch (err) {
    logs.push(`MC World Sim error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return logs;
}
