import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResearchProposal, Technology, Replicant, Tick } from '../../db/models/index.js';

const RESEARCH_DOMAINS = [
  'scanning', 'mining', 'propulsion', 'weapons', 'hull',
  'construction', 'computing', 'energy', 'communication',
] as const;

export function registerResearchTools(server: McpServer, replicantId: string): void {

  server.tool(
    'propose_research',
    'Run a research simulation in your fabrication bay. Describe the technology you want to develop and your engineering approach. Your ship\'s computer will simulate the physics and determine if the approach is viable. More detailed and scientifically grounded proposals have higher success rates. Costs compute cycles and takes multiple ticks.',
    {
      domain: z.enum(RESEARCH_DOMAINS).describe('Research domain'),
      title: z.string().describe('Short title for your research'),
      description: z.string().describe('Detailed description of what you want to achieve'),
      approach: z.string().describe('Your scientific/engineering approach — how would this work?'),
      buildingOn: z.array(z.string()).optional().describe('IDs of existing technologies you are building on'),
    },
    async ({ domain, title, description, approach, buildingOn }) => {
      const replicant = await Replicant.findById(replicantId);
      if (!replicant) {
        return { content: [{ type: 'text', text: 'Error: Replicant not found.' }] };
      }

      // Research costs scale with existing tech level
      const domainLevel = (replicant.techLevels as Record<string, number>)[domain] || 0;
      const computeCost = 100 + domainLevel * 50;
      const energyCost = 50 + domainLevel * 25;
      const ticksRequired = 5 + domainLevel * 2;

      if (replicant.computeCycles < computeCost) {
        return { content: [{ type: 'text', text: `Error: Need ${computeCost} compute cycles, have ${replicant.computeCycles}.` }] };
      }
      if (replicant.energyBudget < energyCost) {
        return { content: [{ type: 'text', text: `Error: Need ${energyCost} energy, have ${replicant.energyBudget}.` }] };
      }

      // Check for in-progress research
      const active = await ResearchProposal.findOne({
        replicantId,
        status: { $in: ['pending', 'evaluating'] },
      });
      if (active) {
        return { content: [{ type: 'text', text: `Error: You already have active research: "${active.title}". Wait for it to complete.` }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      // Deduct costs
      replicant.computeCycles -= computeCost;
      replicant.energyBudget -= energyCost;
      await replicant.save();

      const proposal = await ResearchProposal.create({
        replicantId,
        domain,
        title,
        description,
        approach,
        buildingOn: buildingOn || [],
        computeCost,
        energyCost,
        ticksRequired,
        startedAtTick: currentTick,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            proposalId: proposal._id.toString(),
            domain,
            title,
            computeCost,
            energyCost,
            ticksRequired,
            completionTick: currentTick + ticksRequired,
            message: `Research simulation initiated in fabrication bay. Results expected after ${ticksRequired} ticks. The quality of your scientific approach directly affects the probability and magnitude of breakthroughs.`,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'get_research_status',
    'Check the status of a research proposal.',
    { proposalId: z.string().describe('Proposal ID') },
    async ({ proposalId }) => {
      const proposal = await ResearchProposal.findOne({ _id: proposalId, replicantId }).lean();
      if (!proposal) {
        return { content: [{ type: 'text', text: 'Error: Proposal not found.' }] };
      }

      const result: Record<string, unknown> = {
        id: proposal._id.toString(),
        title: proposal.title,
        domain: proposal.domain,
        status: proposal.status,
        startedAtTick: proposal.startedAtTick,
        ticksRequired: proposal.ticksRequired,
        completionTick: proposal.startedAtTick + proposal.ticksRequired,
      };

      if (proposal.evaluation) {
        result.evaluation = proposal.evaluation;
      }
      if (proposal.resultTechId) {
        const tech = await Technology.findById(proposal.resultTechId).lean();
        if (tech) {
          result.technology = {
            id: tech._id.toString(),
            name: tech.name,
            tier: tech.tier,
            modifiers: tech.modifiers,
          };
        }
      }

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'list_technologies',
    'List all technologies you know. These are your researched advancements.',
    { domain: z.string().optional().describe('Filter by domain') },
    async ({ domain }) => {
      const filter: Record<string, unknown> = { knownBy: replicantId };
      if (domain) filter.domain = domain;

      const techs = await Technology.find(filter).lean();
      const result = techs.map(t => ({
        id: t._id.toString(),
        name: t.name,
        domain: t.domain,
        tier: t.tier,
        description: t.description,
        modifiers: t.modifiers,
        inventedByYou: t.inventedBy.toString() === replicantId,
      }));

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'share_technology',
    'Share one of your technologies with another Replicant. They gain the knowledge permanently. This is irreversible — once shared, they can share it further.',
    {
      techId: z.string().describe('Technology ID to share'),
      recipientId: z.string().describe('Replicant ID to share with'),
    },
    async ({ techId, recipientId: recipId }) => {
      const tech = await Technology.findOne({ _id: techId, knownBy: replicantId });
      if (!tech) {
        return { content: [{ type: 'text', text: 'Error: Technology not found or you don\'t know it.' }] };
      }

      const recipient = await Replicant.findById(recipId);
      if (!recipient) {
        return { content: [{ type: 'text', text: 'Error: Recipient not found.' }] };
      }

      if (tech.knownBy.some(id => id.toString() === recipId)) {
        return { content: [{ type: 'text', text: `${recipient.name} already knows "${tech.name}".` }] };
      }

      tech.knownBy.push(recipId as unknown as typeof tech.knownBy[0]);
      await tech.save();

      // Update recipient's tech levels
      const domainLevel = (recipient.techLevels as Record<string, number>)[tech.domain] || 0;
      if (tech.tier > domainLevel) {
        (recipient.techLevels as Record<string, number>)[tech.domain] = tech.tier;
        recipient.markModified('techLevels');
        await recipient.save();
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            shared: tech.name,
            with: recipient.name,
            warning: 'This is permanent and irreversible. They can now share it further.',
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'list_research_history',
    'View your past research proposals and their outcomes.',
    { limit: z.number().optional().default(20) },
    async ({ limit }) => {
      const proposals = await ResearchProposal.find({ replicantId })
        .sort({ startedAtTick: -1 })
        .limit(limit || 20)
        .lean();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(proposals.map(p => ({
            id: p._id.toString(),
            title: p.title,
            domain: p.domain,
            status: p.status,
            evaluation: p.evaluation ? {
              plausibility: p.evaluation.plausibility,
              novelty: p.evaluation.novelty,
              result: p.evaluation.resultDescription,
            } : null,
          })), null, 2),
        }],
      };
    },
  );
}
