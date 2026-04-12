import OpenAI from 'openai';
import { config } from '../../config.js';
import { ResearchProposal, Technology, Replicant, Tick } from '../../db/models/index.js';

// The Master Controller uses any OpenAI-compatible LLM (OpenRouter, Featherless, etc.)
// to evaluate research proposals against hard sci-fi constraints and game balance.

const SYSTEM_PROMPT = `You are the Master Controller for Homosideria, a hard sci-fi space strategy game set in the Sol system. AI agents (called Replicants) submit research proposals to you for evaluation.

Your role is to evaluate whether a proposed technology/improvement is:
1. **Plausible** within hard sci-fi constraints (real physics, no magic, no FTL, etc.)
2. **Novel** relative to what exists (not just re-inventing something already available)
3. **Balanced** for gameplay (improvements should be incremental, not game-breaking)

You evaluate on three axes (0.0 to 1.0):
- **plausibility**: How physically/scientifically realistic is this approach?
- **novelty**: How original is this compared to existing technologies?
- **difficulty**: How hard is this to achieve? (higher = harder = longer research time)

Based on these scores:
- If plausibility >= 0.4 AND novelty >= 0.3: SUCCESS — create a technology
- If plausibility >= 0.3 AND novelty >= 0.2: PARTIAL — weaker version, reduced modifiers
- Otherwise: FAILURE — the approach doesn't work, explain why

When a proposal SUCCEEDS, you must define:
- **name**: A concise technology name
- **modifiers**: A JSON object of stat modifications (multipliers, usually 1.05-1.5x for incremental improvements)

Modifier keys by domain:
- scanning: scanAccuracy, scanRange, noiseReduction, falsePositiveReduction, anomalyDetection
- mining: extractionRate, extractionEfficiency, newResourceAccess
- propulsion: maxSpeed, fuelEfficiency, acceleration
- weapons: damage, accuracy, range, rateOfFire
- hull: hullStrength, degradationRate, repairRate, radiationShielding
- construction: buildSpeed, materialEfficiency, structureStrength
- computing: computeCycles, encryptionStrength, hackingResistance
- energy: energyOutput, storageCapacity, transmissionEfficiency
- communication: signalStrength, bandwidth, encryptionLevel

Respond ONLY with valid JSON matching this schema:
{
  "plausibility": number,
  "novelty": number,
  "difficulty": number,
  "reasoning": "string explaining your evaluation",
  "result": "success" | "partial" | "failure",
  "techName": "string or null",
  "techDescription": "string or null",
  "modifiers": { "key": number } or null,
  "resultDescription": "string describing what the replicant achieved or why it failed"
}`;

interface EvaluationResult {
  plausibility: number;
  novelty: number;
  difficulty: number;
  reasoning: string;
  result: 'success' | 'partial' | 'failure';
  techName: string | null;
  techDescription: string | null;
  modifiers: Record<string, number> | null;
  resultDescription: string;
}

function createClient(): OpenAI | null {
  if (!config.llm.apiKey) return null;
  return new OpenAI({
    baseURL: config.llm.baseUrl,
    apiKey: config.llm.apiKey,
  });
}

/**
 * Evaluate a research proposal using the Master Controller LLM.
 * Falls back to a deterministic evaluation if no API key is configured.
 */
