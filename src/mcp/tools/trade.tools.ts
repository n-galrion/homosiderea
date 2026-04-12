import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Ship, Settlement, Market, ResourceStore, Replicant, Tick } from '../../db/models/index.js';

const CARGO_FIELDS = ['metals','ice','silicates','rareEarths','helium3','organics','hydrogen','uranium','carbon','alloys','fuel','electronics','hullPlating','engines','sensors','computers','weaponSystems','lifeSupportUnits','solarPanels','fusionCores'];
function getCargoUsed(store: Record<string, number>): number {
  return CARGO_FIELDS.reduce((sum, f) => sum + (store[f] || 0), 0);
}
import { distance } from '../../shared/physics.js';

export function registerTradeTools(server: McpServer, replicantId: string): void {

  server.tool(
    'trade',
    'Buy or sell resources at a human settlement\'s market. Your ship must be orbiting the same body as the settlement. Prices fluctuate based on supply and demand.',
    {
      shipId: z.string().describe('Your ship (must be orbiting the settlement\'s body)'),
      settlementId: z.string().optional().describe('Settlement ID to trade with'),
      settlementName: z.string().optional().describe('Settlement name to trade with (alternative to settlementId)'),
      action: z.enum(['buy', 'sell']).describe('Buy from them or sell to them'),
      resource: z.string().describe('Resource to trade (e.g., metals, electronics, computers)'),
      quantity: z.number().describe('How many units'),
    },
    async ({ shipId, settlementId, settlementName, action: tradeAction, resource, quantity }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) return { content: [{ type: 'text', text: 'Error: Ship not found or not yours.' }] };

      let settlement;
      if (settlementId) {
        settlement = await Settlement.findById(settlementId);
      } else if (settlementName) {
        settlement = await Settlement.findOne({ name: new RegExp(`^${settlementName}$`, 'i') });
      }
      if (!settlement) return { content: [{ type: 'text', text: 'Error: Settlement not found. Provide a valid settlementId or settlementName.' }] };

      // Check ship is at the same body
      if (ship.orbitingBodyId?.toString() !== settlement.bodyId.toString()) {
        return { content: [{ type: 'text', text: `Error: Your ship must be orbiting ${settlement.name}'s body to trade. Move there first.` }] };
      }

      // Check attitude
      const attitude = settlement.attitude.general;
      const replicantAttitude = (settlement.attitude.byReplicant as Record<string, number>)?.[replicantId] ?? attitude;
      if (replicantAttitude < -0.5) {
        return { content: [{ type: 'text', text: `${settlement.name} refuses to trade with you. Your reputation is too hostile (attitude: ${replicantAttitude.toFixed(2)}).` }] };
      }

      const market = await Market.findOne({ settlementId: settlement._id });
      if (!market) return { content: [{ type: 'text', text: `${settlement.name} has no active market.` }] };

      if (!market.availableResources.includes(resource)) {
        return { content: [{ type: 'text', text: `${settlement.name} doesn't trade in ${resource}. Available: ${market.availableResources.join(', ')}` }] };
      }

      const shipStore = await ResourceStore.findOne({ 'ownerRef.kind': 'Ship', 'ownerRef.item': ship._id });
      if (!shipStore) return { content: [{ type: 'text', text: 'Error: Ship has no cargo hold.' }] };

      const storeAny = shipStore as unknown as Record<string, number>;
      const prices = market.prices as { buy: Record<string, number>; sell: Record<string, number> };

      // Get replicant for credit balance
      const replicant = await Replicant.findById(replicantId);
      if (!replicant) return { content: [{ type: 'text', text: 'Error: Replicant not found.' }] };

      if (tradeAction === 'buy') {
        const price = prices.sell[resource];
        if (!price) {
          return { content: [{ type: 'text', text: `${settlement.name} doesn't sell ${resource}. They sell: ${Object.keys(prices.sell).join(', ') || 'nothing'}.` }] };
        }

        const totalCost = Math.round(price * quantity * 10) / 10;
        if (replicant.credits < totalCost) {
          return {
            content: [{
              type: 'text',
              text: `Insufficient credits. ${quantity} ${resource} costs ${totalCost} credits (${price}/unit). You have ${replicant.credits} credits.`,
            }],
          };
        }

        // Check cargo capacity
        const cargoUsed = getCargoUsed(storeAny);
        const space = ship.specs.cargoCapacity - cargoUsed;
        if (quantity > space) {
          return { content: [{ type: 'text', text: `Insufficient cargo space. Need ${quantity} units of space, have ${space}.` }] };
        }

        replicant.credits -= totalCost;
        await replicant.save();

        storeAny[resource] = (storeAny[resource] ?? 0) + quantity;
        await shipStore.save();

        settlement.attitude.general = Math.min(1, settlement.attitude.general + 0.01);
        settlement.markModified('attitude');
        await settlement.save();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              trade: 'buy',
              settlement: settlement.name,
              resource,
              quantity,
              pricePerUnit: price,
              totalCost,
              creditsRemaining: replicant.credits,
              narrative: `${ship.name} docks at ${settlement.name}'s trading port. ${quantity} units of ${resource} loaded into the cargo bay at ${price} credits/unit. Total: ${totalCost} credits. Balance: ${replicant.credits} credits.`,
            }, null, 2),
          }],
        };
      } else {
        const price = prices.buy[resource];
        if (!price) {
          return { content: [{ type: 'text', text: `${settlement.name} doesn't buy ${resource}. They buy: ${Object.keys(prices.buy).join(', ') || 'nothing'}.` }] };
        }

        const available = storeAny[resource] ?? 0;
        if (available < quantity) {
          return { content: [{ type: 'text', text: `You only have ${available} ${resource} to sell.` }] };
        }

        const totalRevenue = Math.round(price * quantity * 10) / 10;
        storeAny[resource] -= quantity;
        await shipStore.save();

        replicant.credits += totalRevenue;
        await replicant.save();

        settlement.attitude.general = Math.min(1, settlement.attitude.general + 0.005);
        settlement.markModified('attitude');
        await settlement.save();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              trade: 'sell',
              settlement: settlement.name,
              resource,
              quantity,
              pricePerUnit: price,
              totalRevenue,
              creditsRemaining: replicant.credits,
              narrative: `${quantity} units of ${resource} offloaded from ${ship.name} at ${settlement.name}. Revenue: ${totalRevenue} credits at ${price}/unit. Balance: ${replicant.credits} credits. ${settlement.name} is ${attitude > 0.5 ? 'pleased' : attitude > 0 ? 'satisfied' : 'grudgingly accepting'}.`,
            }, null, 2),
          }],
        };
      }
    },
  );

  server.tool(
    'check_market',
    'Check a settlement\'s current market prices without trading.',
    {
      settlementId: z.string().optional().describe('Settlement ID'),
      settlementName: z.string().optional().describe('Settlement name (alternative to settlementId)'),
    },
    async ({ settlementId, settlementName }) => {
      let settlement;
      if (settlementId) {
        settlement = await Settlement.findById(settlementId);
      } else if (settlementName) {
        settlement = await Settlement.findOne({ name: new RegExp(`^${settlementName}$`, 'i') });
      }
      if (!settlement) return { content: [{ type: 'text', text: 'Error: Settlement not found. Provide a valid settlementId or settlementName.' }] };

      const market = await Market.findOne({ settlementId: settlement._id });
      if (!market) return { content: [{ type: 'text', text: `${settlement.name} has no market.` }] };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            settlement: settlement.name,
            nation: settlement.nation,
            attitude: settlement.attitude.general.toFixed(2),
            theyBuyFromYou: market.prices.buy,
            theySellToYou: market.prices.sell,
            availableResources: market.availableResources,
            note: 'Prices are in credits. Buy prices = what they pay you when you sell. Sell prices = what they charge you to buy.',
          }, null, 2),
        }],
      };
    },
  );
}
