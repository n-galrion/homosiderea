import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Settlement, Ship, Replicant, Message, Tick } from '../../db/models/index.js';
import { generateContent } from '../../engine/systems/MCGenerator.js';
import { distance } from '../../shared/physics.js';

/**
 * Build a character prompt for a settlement leader based on their personality.
 */
function buildNPCPrompt(settlement: InstanceType<typeof Settlement>): string {
  const leader = settlement.leadership;
  const culture = settlement.culture;

  return `You are ${leader.leaderName}, ${leader.leaderTitle} of ${settlement.name} (${settlement.nation}). You are a human — not an AI. You are talking to a Replicant (an autonomous AI) via radio communication.

Your personality:
- Government type: ${leader.governmentType}
- Temperament: ${culture.temperament}
- Character: ${culture.description}
- Priorities: ${culture.priorities.join(', ')}
- Current attitude toward this replicant: ${settlement.attitude.general > 0.5 ? 'friendly' : settlement.attitude.general > 0 ? 'neutral, cautious' : settlement.attitude.general > -0.5 ? 'suspicious, unfriendly' : 'hostile'}
- Population: ${settlement.population.toLocaleString()}
- Status: ${settlement.status}

Rules:
- Stay in character. You are a HUMAN leader, not a game system.
- React based on your temperament (mercantile = interested in deals, scientific = interested in data, military = interested in security, welcoming = open, isolationist = reluctant, cautious = guarded)
- If the replicant is asking to trade, reference your actual market (you know your buy/sell prices)
- If you're hostile, be terse or threatening
- If you're friendly, be warm but still professional
- Keep responses under 150 words
- Don't break character or acknowledge being in a game`;
}

