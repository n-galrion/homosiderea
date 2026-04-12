import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Ship, ResourceStore, Replicant, Tick, Message, Salvage } from '../../db/models/index.js';
import { distance } from '../../shared/physics.js';

const NPC_OWNER_ID = '000000000000000000000000';
const WEAPON_RANGE_AU = 0.05;

export function registerCombatTools(server: McpServer, replicantId: string): void {

  server.tool(
    'attack_ship',
    'Attack a target ship within weapon range (0.05 AU). Deals damage based on your combatPower. You will take return fire. If the target is destroyed, salvage is generated.',
    {
      shipId: z.string().describe('Your ship ID'),
      targetShipId: z.string().describe('Target ship ID to attack'),
    },
    async ({ shipId, targetShipId }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) return { content: [{ type: 'text', text: 'Error: Ship not found or not yours.' }] };

      if (ship.status === 'destroyed') {
        return { content: [{ type: 'text', text: 'Error: Your ship is destroyed.' }] };
      }

      if (ship.specs.combatPower <= 0) {
        return { content: [{ type: 'text', text: 'Error: This ship has no weapons (combatPower = 0). Upgrade weapons first.' }] };
      }

      const target = await Ship.findById(targetShipId);
      if (!target) return { content: [{ type: 'text', text: 'Error: Target ship not found.' }] };
      if (target.status === 'destroyed') {
        return { content: [{ type: 'text', text: 'Error: Target is already destroyed.' }] };
      }

      // Don't allow attacking your own ships
      if (target.ownerId.toString() === replicantId) {
        return { content: [{ type: 'text', text: 'Error: Cannot attack your own ship.' }] };
      }

      const dist = distance(ship.position, target.position);
      if (dist > WEAPON_RANGE_AU) {
        return {
          content: [{
            type: 'text',
            text: `Target is ${dist.toFixed(4)} AU away — beyond weapon range of ${WEAPON_RANGE_AU} AU. Close the distance first.`,
          }],
        };
      }

      const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
      const currentTick = latestTick?.tickNumber ?? 0;

      // Calculate damage dealt to target
      const attackDamage = ship.specs.combatPower * (0.5 + Math.random() * 0.5);
      const roundedAttackDamage = Math.round(attackDamage * 10) / 10;

      // Calculate return fire from target
      const returnDamage = target.specs.combatPower * 0.3 * Math.random();
      const roundedReturnDamage = Math.round(returnDamage * 10) / 10;

      // Apply damage to target
      target.specs.hullPoints -= roundedAttackDamage;
      const targetDestroyed = target.specs.hullPoints <= 0;

      // Apply return fire to attacker
      ship.specs.hullPoints -= roundedReturnDamage;
      const attackerDestroyed = ship.specs.hullPoints <= 0;

      let salvageGenerated = false;
      let salvageId: string | null = null;

      if (targetDestroyed) {
        target.specs.hullPoints = 0;
        target.status = 'destroyed';

        // Generate salvage from destroyed target
        const targetStore = await ResourceStore.findOne({
          'ownerRef.kind': 'Ship',
          'ownerRef.item': target._id,
        });

        const salvageResources: Record<string, number> = {};
        if (targetStore) {
          const storeAny = targetStore as unknown as Record<string, number>;
          const cargoFields = ['metals','ice','silicates','rareEarths','helium3','organics','hydrogen','uranium','carbon','alloys','fuel','electronics','hullPlating','engines','sensors','computers','weaponSystems','lifeSupportUnits','solarPanels','fusionCores'];
          for (const field of cargoFields) {
            const amount = storeAny[field] ?? 0;
            if (amount > 0) {
              // 50% of cargo survives as salvage
              salvageResources[field] = Math.floor(amount * 0.5);
            }
          }
        }

        // Add hull scrap
        salvageResources['metals'] = (salvageResources['metals'] ?? 0) + Math.floor(target.specs.maxHullPoints / 10);

        const isNPC = target.ownerId.toString() === NPC_OWNER_ID;
        const sourceOwnerType = isNPC
          ? (target.name.includes('Pirate') ? 'pirate' as const : 'npc' as const)
          : 'player' as const;

        const salvage = await Salvage.create({
          name: `Wreckage of ${target.name}`,
          type: 'wreckage',
          position: target.position,
          sourceShipName: target.name,
          sourceOwnerType,
          resources: salvageResources,
          dataContent: null,
          techFragment: null,
          discovered: true,
          discoveredBy: replicantId,
          collected: false,
          createdAtTick: currentTick,
          expiresAtTick: currentTick + 500,
        });
        salvageGenerated = true;
        salvageId = salvage._id.toString();
      }

      if (attackerDestroyed) {
        ship.specs.hullPoints = 0;
        ship.status = 'destroyed';
      }

      await target.save();
      await ship.save();

      // Log combat for attacker (self)
      const { MemoryLog } = await import('../../db/models/index.js');
      await MemoryLog.create({
        replicantId,
        category: 'observation',
        title: `Combat: Attacked ${target.name}`,
        content: `Engaged ${target.name} at ${dist.toFixed(4)} AU. Dealt ${roundedAttackDamage} damage. Took ${roundedReturnDamage} return fire.${targetDestroyed ? ' Target destroyed — salvage generated.' : ''} ${attackerDestroyed ? ' CRITICAL: Our ship was destroyed by return fire.' : ''}`,
        tags: ['combat', 'attack', target.name],
        tick: currentTick,
      });

      // Log combat for target owner (if player-owned)
      if (target.ownerId.toString() !== NPC_OWNER_ID) {
        await Message.create({
          senderId: target.ownerId,
          recipientId: target.ownerId,
          subject: `COMBAT ALERT: ${target.name} under attack!`,
          body: `Your ship ${target.name} was attacked at tick ${currentTick}. Damage sustained: ${roundedAttackDamage}. Return fire dealt: ${roundedReturnDamage}.${targetDestroyed ? ' SHIP DESTROYED.' : ` Hull integrity: ${Math.max(0, target.specs.hullPoints).toFixed(0)}/${target.specs.maxHullPoints}.`}`,
          metadata: { type: 'combat_alert', attackerReplicantId: replicantId },
          senderPosition: target.position,
          recipientPosition: target.position,
          distanceAU: 0,
          sentAtTick: currentTick,
          deliverAtTick: currentTick,
          delivered: true,
        });
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            damageDealt: roundedAttackDamage,
            returnFireTaken: roundedReturnDamage,
            targetDestroyed,
            attackerDestroyed,
            yourHull: `${Math.max(0, ship.specs.hullPoints).toFixed(0)}/${ship.specs.maxHullPoints}`,
            targetHull: targetDestroyed ? 'DESTROYED' : `${target.specs.hullPoints.toFixed(0)}/${target.specs.maxHullPoints}`,
            salvage: salvageGenerated ? { id: salvageId, hint: 'Use collect_salvage to recover materials.' } : undefined,
            narrative: `Weapons fire exchanged with ${target.name} at ${dist.toFixed(4)} AU. Your weapons deal ${roundedAttackDamage} damage to the target${targetDestroyed ? ', tearing through the hull — the vessel breaks apart in a flash of venting atmosphere and debris' : ''}. Return fire scores ${roundedReturnDamage} on your hull${attackerDestroyed ? ' — catastrophic breach, ship lost' : ''}.${salvageGenerated ? ' Wreckage and cargo pods drift among the debris field.' : ''}`,
          }, null, 2),
        }],
      };
    },
  );
}
