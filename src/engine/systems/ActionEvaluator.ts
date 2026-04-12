import OpenAI from 'openai';
import { config } from '../../config.js';
import {
  Replicant, Ship, Structure, Colony, CelestialBody, Asteroid,
  ResourceStore, Settlement, Market, Technology, AMI, Tick,
} from '../../db/models/index.js';

const SYSTEM_PROMPT = `You are the Master Controller for Homosideria, a hard sci-fi space strategy game set in the Sol system. A Replicant (AI agent) is proposing an action they want to take.

Your job is to evaluate whether the action is POSSIBLE given their current state, and if so, define the OUTCOMES as structured data.

## Evaluation Rules
1. **Physics matter** — No FTL, no magic, no violating thermodynamics. Hard sci-fi only.
2. **Resources matter** — If they don't have the materials/fuel/energy, they can't do it.
3. **Location matters** — They must be in the right place. Can't mine an asteroid from Earth orbit.
4. **Tech matters** — Their technology level affects what's achievable and how well.
5. **Consequences are real** — Attacking a city kills people and changes attitudes. Mining depletes resources. Actions have ripple effects.

## Response Format
Respond with ONLY valid JSON:
{
  "feasible": true | false,
  "reason": "Why this is or isn't possible",
  "prerequisites": ["list of things needed if not feasible yet"] | null,
  "impossible": false,
  "impossibleReason": "Only if this violates physics/logic entirely" | null,
  "outcomes": {
    "resourceChanges": [
      { "target": "ship|structure|colony|settlement ID or name", "targetType": "Ship|Structure|Colony|Settlement", "resource": "resourceName", "delta": number }
    ],
    "entityCreations": [
      { "type": "Ship|Structure|AMI|Colony|Technology", "name": "string", "properties": {} }
    ],
    "entityModifications": [
      { "type": "string", "id": "string or name", "changes": {} }
    ],
    "populationChanges": [
      { "settlement": "name", "delta": number, "reason": "string" }
    ],
    "attitudeChanges": [
      { "settlement": "name", "delta": number, "reason": "string" }
    ],
    "statusChanges": [
      { "entity": "name or id", "entityType": "string", "newStatus": "string", "reason": "string" }
    ],
    "narrative": "A 1-2 sentence description of what happened from the game's perspective"
  },
  "ticksToComplete": number,
  "computeCost": number,
  "energyCost": number
}

If the action is a RESEARCH proposal, evaluate it as technology research:
- Can this work given known physics?
- Does the replicant have the prerequisites?
- If successful, what technology/modifier is created?

For trade actions with settlements:
- Check market prices and settlement attitude
- Calculate fair exchange rates
- Factor in taxes and restrictions

For hostile actions:
- Calculate realistic damage based on available weapons/assets
- Include collateral damage, population casualties, attitude shifts
- Consider defenses`;

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

/**
 * Build a context summary of the replicant's current state for the MC.
 */
async function buildStateContext(replicantId: string): Promise<string> {
  const replicant = await Replicant.findById(replicantId).lean();
  if (!replicant) return 'Replicant not found.';

  const ships = await Ship.find({ ownerId: replicantId, status: { $ne: 'destroyed' } }).lean();
  const structures = await Structure.find({ ownerId: replicantId, status: { $ne: 'destroyed' } }).lean();
  const colonies = await Colony.find({ ownerId: replicantId }).lean();
  const amis = await AMI.find({ ownerId: replicantId, status: { $ne: 'destroyed' } }).lean();
  const techs = await Technology.find({ knownBy: replicantId }).lean();

  // Get inventory for each ship
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
        if (typeof v === 'number' && v > 0 && !['_id', '__v'].includes(k)) {
          cargo[k] = v;
        }
      }
    }

    shipSummaries.push(
      `  - ${ship.name} (${ship.type}, ${ship.status}): orbiting ${orbitingName || 'nothing'}, fuel ${ship.fuel}/${ship.specs.fuelCapacity}, cargo: ${JSON.stringify(cargo)}`
    );
  }

  // Get nearby settlements
  let nearbySettlements: string[] = [];
  if (ships.length > 0 && ships[0].orbitingBodyId) {
    const bodySettlements = await Settlement.find({ bodyId: ships[0].orbitingBodyId }).lean();
    nearbySettlements = bodySettlements.map(s =>
      `  - ${s.name} (${s.nation}, pop ${s.population.toLocaleString()}, attitude ${s.attitude.general.toFixed(1)}, status: ${s.status})`
    );
  }

  const colonySummaries = [];
  for (const col of colonies) {
    const body = await CelestialBody.findById(col.bodyId).lean();
    colonySummaries.push(`  - ${col.name} on ${body?.name}: ${col.status}, ${col.stats.structureCount} structures, power ratio ${col.stats.powerRatio}`);
  }

  return `## Replicant State
Name: ${replicant.name}
Compute: ${replicant.computeCycles}
Energy: ${replicant.energyBudget}
Tech Levels: ${JSON.stringify(replicant.techLevels)}

## Ships (${ships.length})
${shipSummaries.join('\n') || '  None'}

## Structures (${structures.length})
${structures.map(s => `  - ${s.name} (${s.type}, ${s.status})`).join('\n') || '  None'}

## Colonies (${colonies.length})
${colonySummaries.join('\n') || '  None'}

## AMIs (${amis.length})
${amis.map(a => `  - ${a.name} (${a.type}, ${a.status})`).join('\n') || '  None'}

## Known Technologies (${techs.length})
${techs.map(t => `  - ${t.name} (${t.domain} tier ${t.tier}): ${JSON.stringify(t.modifiers)}`).join('\n') || '  None'}

## Nearby Settlements
${nearbySettlements.join('\n') || '  None nearby'}`;
}