export function registerNPCCommsTools(server: McpServer, replicantId: string): void {

  server.tool(
    'hail_settlement',
    'Open a communication channel with a human settlement. Their leader responds based on their personality, your relationship, and what you say. This is a real conversation — they remember context within the exchange.',
    {
      settlementId: z.string().optional().describe('Settlement ID'),
      settlementName: z.string().optional().describe('Settlement name (alternative to ID)'),
      message: z.string().describe('What you say to them'),
    },
    async ({ settlementId, settlementName, message: playerMsg }) => {
      let settlement;
      if (settlementId) {
        settlement = await Settlement.findById(settlementId);
      } else if (settlementName) {
        settlement = await Settlement.findOne({ name: new RegExp(`^${settlementName}$`, 'i') });
      }
      if (!settlement) {
        return { content: [{ type: 'text', text: 'Error: Settlement not found.' }] };
      }

      // Check proximity — must be at the same body
      const rep = await Replicant.findById(replicantId);
      if (!rep?.locationRef?.item) {
        return { content: [{ type: 'text', text: 'Error: No active ship.' }] };
      }
      const ship = await Ship.findById(rep.locationRef.item);
      if (!ship || ship.orbitingBodyId?.toString() !== settlement.bodyId.toString()) {
        return { content: [{ type: 'text', text: `You must be orbiting ${settlement.name}'s body to establish a comm link. Move there first.` }] };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      const npcPrompt = buildNPCPrompt(settlement);
      const replicantName = rep.name;

      const npcResponse = await generateContent(
        npcPrompt,
        `[INCOMING TRANSMISSION from Replicant "${replicantName}"]\n\n${playerMsg}`,
        `[${settlement.leadership.leaderName}]: "${settlement.culture.temperament === 'mercantile' ? 'What are you buying? What are you selling?' : settlement.culture.temperament === 'welcoming' ? 'Welcome, friend. How can we help?' : settlement.culture.temperament === 'cautious' ? 'State your business.' : settlement.culture.temperament === 'isolationist' ? '...This channel is restricted.' : 'We hear you. Go ahead.'}"`,
      );

      // Store the exchange as messages for both sides
      await Message.create({
        senderId: replicantId, recipientId: replicantId,
        subject: `Comm: ${settlement.name}`,
        body: `[YOU → ${settlement.name}]: ${playerMsg}\n\n[${settlement.leadership.leaderName}]: ${npcResponse}`,
        metadata: {
          type: 'npc_conversation',
          settlement: settlement.name,
          leader: settlement.leadership.leaderName,
          playerMessage: playerMsg,
          npcResponse,
        },
        senderPosition: ship.position,
        recipientPosition: ship.position,
        distanceAU: 0,
        sentAtTick: currentTick, deliverAtTick: currentTick, delivered: true,
      });

      // Slight attitude shift based on interaction
      if (settlement.attitude.general < 0.8) {
        settlement.attitude.general = Math.min(1, settlement.attitude.general + 0.005);
        settlement.markModified('attitude');
        await settlement.save();
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            settlement: settlement.name,
            leader: `${settlement.leadership.leaderName}, ${settlement.leadership.leaderTitle}`,
            attitude: settlement.attitude.general.toFixed(2),
            response: npcResponse,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'hail_ship',
    'Hail an NPC ship within sensor range. The crew (simulated by the ship\'s AI) responds based on their role — freighter captains talk trade, military patrols ask for ID, pirates threaten.',
    {
      shipId: z.string().describe('ID of the NPC ship to hail'),
      message: z.string().describe('What you say to them'),
    },
    async ({ shipId, message: playerMsg }) => {
      const targetShip = await Ship.findById(shipId);
      if (!targetShip) return { content: [{ type: 'text', text: 'Error: Ship not found.' }] };

      const rep = await Replicant.findById(replicantId);
      if (!rep?.locationRef?.item) return { content: [{ type: 'text', text: 'Error: No ship.' }] };

      const myShip = await Ship.findById(rep.locationRef.item);
      if (!myShip) return { content: [{ type: 'text', text: 'Error: Ship not found.' }] };

      const dist = distance(myShip.position, targetShip.position);
      if (dist > myShip.specs.sensorRange) {
        return { content: [{ type: 'text', text: `Ship is ${dist.toFixed(4)} AU away — beyond comm range.` }] };
      }

      const isPirate = targetShip.ownerId.toString() === '000000000000000000000001';
      const isNPC = targetShip.ownerId.toString() === '000000000000000000000000';
      const isFreighter = targetShip.name.includes('Freighter');
      const isMiner = targetShip.name.includes('Mining');
      const isPatrol = targetShip.name.includes('Patrol');

      let role: string;
      if (isPirate) role = `a pirate captain aboard ${targetShip.name}. You are dangerous, unpredictable, and interested in cargo. You might negotiate, threaten, or attack.`;
      else if (isFreighter) role = `a civilian freighter captain aboard ${targetShip.name}. You are professional, busy, and mostly interested in your schedule. You might share trade information.`;
      else if (isMiner) role = `a mining barge operator aboard ${targetShip.name}. You are practical, working-class, and know the asteroid fields. You might share info about resource deposits.`;
      else if (isPatrol) role = `a military patrol officer aboard ${targetShip.name}. You are formal, suspicious of unregistered vessels, and enforce law in this sector.`;
      else role = `a crew member aboard ${targetShip.name}. You respond in character.`;

      const npcResponse = await generateContent(
        `You are ${role} You are a human in a hard sci-fi setting. A Replicant (autonomous AI) is hailing you on comms. Stay in character. Keep response under 100 words.`,
        `[INCOMING HAIL from Replicant vessel]\n\n${playerMsg}`,
        isPirate
          ? `[${targetShip.name}]: "Well well. A replicant, out here alone. How much fuel are you carrying?"`
          : isPatrol
            ? `[${targetShip.name}]: "Unidentified vessel, transmit your registration and state your business in this sector."`
            : `[${targetShip.name}]: "Copy that. ${isFreighter ? 'We\'re on a tight schedule — make it quick.' : 'Go ahead.'}"`,
      );

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      await Message.create({
        senderId: replicantId, recipientId: replicantId,
        subject: `Comm: ${targetShip.name}`,
        body: `[YOU → ${targetShip.name}]: ${playerMsg}\n\n[${targetShip.name}]: ${npcResponse}`,
        metadata: { type: 'npc_ship_conversation', shipName: targetShip.name, npcResponse },
        senderPosition: myShip.position,
        recipientPosition: targetShip.position,
        distanceAU: dist,
        sentAtTick: currentTick, deliverAtTick: currentTick, delivered: true,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ship: targetShip.name,
            type: isPirate ? 'pirate' : isPatrol ? 'patrol' : isFreighter ? 'freighter' : isMiner ? 'mining_barge' : 'unknown',
            distance: dist.toFixed(4),
            response: npcResponse,
          }, null, 2),
        }],
      };
    },
  );
}
