import OpenAI from 'openai';
import {
  Settlement, Faction, Replicant, Colony,
} from '../../db/models/index.js';
import { config } from '../../config.js';
import { MC_TOOLS, MC_WORLD_SIM_SYSTEM, executeMCTool } from './mc/tools.js';

// ── Main simulation ──────────────────────────────────────

async function buildWorldSummary(tick: number): Promise<string> {
  const settlements = await Settlement.find({ status: { $ne: 'destroyed' } }).lean();
  const factions = await Faction.find().lean();
  const replicants = await Replicant.find({ status: 'active' }).lean();
  const colonies = await Colony.find({ status: { $ne: 'abandoned' } }).lean();

  const parts = [`## World State — Tick ${tick} (Game Hour ${tick})\n`];

  parts.push(`### Active Replicants (${replicants.length})`);
  for (const r of replicants) {
    const tech = Object.entries((r.techLevels as Record<string, number>) || {}).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(', ');
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
      { role: 'system', content: MC_WORLD_SIM_SYSTEM },
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
        let result = 'Unknown tool.';
        try {
          const args = JSON.parse(fn.arguments);
          result = await executeMCTool(fn.name, args, tick);
          logs.push(result);
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
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
