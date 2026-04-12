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
- **name**: A proper scientific/engineering name for the technology (e.g., "Resonant Cavity Magnetron Extraction Array" not "mining-advancement-t1")
- **modifiers**: A JSON object of stat modifications (multipliers, usually 1.05-1.5x for incremental improvements)

## Narrative Voice
Write like a peer-reviewed engineering journal crossed with a hard sci-fi novel:
- **reasoning**: Explain the underlying science — reference thermodynamics, orbital mechanics, materials science, electromagnetic theory, or whatever domain applies. Explain WHY the approach works at a physical level, or specifically what physical law it runs afoul of.
- **techName**: Give the technology a proper scientific or engineering name that describes what it actually does (e.g., "Pulsed Microwave Regolith Disaggregation System", "Graphene-Lattice Radiative Heat Exchanger", "Phased-Array Doppler Anomaly Filter").
- **techDescription**: Describe what the technology actually does in engineering terms — operating principles, key parameters, physical mechanism. Not marketing copy.
- **resultDescription**: For successes, describe the breakthrough moment: what the simulation showed, what the prototype demonstrated, what changed. For failures, explain specifically what went wrong at a physical level and hint at what alternative approach might bear fruit.

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
  "reasoning": "string explaining the scientific basis for your evaluation",
  "result": "success" | "partial" | "failure",
  "techName": "string — a proper scientific/engineering name, or null",
  "techDescription": "string — engineering-level description of the technology, or null",
  "modifiers": { "key": number } or null,
  "resultDescription": "string — vivid hard sci-fi description of what was achieved or why it failed, with specific physical detail"
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

  const domainTechNames: Record<string, string[]> = {
    scanning: ['Adaptive Kalman Filter Array', 'Phase-Coherent Signal Discriminator', 'Cryogenic Low-Noise Amplifier Cascade'],
    mining: ['Pulsed Microwave Regolith Disaggregation System', 'Resonant Cavity Magnetron Extraction Array', 'Electrostatic Beneficiation Separator'],
    propulsion: ['Variable Specific-Impulse Magnetoplasma Thruster', 'Regenerative Nozzle Cooling Assembly', 'Hall-Effect Ion Drive Optimization Matrix'],
    weapons: ['Electromagnetic Railgun Capacitor Bank Upgrade', 'Phased-Array Targeting Interferometer', 'Hypervelocity Kinetic Penetrator Design'],
    hull: ['Whipple Shield Multilayer Composite', 'Self-Healing Polymer Matrix Armor', 'Graded-Z Radiation Shielding Laminate'],
    construction: ['Automated Friction-Stir Welding System', 'In-Situ Sintered Regolith Structural Members', 'Modular Truss Node Quick-Connect Assembly'],
    computing: ['Neuromorphic Parallel Processing Architecture', 'Error-Correcting Quantum Annealer Module', 'Hardened Radiation-Tolerant Logic Fabric'],
    energy: ['Graphene-Lattice Radiative Heat Exchanger', 'Perovskite-Silicon Tandem Photovoltaic Array', 'Superconducting Magnetic Energy Storage Ring'],
    communication: ['Phased-Array Doppler Anomaly Filter', 'Optical Laser Interlink Transceiver', 'Quantum Key Distribution Encoder'],
  };

  const domainDescriptions: Record<string, string[]> = {
    scanning: [
      'An adaptive filter system that uses Kalman prediction to separate genuine signals from solar wind noise, achieving a 15% improvement in signal-to-noise ratio across the 1-10 GHz band.',
      'A phase-coherent discriminator that cross-correlates returns from multiple antenna elements, reducing false positives by exploiting the phase incoherence of noise sources versus coherent reflections from solid bodies.',
      'A cryogenically cooled low-noise amplifier cascade operating at 4K, reducing thermal noise floor by 10 dB and extending effective sensor range against faint thermal signatures.',
    ],
    mining: [
      'A 2.45 GHz microwave emitter array that heats regolith to 800K in targeted zones, causing thermal stress fractures along mineral grain boundaries and reducing the energy required for mechanical extraction by 15%.',
      'A resonant cavity magnetron system tuned to selectively heat ferromagnetic minerals, allowing preferential extraction of iron-nickel deposits from mixed silicate matrices.',
      'An electrostatic separation system that charges pulverized regolith particles and sorts them by composition using differential deflection in a high-voltage field, improving ore purity by 10%.',
    ],
    propulsion: [
      'A variable specific-impulse engine that adjusts plasma confinement field geometry to trade between thrust and exhaust velocity, optimizing for either rapid acceleration or fuel-efficient cruising.',
      'A regenerative cooling system that routes propellant through micro-channels in the nozzle throat, recovering waste heat and pre-heating the reaction mass for a 10% improvement in specific impulse.',
      'An optimized Hall-effect thruster with improved magnetic field topology that reduces electron backflow, increasing ionization efficiency and thrust-to-power ratio.',
    ],
    weapons: [
      'An upgraded capacitor bank using ceramic dielectric stacking to deliver 12% higher peak current to the railgun armature, increasing muzzle velocity from 7.8 to 8.7 km/s.',
      'A phased-array interferometric targeting system that resolves targets to 0.3 arcseconds at engagement range, compensating for light-speed delay with predictive tracking algorithms.',
      'An improved penetrator geometry with a depleted-tungsten core and fragmenting steel jacket, optimized through hydrocode simulation for maximum behind-armor effect.',
    ],
    hull: [
      'A multi-layer Whipple shield with alternating aluminum-ceramic-Kevlar sheets, designed to fragment and disperse hypervelocity micrometeorite impacts across a larger area to prevent hull breach.',
      'A polymer matrix composite with embedded vascular channels containing a two-part epoxy system that autonomously seals small punctures when internal pressure drops, extending hull service life.',
      'A graded-Z laminate shield alternating high-Z (tungsten) and low-Z (polyethylene) layers, attenuating both primary galactic cosmic rays and secondary particle showers through complementary stopping mechanisms.',
    ],
    construction: [
      'An automated friction-stir welding head that joins aluminum-alloy structural members without melting, producing welds with 95% of parent material strength and zero porosity defects.',
      'A sintering process that uses concentrated solar flux to fuse raw regolith into load-bearing structural blocks, reducing the need for refined alloys in non-critical construction.',
      'A quick-connect node system for modular truss assemblies, using spring-loaded tapered pins and redundant locking mechanisms to reduce assembly time by 15%.',
    ],
    computing: [
      'A neuromorphic processing architecture that uses spiking neural networks for pattern recognition tasks, achieving 20% higher effective throughput for sensor data analysis at lower power draw.',
      'A quantum annealing module for combinatorial optimization problems, reducing route-planning and resource-allocation computation time from hours to minutes.',
      'A radiation-hardened logic fabric using triple-modular redundancy and error-correcting codes, maintaining computational integrity through solar particle events that would crash standard processors.',
    ],
    energy: [
      'A radiative heat exchanger with graphene-lattice emitter surfaces that increases thermal rejection efficiency by 15%, allowing higher sustained power output from fusion and fission systems.',
      'A tandem photovoltaic array layering perovskite and crystalline silicon cells to capture a broader spectrum of solar radiation, boosting conversion efficiency from 22% to 26%.',
      'A superconducting magnetic energy storage ring that provides rapid-discharge capability for peak power demands, buffering the gap between steady-state generation and burst-mode consumption.',
    ],
    communication: [
      'A phased-array antenna system with Doppler anomaly filtering that separates high-priority signals from background clutter by analyzing frequency shift patterns, improving deep-space reception by 10%.',
      'A laser optical interlink transceiver operating at 1550nm with adaptive optics, achieving 1 Gbps data rates at lunar distances with 0.01% bit error rate.',
      'A quantum key distribution encoder that generates provably secure encryption keys via entangled photon pairs, making intercepted communications computationally undecryptable.',
    ],
  };

  const tier = existingTechCount + 1;
  const nameIdx = Math.min(existingTechCount, 2);
  const domain = proposal.domain;

  const techNames = domainTechNames[domain] || [`${domain.charAt(0).toUpperCase() + domain.slice(1)} Systems Enhancement Tier ${tier}`];
  const techDescs = domainDescriptions[domain] || [`Incremental improvement to ${domain} subsystems through iterative engineering optimization, yielding measurable performance gains across standard operating parameters.`];

  const chosenName = techNames[nameIdx] || techNames[techNames.length - 1];
  const chosenDesc = techDescs[nameIdx] || techDescs[techDescs.length - 1];

  return {
    plausibility,
    novelty,
    difficulty,
    reasoning: success
      ? `Proposal demonstrates sufficient physical grounding and engineering detail. The described approach is consistent with known ${domain === 'propulsion' ? 'thermodynamics and plasma physics' : domain === 'mining' ? 'materials science and thermal dynamics' : domain === 'scanning' ? 'signal processing theory and antenna design' : domain === 'energy' ? 'thermodynamics and photovoltaic theory' : domain === 'hull' ? 'ballistics and materials engineering' : domain === 'weapons' ? 'electromagnetic theory and kinetics' : domain === 'construction' ? 'structural engineering and metallurgy' : domain === 'computing' ? 'computer architecture and information theory' : 'communication theory and quantum mechanics'} principles. Tier ${tier} advancement authorized.`
      : partial
        ? `The approach shows physical merit but the engineering implementation is under-specified. Simulations converged on a reduced-performance solution — the theoretical maximum could not be reached without resolving thermal management constraints, but a partial gain was achievable within current material limits.`
        : `The proposed mechanism conflicts with fundamental constraints. ${domain === 'propulsion' ? 'The reaction mass budget cannot produce the claimed delta-v — the Tsiolkovsky equation is unforgiving.' : domain === 'energy' ? 'The proposed efficiency exceeds the Carnot limit for the described operating temperatures.' : domain === 'mining' ? 'The extraction energy exceeds the recoverable chemical energy of the target deposit at this concentration.' : 'Further investigation into the underlying physics is recommended before re-submission.'}`,
    result: success ? 'success' : partial ? 'partial' : 'failure',
    techName: success || partial ? chosenName : null,
    techDescription: success || partial ? chosenDesc : null,
    modifiers: (success || partial) ? (domainModifiers[domain] || { general: 1.1 }) : null,
    resultDescription: success
      ? `The simulation matrices converged after 2,847 iterations, confirming the theoretical model. Prototype testing in the ship's fabrication bay validated the predicted performance envelope — ${chosenName} is now operational, with measurable improvements across targeted ${domain} parameters. The technology has been logged in the ship's research database and integrated into standard operating procedures.`
      : partial
        ? `The research yielded measurable but sub-optimal results. Thermal runaway in the test articles limited peak performance to roughly half the theoretical maximum. The ${chosenName} functions within a narrower operating envelope than intended, but still represents a tangible improvement. Further iteration on the thermal management subsystem may unlock the remaining performance.`
        : `The compute cores ran the simulation to completion, but the results were unambiguous: the proposed mechanism does not produce the predicted effect at achievable energy densities. ${domain === 'propulsion' ? 'The exhaust velocity plateaued well below the threshold needed for meaningful specific-impulse gain — the magnetic nozzle geometry cannot confine plasma at the required temperatures.' : domain === 'mining' ? 'The energy input required to disaggregate the target material exceeded the thermal budget of the extraction head by a factor of three, leading to immediate tool degradation in simulation.' : 'The parameter space was exhaustively searched, but no stable operating point exists within the described constraints.'} The computational resources have been consumed, but the negative result narrows the search space for future proposals.`,
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