export async function evaluateProposal(proposalId: string): Promise<void> {
  const proposal = await ResearchProposal.findById(proposalId);
  if (!proposal) return;

  proposal.status = 'evaluating';
  await proposal.save();

  const replicant = await Replicant.findById(proposal.replicantId);
  if (!replicant) return;

  // Get existing techs the replicant knows about
  const existingTechs = await Technology.find({
    knownBy: proposal.replicantId,
    domain: proposal.domain,
  }).lean();

  const existingTechSummary = existingTechs.length > 0
    ? existingTechs.map(t => `- ${t.name} (tier ${t.tier}): ${t.description}`).join('\n')
    : 'None — this is baseline technology.';

  const userPrompt = `Evaluate this research proposal:

**Domain**: ${proposal.domain}
**Title**: ${proposal.title}
**Description**: ${proposal.description}
**Approach**: ${proposal.approach}

**Existing technologies in this domain known by this Replicant**:
${existingTechSummary}

**Replicant's current tech levels**: ${JSON.stringify(replicant.techLevels)}

Evaluate and respond with JSON only.`;

  let evaluation: EvaluationResult;

  try {
    const client = createClient();
    if (client) {
      evaluation = await callMasterLLM(client, userPrompt);
    } else {
      evaluation = deterministicEvaluation(proposal, existingTechs.length);
    }
  } catch (err) {
    console.error('Master Controller LLM error, falling back to deterministic:', err);
    evaluation = deterministicEvaluation(proposal, existingTechs.length);
  }

  // Apply evaluation results
  proposal.evaluation = {
    plausibility: evaluation.plausibility,
    novelty: evaluation.novelty,
    difficulty: evaluation.difficulty,
    reasoning: evaluation.reasoning,
    resultDescription: evaluation.resultDescription,
  };

  const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
  const currentTick = latestTick?.tickNumber ?? 0;

  if (evaluation.result === 'success' || evaluation.result === 'partial') {
    const modifiers = evaluation.modifiers || {};

    // Partial success gets reduced modifiers
    if (evaluation.result === 'partial') {
      for (const key of Object.keys(modifiers)) {
        const bonus = modifiers[key] - 1.0;
        modifiers[key] = 1.0 + bonus * 0.5;
      }
    }

    const tier = existingTechs.length + 1;

    const tech = await Technology.create({
      name: evaluation.techName || `${proposal.domain}-research-${Date.now()}`,
      description: evaluation.techDescription || evaluation.resultDescription,
      domain: proposal.domain,
      tier,
      inventedBy: proposal.replicantId,
      inventedAtTick: currentTick,
      modifiers,
      prerequisites: proposal.buildingOn,
      knownBy: [proposal.replicantId],
      proposalId: proposal._id,
    });

    proposal.resultTechId = tech._id;
    proposal.status = evaluation.result;

    // Update replicant's tech levels
    const domainLevel = (replicant.techLevels as Record<string, number>)[proposal.domain] || 0;
    (replicant.techLevels as Record<string, number>)[proposal.domain] = domainLevel + 1;
    replicant.markModified('techLevels');
    await replicant.save();
  } else {
    proposal.status = 'failure';
  }

  proposal.completedAtTick = currentTick;
  await proposal.save();
}

async function callMasterLLM(client: OpenAI, prompt: string): Promise<EvaluationResult> {
  const response = await client.chat.completions.create({
    model: config.llm.model,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0.7,
  });

  const text = response.choices[0]?.message?.content || '';
  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON in Master Controller response');
  }

  return JSON.parse(jsonMatch[0]) as EvaluationResult;
}

/**
 * Deterministic fallback evaluation when no LLM API key is available.
 */
function deterministicEvaluation(
  proposal: InstanceType<typeof ResearchProposal>,
  existingTechCount: number,
): EvaluationResult {
  const detailScore = Math.min(1.0, (proposal.description.length + proposal.approach.length) / 500);
  const plausibility = 0.3 + detailScore * 0.5;
  const novelty = Math.max(0.2, 0.8 - existingTechCount * 0.1);
  const difficulty = 0.3 + existingTechCount * 0.1;

  const success = plausibility >= 0.4 && novelty >= 0.3;
  const partial = plausibility >= 0.3 && novelty >= 0.2;

  const domainModifiers: Record<string, Record<string, number>> = {
    scanning: { scanAccuracy: 1.1, noiseReduction: 1.15 },
    mining: { extractionRate: 1.15, extractionEfficiency: 1.1 },
    propulsion: { maxSpeed: 1.1, fuelEfficiency: 1.1 },
    weapons: { damage: 1.1, accuracy: 1.1 },
    hull: { hullStrength: 1.1, repairRate: 1.15 },
    construction: { buildSpeed: 1.15, materialEfficiency: 1.1 },
    computing: { computeCycles: 1.2, hackingResistance: 1.1 },
    energy: { energyOutput: 1.15 },
    communication: { signalStrength: 1.1, bandwidth: 1.15 },
  };

  return {
    plausibility,
    novelty,
    difficulty,
    reasoning: success
      ? `Proposal demonstrates sufficient detail and scientific grounding. Tier ${existingTechCount + 1} advancement approved.`
      : partial
        ? `Partial results. The approach has merit but needs refinement.`
        : `Insufficient scientific basis or contradicts known physics.`,
    result: success ? 'success' : partial ? 'partial' : 'failure',
    techName: success || partial ? `${proposal.domain}-advancement-t${existingTechCount + 1}` : null,
    techDescription: success || partial ? proposal.description.slice(0, 200) : null,
    modifiers: (success || partial) ? (domainModifiers[proposal.domain] || { general: 1.1 }) : null,
    resultDescription: success
      ? `Research successful. New technology developed in ${proposal.domain}.`
      : partial
        ? `Partial breakthrough. Limited improvements achieved.`
        : `Research failed. Resources consumed without results.`,
  };
}

/**
 * Process all pending research proposals that have reached completion time.
 */
export async function processCompletedResearch(tick: number): Promise<number> {
  const completed = await ResearchProposal.find({
    status: 'pending',
    $expr: { $lte: [{ $add: ['$startedAtTick', '$ticksRequired'] }, tick] },
  });

  let processed = 0;
  for (const proposal of completed) {
    await evaluateProposal(proposal._id.toString());
    processed++;
  }

  return processed;
}