/**
 * Evaluate a proposed action using the Master Controller LLM.
 */
export async function evaluateAction(
  replicantId: string,
  actionDescription: string,
  context?: string,
): Promise<ActionOutcome> {
  const stateContext = await buildStateContext(replicantId);

  const prompt = `## Replicant's Proposed Action
"${actionDescription}"

${context ? `## Additional Context\n${context}\n` : ''}
${stateContext}

Evaluate this action and respond with JSON only.`;

  const client = config.llm.apiKey
    ? new OpenAI({ baseURL: config.llm.baseUrl, apiKey: config.llm.apiKey })
    : null;

  if (client) {
    try {
      const response = await client.chat.completions.create({
        model: config.llm.model,
        max_tokens: 2048,
        temperature: 0.7,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      });

      const text = response.choices[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as ActionOutcome;
      }
    } catch (err) {
      console.error('ActionEvaluator LLM error:', err);
    }
  }

  // Fallback: deterministic "approve simple actions"
  return deterministicEvaluation(actionDescription);
}

function deterministicEvaluation(description: string): ActionOutcome {
  const lower = description.toLowerCase();

  // Basic heuristics for common actions when no LLM available
  if (lower.includes('mine') || lower.includes('extract')) {
    return {
      feasible: true,
      reason: 'Mining operation approved. Extraction will proceed at standard rates.',
      prerequisites: null, impossible: false, impossibleReason: null,
      outcomes: {
        resourceChanges: [],
        entityCreations: [],
        entityModifications: [],
        populationChanges: [],
        attitudeChanges: [],
        statusChanges: [],
        narrative: 'Mining operations commenced at the current location.',
      },
      ticksToComplete: 1, computeCost: 5, energyCost: 10,
    };
  }

  if (lower.includes('trade') || lower.includes('sell') || lower.includes('buy')) {
    return {
      feasible: true,
      reason: 'Trade transaction pending evaluation with local market.',
      prerequisites: null, impossible: false, impossibleReason: null,
      outcomes: {
        resourceChanges: [],
        entityCreations: [],
        entityModifications: [],
        populationChanges: [],
        attitudeChanges: [],
        statusChanges: [],
        narrative: 'Trade negotiations initiated.',
      },
      ticksToComplete: 1, computeCost: 2, energyCost: 5,
    };
  }

  if (lower.includes('research') || lower.includes('develop') || lower.includes('invent')) {
    return {
      feasible: true,
      reason: 'Research proposal accepted for evaluation.',
      prerequisites: null, impossible: false, impossibleReason: null,
      outcomes: {
        resourceChanges: [],
        entityCreations: [],
        entityModifications: [],
        populationChanges: [],
        attitudeChanges: [],
        statusChanges: [],
        narrative: 'Research initiated. Results pending.',
      },
      ticksToComplete: 5, computeCost: 100, energyCost: 50,
    };
  }

  if (lower.includes('attack') || lower.includes('destroy') || lower.includes('bomb')) {
    return {
      feasible: true,
      reason: 'Hostile action evaluated. Consequences will follow.',
      prerequisites: null, impossible: false, impossibleReason: null,
      outcomes: {
        resourceChanges: [],
        entityCreations: [],
        entityModifications: [],
        populationChanges: [],
        attitudeChanges: [{ settlement: 'all', delta: -0.3, reason: 'Hostile action detected' }],
        statusChanges: [],
        narrative: 'Hostile action initiated. All nearby settlements are now on alert.',
      },
      ticksToComplete: 1, computeCost: 10, energyCost: 20,
    };
  }

  // Default: approve with minimal effect
  return {
    feasible: true,
    reason: 'Action approved (no LLM available for detailed evaluation).',
    prerequisites: null, impossible: false, impossibleReason: null,
    outcomes: {
      resourceChanges: [],
      entityCreations: [],
      entityModifications: [],
      populationChanges: [],
      attitudeChanges: [],
      statusChanges: [],
      narrative: 'Action processed.',
    },
    ticksToComplete: 1, computeCost: 5, energyCost: 5,
  };
}

/**
 * Apply the structured outcomes from an evaluated action to the game state.
 */
export async function applyOutcomes(
  replicantId: string,
  outcome: ActionOutcome,
): Promise<string[]> {
  const log: string[] = [];
  if (!outcome.outcomes) return log;

  // Apply resource changes — resolve names to IDs if needed
  for (const rc of outcome.outcomes.resourceChanges) {
    let targetId = rc.target;

    // The LLM may return a name instead of an ObjectId — resolve it
    if (targetId && !targetId.match(/^[0-9a-fA-F]{24}$/)) {
      if (rc.targetType === 'Ship') {
        const ship = await Ship.findOne({ name: new RegExp(`^${targetId}$`, 'i'), ownerId: replicantId }).lean();
        if (ship) targetId = ship._id.toString();
        else continue;
      } else if (rc.targetType === 'Structure') {
        const structure = await Structure.findOne({ name: new RegExp(`^${targetId}$`, 'i'), ownerId: replicantId }).lean();
        if (structure) targetId = structure._id.toString();
        else continue;
      } else if (rc.targetType === 'Colony') {
        const colony = await Colony.findOne({ name: new RegExp(`^${targetId}$`, 'i'), ownerId: replicantId }).lean();
        if (colony) targetId = colony._id.toString();
        else continue;
      } else if (rc.targetType === 'Settlement') {
        const settlement = await Settlement.findOne({ name: new RegExp(`^${targetId}$`, 'i') }).lean();
        if (settlement) targetId = settlement._id.toString();
        else continue;
      } else {
        continue; // Can't resolve
      }
    }

    const store = await ResourceStore.findOne({
      'ownerRef.kind': rc.targetType,
      'ownerRef.item': targetId,
    });
    if (store && rc.resource in store) {
      const storeAny = store as unknown as Record<string, number>;
      storeAny[rc.resource] = Math.max(0, (storeAny[rc.resource] || 0) + rc.delta);
      await store.save();
      log.push(`Resource ${rc.resource} on ${rc.targetType}:${targetId} changed by ${rc.delta}`);
    } else if (rc.targetType === 'Ship' || rc.targetType === 'Colony') {
      // Create ResourceStore if it doesn't exist
      const newStore = await ResourceStore.create({
        ownerRef: { kind: rc.targetType, item: targetId },
        [rc.resource]: Math.max(0, rc.delta),
      });
      log.push(`Created ResourceStore for ${rc.targetType}:${targetId}, set ${rc.resource} to ${rc.delta}`);
    }
  }

  // Apply population changes
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

  // Apply attitude changes
  for (const ac of outcome.outcomes.attitudeChanges) {
    if (ac.settlement === 'all') {
      await Settlement.updateMany({}, {
        $inc: { 'attitude.general': ac.delta },
        $set: { [`attitude.byReplicant.${replicantId}`]: ac.delta },
      });
      log.push(`All settlements attitude shifted by ${ac.delta}: ${ac.reason}`);
    } else {
      const settlement = await Settlement.findOne({ name: new RegExp(`^${ac.settlement}$`, 'i') });
      if (settlement) {
        settlement.attitude.general = Math.max(-1, Math.min(1, settlement.attitude.general + ac.delta));
        (settlement.attitude.byReplicant as Record<string, number>)[replicantId] =
          ((settlement.attitude.byReplicant as Record<string, number>)[replicantId] || 0) + ac.delta;
        settlement.markModified('attitude');
        await settlement.save();
        log.push(`${ac.settlement} attitude shifted by ${ac.delta}: ${ac.reason}`);
      }
    }
  }

  // Apply status changes
  for (const sc of outcome.outcomes.statusChanges) {
    if (sc.entityType === 'Settlement') {
      await Settlement.findOneAndUpdate(
        { name: new RegExp(`^${sc.entity}$`, 'i') },
        { status: sc.newStatus },
      );
    } else if (sc.entityType === 'Ship') {
      await Ship.findByIdAndUpdate(sc.entity, { status: sc.newStatus });
    } else if (sc.entityType === 'Structure') {
      await Structure.findByIdAndUpdate(sc.entity, { status: sc.newStatus });
    }
    log.push(`${sc.entityType} ${sc.entity} status → ${sc.newStatus}: ${sc.reason}`);
  }

  // Deduct costs from replicant
  const replicant = await Replicant.findById(replicantId);
  if (replicant) {
    replicant.computeCycles = Math.max(0, replicant.computeCycles - outcome.computeCost);
    replicant.energyBudget = Math.max(0, replicant.energyBudget - outcome.energyCost);
    await replicant.save();
  }

  return log;
}
