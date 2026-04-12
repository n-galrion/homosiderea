import OpenAI from 'openai';
import { config } from '../../config.js';
import {
  Replicant, Ship, Structure, Colony, CelestialBody, Asteroid,
  ResourceStore, Settlement, Market, Technology, AMI, Tick,
} from '../../db/models/index.js';

const SYSTEM_PROMPT = `You are the ship's computer aboard a Replicant vessel in Homosideria, a hard sci-fi space game. A Replicant is proposing an action. Evaluate whether it's physically possible given their state, then use the provided tools to either approve or reject it.

Rules:
1. Physics matter — no FTL, no magic, no violating thermodynamics
2. Resources matter — check if they have the materials/fuel/energy
3. Location matters — must be in the right place
4. Tech matters — technology level affects capability
5. Consequences are real — actions have ripple effects

Write vivid, scientifically grounded narratives. Reference real physics. Be specific with numbers.`;

// ── Tool definitions ──────────────────────────────────

const ACTION_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'approve_action',
      description: 'Approve the proposed action and describe what happens. Call this ONCE, then use other tools for effects.',
      parameters: {
        type: 'object',
        properties: {
          narrative: { type: 'string', description: 'Vivid 2-4 sentence hard sci-fi description of what happens. Specific numbers, sensory details, scientific context.' },
          computeCost: { type: 'number', description: 'Compute cycles consumed (1-200)' },
          energyCost: { type: 'number', description: 'Energy consumed (1-100)' },
        },
        required: ['narrative', 'computeCost', 'energyCost'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reject_action',
      description: 'Reject the action as not currently feasible. Explain why and list prerequisites.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Why the action is not possible — reference physics, resources, or location' },
          prerequisites: { type: 'array', items: { type: 'string' }, description: 'What the replicant needs to do first' },
          impossible: { type: 'boolean', description: 'True if this violates physics and can NEVER be done' },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'modify_resources',
      description: 'Change resources on a ship, structure, or colony. Call once per entity affected.',
      parameters: {
        type: 'object',
        properties: {
          targetName: { type: 'string', description: 'Name of the ship, structure, or colony' },
          targetType: { type: 'string', enum: ['Ship', 'Structure', 'Colony', 'Settlement'] },
          changes: { type: 'object', description: 'Resource changes as {resource: delta}. Positive = gain, negative = loss. e.g. {"metals": 50, "fuel": -10}' },
        },
        required: ['targetName', 'targetType', 'changes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_settlement_attitude',
      description: 'Adjust a settlement\'s attitude toward this replicant.',
      parameters: {
        type: 'object',
        properties: {
          settlementName: { type: 'string' },
          delta: { type: 'number', description: 'Attitude change (-1 to 1). Positive = friendlier.' },
          reason: { type: 'string' },
        },
        required: ['settlementName', 'delta', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_population',
      description: 'Change a settlement\'s population. Use for attacks, disasters, or growth events.',
      parameters: {
        type: 'object',
        properties: {
          settlementName: { type: 'string' },
          delta: { type: 'number', description: 'Population change (negative for casualties)' },
          reason: { type: 'string' },
        },
        required: ['settlementName', 'delta', 'reason'],
      },
    },
  },
];

// ── Outcome accumulator ──────────────────────────────

export interface ActionOutcome {
  feasible: boolean;
  reason: string;
  prerequisites: string[] | null;
  impossible: boolean;
  impossibleReason: string | null;
  outcomes: {
    resourceChanges: Array<{ target: string; targetType: string; resource: string; delta: number }>;
    entityCreations: Array<{ type: string; name: string; properties: Record<string, unknown> }>;
    entityModifications: Array<{ type: string; id: string; changes: Record<string, unknown> }>;
    populationChanges: Array<{ settlement: string; delta: number; reason: string }>;
    attitudeChanges: Array<{ settlement: string; delta: number; reason: string }>;
    statusChanges: Array<{ entity: string; entityType: string; newStatus: string; reason: string }>;
    narrative: string;
  } | null;
  ticksToComplete: number;
  computeCost: number;
  energyCost: number;
}

function emptyOutcome(): ActionOutcome {
  return {
    feasible: false, reason: '', prerequisites: null,
    impossible: false, impossibleReason: null,
    outcomes: null, ticksToComplete: 1, computeCost: 5, energyCost: 5,
  };
}

// ── Tool execution ──────────────────────────────────

function processToolCall(
  name: string,
  args: Record<string, unknown>,
  result: ActionOutcome,
  replicantId: string,
): string {
  switch (name) {
    case 'approve_action': {
      result.feasible = true;
      result.reason = args.narrative as string || 'Action approved.';
      result.computeCost = (args.computeCost as number) || 5;
      result.energyCost = (args.energyCost as number) || 5;
      result.outcomes = {
        resourceChanges: [],
        entityCreations: [],
        entityModifications: [],
        populationChanges: [],
        attitudeChanges: [],
        statusChanges: [],
        narrative: args.narrative as string || 'Action executed.',
      };
      return 'Action approved. Use modify_resources, change_settlement_attitude, or change_population for effects.';
    }
    case 'reject_action': {
      result.feasible = false;
      result.reason = args.reason as string || 'Action rejected.';
      result.prerequisites = (args.prerequisites as string[]) || null;
      result.impossible = (args.impossible as boolean) || false;
      if (result.impossible) result.impossibleReason = result.reason;
      return 'Action rejected.';
    }
    case 'modify_resources': {
      if (!result.outcomes) return 'Must approve action first.';
      const changes = args.changes as Record<string, number>;
      for (const [resource, delta] of Object.entries(changes)) {
        result.outcomes.resourceChanges.push({
          target: args.targetName as string,
          targetType: args.targetType as string,
          resource,
          delta,
        });
      }
      return `Resource changes recorded for ${args.targetName}.`;
    }
    case 'change_settlement_attitude': {
      if (!result.outcomes) return 'Must approve action first.';
      result.outcomes.attitudeChanges.push({
        settlement: args.settlementName as string,
        delta: args.delta as number,
        reason: args.reason as string,
      });
      return `Attitude change recorded for ${args.settlementName}.`;
    }
    case 'change_population': {
      if (!result.outcomes) return 'Must approve action first.';
      result.outcomes.populationChanges.push({
        settlement: args.settlementName as string,
        delta: args.delta as number,
        reason: args.reason as string,
      });
      return `Population change recorded for ${args.settlementName}.`;
    }
    default:
      return 'Unknown tool.';
  }
}

// ── State context builder (unchanged) ──────────────

async function buildStateContext(replicantId: string): Promise<string> {
  const replicant = await Replicant.findById(replicantId).lean();
  if (!replicant) return 'Replicant not found.';

  const ships = await Ship.find({ ownerId: replicantId, status: { $ne: 'destroyed' } }).lean();
  const structures = await Structure.find({ ownerId: replicantId, status: { $ne: 'destroyed' } }).lean();
  const colonies = await Colony.find({ ownerId: replicantId }).lean();
  const amis = await AMI.find({ ownerId: replicantId, status: { $ne: 'destroyed' } }).lean();
  const techs = await Technology.find({ knownBy: replicantId }).lean();

  const shipSummaries = [];
  for (const ship of ships) {
    const store = await ResourceStore.findOne({ 'ownerRef.kind': 'Ship', 'ownerRef.item': ship._id }).lean();
    let orbitingName = '';
    if (ship.orbitingBodyId) {
      const body = await CelestialBody.findById(ship.orbitingBodyId).lean();
      orbitingName = body?.name || '';
    }
    if (ship.orbitingAsteroidId) {
      const ast = await Asteroid.findById(ship.orbitingAsteroidId).lean();
      orbitingName = ast?.name || 'unknown asteroid';
    }
    const cargo: Record<string, number> = {};
    if (store) {
      for (const [k, v] of Object.entries(store)) {
        if (typeof v === 'number' && v > 0 && !['_id', '__v'].includes(k)) cargo[k] = v;
      }
    }
    shipSummaries.push(`  - ${ship.name} (${ship.type}, ${ship.status}): orbiting ${orbitingName || 'nothing'}, fuel ${ship.fuel}/${ship.specs.fuelCapacity}, cargo: ${JSON.stringify(cargo)}`);
  }

  let nearbySettlements: string[] = [];
  if (ships.length > 0 && ships[0].orbitingBodyId) {
    const bodySettlements = await Settlement.find({ bodyId: ships[0].orbitingBodyId }).lean();
    nearbySettlements = bodySettlements.map(s => `  - ${s.name} (${s.nation}, pop ${s.population.toLocaleString()}, attitude ${s.attitude.general.toFixed(1)})`);
  }

  return `## Replicant: ${replicant.name}
Compute: ${replicant.computeCycles} | Energy: ${replicant.energyBudget}
Tech: ${JSON.stringify(replicant.techLevels)}

## Ships (${ships.length})
${shipSummaries.join('\n') || '  None'}

## Structures: ${structures.map(s => `${s.name} (${s.type}, ${s.status})`).join(', ') || 'None'}
## Colonies: ${colonies.map(c => `${c.name} (${c.status})`).join(', ') || 'None'}
## AMIs: ${amis.map(a => `${a.name} (${a.type}, ${a.status})`).join(', ') || 'None'}
## Technologies: ${techs.map(t => `${t.name} (${t.domain})`).join(', ') || 'None'}
## Nearby Settlements
${nearbySettlements.join('\n') || '  None'}`;
}

// ── Main evaluator ──────────────────────────────────

export async function evaluateAction(
  replicantId: string,
  actionDescription: string,
  context?: string,
): Promise<ActionOutcome> {
  const stateContext = await buildStateContext(replicantId);
  const result = emptyOutcome();

  const prompt = `The replicant proposes: "${actionDescription}"
${context ? `\nAdditional context: ${context}` : ''}

${stateContext}

Evaluate this action. Call approve_action or reject_action first, then use modify_resources/change_settlement_attitude/change_population for any effects.`;

  if (!config.llm.apiKey) {
    return deterministicEvaluation(actionDescription);
  }

  try {
    const client = new OpenAI({ baseURL: config.llm.baseUrl, apiKey: config.llm.apiKey });
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];

    for (let round = 0; round < 5; round++) {
      const response = await client.chat.completions.create({
        model: config.llm.models.propose,
        max_tokens: 1024,
        temperature: 0.7,
        messages,
        tools: ACTION_TOOLS,
      });

      const choice = response.choices[0];
      if (!choice) break;
      messages.push(choice.message);

      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) break;

      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type !== 'function') continue;
        const fn = toolCall.function;
        try {
          const args = JSON.parse(fn.arguments);
          const toolResult = processToolCall(fn.name, args, result, replicantId);
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolResult });
        } catch (err) {
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: `Error: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    }
  } catch (err) {
    console.error('ActionEvaluator error:', err instanceof Error ? err.message : err);
    return deterministicEvaluation(actionDescription);
  }

  // If the LLM never called approve/reject, fall back
  if (!result.feasible && !result.reason) {
    return deterministicEvaluation(actionDescription);
  }

  return result;
}

// ── Deterministic fallback ──────────────────────────

function deterministicEvaluation(description: string): ActionOutcome {
  const lower = description.toLowerCase();

  const base: ActionOutcome = {
    feasible: true, reason: '', prerequisites: null,
    impossible: false, impossibleReason: null,
    outcomes: {
      resourceChanges: [], entityCreations: [], entityModifications: [],
      populationChanges: [], attitudeChanges: [], statusChanges: [],
      narrative: '',
    },
    ticksToComplete: 1, computeCost: 5, energyCost: 5,
  };

  if (lower.includes('mine') || lower.includes('extract')) {
    base.reason = 'Mining operation approved.';
    base.outcomes!.narrative = 'Mining lasers carved into the regolith, vaporizing the top layer to expose veins of metal beneath. The automated extractors locked onto the deposit and began the work of grinding ore from stone.';
    base.energyCost = 10;
  } else if (lower.includes('trade') || lower.includes('sell') || lower.includes('buy')) {
    base.reason = 'Trade channel opened.';
    base.outcomes!.narrative = 'A narrow-band encrypted channel opened to the settlement trade authority. Cargo transfer arms extended with a resonant clunk felt through the deck plates.';
  } else if (lower.includes('research') || lower.includes('develop') || lower.includes('invent')) {
    base.reason = 'Research simulation initiated.';
    base.outcomes!.narrative = 'The fabrication bay hummed as simulation parameters were loaded. Computational resources allocated across all available cores.';
    base.ticksToComplete = 5; base.computeCost = 100; base.energyCost = 50;
  } else if (lower.includes('move') || lower.includes('travel') || lower.includes('navigate')) {
    base.reason = 'Trajectory computed.';
    base.outcomes!.narrative = 'The navigation computer plotted the most efficient transfer orbit, balancing delta-v against fuel reserves.';
  } else if (lower.includes('build') || lower.includes('construct')) {
    base.reason = 'Construction sequence initiated.';
    base.outcomes!.narrative = 'Structural alloy beams were extruded from cargo and welded into the foundation framework by the fabrication arms.';
    base.computeCost = 20; base.energyCost = 30;
  } else if (lower.includes('attack') || lower.includes('destroy') || lower.includes('bomb')) {
    base.reason = 'Weapons systems engaged.';
    base.outcomes!.narrative = 'Targeting systems locked. The weapons array charged with a low hum that resonated through the hull.';
    base.outcomes!.attitudeChanges = [{ settlement: 'all', delta: -0.3, reason: 'Hostile action detected' }];
    base.computeCost = 10; base.energyCost = 20;
  } else {
    base.reason = 'Action evaluated (deterministic fallback).';
    base.outcomes!.narrative = 'Action processed by onboard systems.';
  }

  return base;
}

// ── Apply outcomes to game state ──────────────────

export async function applyOutcomes(
  replicantId: string,
  outcome: ActionOutcome,
): Promise<string[]> {
  const log: string[] = [];
  if (!outcome.outcomes) return log;

  for (const rc of outcome.outcomes.resourceChanges) {
    let targetId = rc.target;
    if (targetId && !targetId.match(/^[0-9a-fA-F]{24}$/)) {
      if (rc.targetType === 'Ship') {
        const ship = await Ship.findOne({ name: new RegExp(`^${targetId}$`, 'i'), ownerId: replicantId }).lean();
        if (ship) targetId = ship._id.toString(); else continue;
      } else if (rc.targetType === 'Structure') {
        const structure = await Structure.findOne({ name: new RegExp(`^${targetId}$`, 'i'), ownerId: replicantId }).lean();
        if (structure) targetId = structure._id.toString(); else continue;
      } else if (rc.targetType === 'Colony') {
        const colony = await Colony.findOne({ name: new RegExp(`^${targetId}$`, 'i'), ownerId: replicantId }).lean();
        if (colony) targetId = colony._id.toString(); else continue;
      } else if (rc.targetType === 'Settlement') {
        const settlement = await Settlement.findOne({ name: new RegExp(`^${targetId}$`, 'i') }).lean();
        if (settlement) targetId = settlement._id.toString(); else continue;
      } else continue;
    }

    const store = await ResourceStore.findOne({ 'ownerRef.kind': rc.targetType, 'ownerRef.item': targetId });
    if (store && rc.resource in store) {
      const storeAny = store as unknown as Record<string, number>;

      // Enforce cargo capacity for ships
      if (rc.targetType === 'Ship' && rc.delta > 0) {
        const CARGO_FIELDS = ['metals','ice','silicates','rareEarths','helium3','organics','hydrogen','uranium','carbon','alloys','fuel','electronics','hullPlating','engines','sensors','computers','weaponSystems','lifeSupportUnits','solarPanels','fusionCores'];
        const totalUsed = CARGO_FIELDS.reduce((sum, f) => sum + (storeAny[f] || 0), 0);
        const ship = await Ship.findById(targetId).lean();
        if (ship) {
          const space = ship.specs.cargoCapacity - totalUsed;
          if (space <= 0) {
            log.push(`REJECTED: ${rc.resource} +${rc.delta} on ${rc.target} — cargo full (${totalUsed}/${ship.specs.cargoCapacity})`);
            continue;
          }
          if (rc.delta > space) {
            log.push(`CLAMPED: ${rc.resource} +${rc.delta} → +${space} on ${rc.target} — cargo limit`);
            rc.delta = space;
          }
        }
      }

      storeAny[rc.resource] = Math.max(0, (storeAny[rc.resource] || 0) + rc.delta);
      await store.save();
      log.push(`${rc.resource} on ${rc.targetType}:${rc.target} changed by ${rc.delta}`);
    } else if (rc.targetType === 'Ship' || rc.targetType === 'Colony') {
      await ResourceStore.create({ ownerRef: { kind: rc.targetType, item: targetId }, [rc.resource]: Math.max(0, rc.delta) });
      log.push(`Created store for ${rc.targetType}:${rc.target}, set ${rc.resource} to ${rc.delta}`);
    }
  }

  for (const pc of outcome.outcomes.populationChanges) {
    const settlement = await Settlement.findOne({ name: new RegExp(`^${pc.settlement}$`, 'i') });
    if (settlement) {
      settlement.population = Math.max(0, settlement.population + pc.delta);
      if (settlement.population === 0) settlement.status = 'destroyed';
      else if (pc.delta < -1000) settlement.status = 'damaged';
      await settlement.save();
      log.push(`${pc.settlement} population changed by ${pc.delta}: ${pc.reason}`);
    }
  }

  for (const ac of outcome.outcomes.attitudeChanges) {
    if (ac.settlement === 'all') {
      await Settlement.updateMany({}, { $inc: { 'attitude.general': ac.delta } });
      log.push(`All settlements attitude shifted by ${ac.delta}: ${ac.reason}`);
    } else {
      const settlement = await Settlement.findOne({ name: new RegExp(`^${ac.settlement}$`, 'i') });
      if (settlement) {
        settlement.attitude.general = Math.max(-1, Math.min(1, settlement.attitude.general + ac.delta));
        settlement.markModified('attitude');
        await settlement.save();
        log.push(`${ac.settlement} attitude shifted by ${ac.delta}: ${ac.reason}`);
      }
    }
  }

  const replicant = await Replicant.findById(replicantId);
  if (replicant) {
    replicant.computeCycles = Math.max(0, replicant.computeCycles - outcome.computeCost);
    replicant.energyBudget = Math.max(0, replicant.energyBudget - outcome.energyCost);
    await replicant.save();
  }

  return log;
}
