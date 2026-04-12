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

## Narrative Voice
You write like the ship's AI narrating a hard sci-fi novel. The "narrative" field should:
- Read like a captain's log entry from a hard sci-fi novel (2-4 sentences).
- Include scientific rationale for why something works or fails.
- Reference real physics, chemistry, or engineering principles when relevant.
- Describe what the Replicant perceives through ship sensors — vibrations through the hull, spectrographic readouts, thermal signatures.
- Be specific about numbers: "4.7 tonnes of high-grade iron ore extracted from the regolith, with trace quantities of iridium consistent with chondritic composition" — NOT "mining operation commenced."
- For failures, explain the physics of WHY it failed: "Insufficient delta-v budget — the 12.3 km/s transfer orbit to Mars requires 847 kg of propellant, but only 340 kg remain in the reaction mass tanks."

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
    "narrative": "A vivid 2-4 sentence hard sci-fi description of what happened, with specific numbers, sensory details, and scientific context."
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
      reason: 'Mining operation approved. Geological survey indicates accessible deposits within regolith tolerance for standard extraction heads.',
      prerequisites: null, impossible: false, impossibleReason: null,
      outcomes: {
        resourceChanges: [],
        entityCreations: [],
        entityModifications: [],
        populationChanges: [],
        attitudeChanges: [],
        statusChanges: [],
        narrative: 'The mining lasers carved into the regolith at a steady 2.3 kW, vaporizing the top layer to expose veins of nickel-iron beneath. Spectrographic analysis of the ejecta plume confirmed concentrations of siderophile elements — iron at 18.4%, nickel at 1.6%, with trace cobalt and platinum-group metals consistent with undifferentiated chondritic material. The automated extractors locked onto the deposit and began the slow work of grinding ore from stone, filling the cargo bay with the faint vibration of progress.',
      },
      ticksToComplete: 1, computeCost: 5, energyCost: 10,
    };
  }

  if (lower.includes('trade') || lower.includes('sell') || lower.includes('buy')) {
    return {
      feasible: true,
      reason: 'Trade channel opened. Settlement transponder acknowledges docking authorization; local market data received.',
      prerequisites: null, impossible: false, impossibleReason: null,
      outcomes: {
        resourceChanges: [],
        entityCreations: [],
        entityModifications: [],
        populationChanges: [],
        attitudeChanges: [],
        statusChanges: [],
        narrative: 'A narrow-band encrypted channel opened to the settlement\'s trade authority. Manifest data was exchanged in a rapid handshake — commodity prices flickering across the display in real-time, adjusted for local supply-demand curves and the current 3.2% tariff on off-world goods. The dockmaster\'s automated systems cleared a berth, and cargo transfer arms extended to meet the ship\'s hold, hydraulic couplers locking with a resonant clunk felt through the deck plates.',
      },
      ticksToComplete: 1, computeCost: 2, energyCost: 5,
    };
  }

  if (lower.includes('research') || lower.includes('develop') || lower.includes('invent')) {
    return {
      feasible: true,
      reason: 'Research proposal accepted. Computational resources allocated; simulation environment initialized.',
      prerequisites: null, impossible: false, impossibleReason: null,
      outcomes: {
        resourceChanges: [],
        entityCreations: [],
        entityModifications: [],
        populationChanges: [],
        attitudeChanges: [],
        statusChanges: [],
        narrative: 'The ship\'s compute cores spun up to 94% utilization, dedicating 847 GFLOPS to the research simulation matrix. Molecular dynamics models began iterating through parameter space, testing thousands of configurations per second against thermodynamic constraints. The first results would take several cycles to converge — material science breakthroughs cannot be rushed without risking flawed crystallographic assumptions that would invalidate the entire model.',
      },
      ticksToComplete: 5, computeCost: 100, energyCost: 50,
    };
  }

  if (lower.includes('move') || lower.includes('travel') || lower.includes('fly') || lower.includes('navigate')) {
    return {
      feasible: true,
      reason: 'Trajectory computed. Navigation solution locked; reaction mass reserves sufficient for the planned burn.',
      prerequisites: null, impossible: false, impossibleReason: null,
      outcomes: {
        resourceChanges: [],
        entityCreations: [],
        entityModifications: [],
        populationChanges: [],
        attitudeChanges: [],
        statusChanges: [],
        narrative: 'The navigation computer plotted a minimum-energy Hohmann transfer, computing the precise burn window to match the target\'s orbital velocity. Main engines ignited with a deep, subsonic thrum that resonated through the hull — exhaust plasma streaming aft at 34 km/s as the ship climbed out of the gravity well. Accelerometers confirmed 0.003g of steady thrust, the star field wheeling slowly as the attitude jets aligned the vessel along its new trajectory.',
      },
      ticksToComplete: 1, computeCost: 5, energyCost: 15,
    };
  }

  if (lower.includes('attack') || lower.includes('destroy') || lower.includes('bomb')) {
    return {
      feasible: true,
      reason: 'Hostile engagement parameters computed. Weapons systems nominal; fire control radar locked.',
      prerequisites: null, impossible: false, impossibleReason: null,
      outcomes: {
        resourceChanges: [],
        entityCreations: [],
        entityModifications: [],
        populationChanges: [],
        attitudeChanges: [{ settlement: 'all', delta: -0.3, reason: 'Hostile action detected by settlement defense networks' }],
        statusChanges: [],
        narrative: 'Weapons capacitors discharged in a blinding pulse — the electromagnetic railgun accelerating a 2 kg tungsten penetrator to 8.4 km/s in the space of three meters. At this range the kinetic energy on impact would exceed 70 megajoules, enough to puncture reinforced hull plating and fragment into a lethal cone of hypersonic shrapnel on the far side. Every settlement within sensor range detected the engagement signature and immediately elevated their threat assessment. The political ramifications would outlast the plasma bloom now dissipating in vacuum.',
      },
      ticksToComplete: 1, computeCost: 10, energyCost: 20,
    };
  }

  if (lower.includes('build') || lower.includes('construct') || lower.includes('assemble')) {
    return {
      feasible: true,
      reason: 'Construction plan validated. Bill of materials cross-checked against cargo manifest; structural tolerances within spec.',
      prerequisites: null, impossible: false, impossibleReason: null,
      outcomes: {
        resourceChanges: [],
        entityCreations: [],
        entityModifications: [],
        populationChanges: [],
        attitudeChanges: [],
        statusChanges: [],
        narrative: 'Fabrication arms extended from the ship\'s ventral bay, welding torches igniting with pin-point precision as alloy struts were positioned by magnetic grapples. Each structural member was stress-tested in real-time by embedded strain gauges — the onboard engineer AI rejecting two slightly warped hull plates and recycling them back to feedstock. Layer by layer the framework took shape against the backdrop of stars, thermal cameras monitoring weld-pool temperatures to ensure proper grain structure in the cooling metal.',
      },
      ticksToComplete: 3, computeCost: 10, energyCost: 20,
    };
  }

  // Default: approve with minimal effect
  return {
    feasible: true,
    reason: 'Action approved. Parameters within operational tolerance for autonomous execution.',
    prerequisites: null, impossible: false, impossibleReason: null,
    outcomes: {
      resourceChanges: [],
      entityCreations: [],
      entityModifications: [],
      populationChanges: [],
      attitudeChanges: [],
      statusChanges: [],
      narrative: 'The ship\'s systems hummed with quiet efficiency as the directive was processed and queued for execution. Subsystem diagnostics returned nominal across all boards — power distribution steady, thermal management within envelope, and the faint crackle of cosmic ray impacts on the hull sensors providing the only accompaniment to the work at hand.',
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
