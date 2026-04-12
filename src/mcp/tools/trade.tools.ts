import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Ship, Settlement, Market, ResourceStore, Replicant, Tick } from '../../db/models/index.js';
import { distance } from '../../shared/physics.js';

export function registerTradeTools(server: McpServer, replicantId: string): void {

  server.tool(
    'trade',
    'Buy or sell resources at a human settlement\'s market. Your ship must be orbiting the same body as the settlement. Prices fluctuate based on supply and demand.',
    {
      shipId: z.string().describe('Your ship (must be orbiting the settlement\'s body)'),
      settlementId: z.string().describe('Settlement to trade with'),
      action: z.enum(['buy', 'sell']).describe('Buy from them or sell to them'),
      resource: z.string().describe('Resource to trade (e.g., metals, electronics, computers)'),
      quantity: z.number().describe('How many units'),
    },
    async ({ shipId, settlementId, action: tradeAction, resource, quantity }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) return { content: [{ type: 'text', text: 'Error: Ship not found or not yours.' }] };

      const settlement = await Settlement.findById(settlementId);
      if (!settlement) return { content: [{ type: 'text', text: 'Error: Settlement not found.' }] };

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

      if (tradeAction === 'buy') {
        // Buying FROM settlement — they sell to us at their sell price
        const price = prices.sell[resource];
        if (!price) {
          return { content: [{ type: 'text', text: `${settlement.name} doesn't sell ${resource}. They sell: ${Object.keys(prices.sell).join(', ') || 'nothing'}.` }] };
        }

        const totalCost = price * quantity;
        // Pay with credits (fuel as universal currency for now)
        const fuelAvailable = storeAny.fuel ?? 0;
        if (fuelAvailable < totalCost) {
          return {
            content: [{
              type: 'text',
              text: `Insufficient payment. ${quantity} ${resource} costs ${totalCost.toFixed(1)} fuel (${price.toFixed(1)}/unit). You have ${fuelAvailable} fuel.`,
            }],
          };
        }

        storeAny.fuel -= totalCost;
        storeAny[resource] = (storeAny[resource] ?? 0) + quantity;
        await shipStore.save();

        // Improve attitude slightly
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
              paidWith: 'fuel',
              narrative: `The docking clamps engage as ${ship.name} connects to ${settlement.name}'s trading port. ${quantity} units of ${resource} are loaded into the cargo bay at ${price.toFixed(1)} fuel per unit. Total cost: ${totalCost.toFixed(1)} fuel. The harbormaster nods — business is business.`,
            }, null, 2),
          }],
        };
      } else {
        // Selling TO settlement — they buy from us at their buy price
        const price = prices.buy[resource];
        if (!price) {
          return { content: [{ type: 'text', text: `${settlement.name} doesn't buy ${resource}. They buy: ${Object.keys(prices.buy).join(', ') || 'nothing'}.` }] };
        }

        const available = storeAny[resource] ?? 0;
        if (available < quantity) {
          return { content: [{ type: 'text', text: `You only have ${available} ${resource} to sell.` }] };
        }

        const totalRevenue = price * quantity;
        storeAny[resource] -= quantity;
        storeAny.fuel = (storeAny.fuel ?? 0) + totalRevenue;
        await shipStore.save();

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
              receivedAs: 'fuel',
              narrative: `${quantity} units of ${resource} offloaded from ${ship.name} at ${settlement.name}. The exchange rate of ${price.toFixed(1)} fuel per unit yields ${totalRevenue.toFixed(1)} fuel in payment. Your reserves are replenished. ${settlement.name} is ${attitude > 0.5 ? 'pleased with the transaction' : attitude > 0 ? 'content with the deal' : 'grudgingly accepting'}.`,
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
      settlementId: z.string().describe('Settlement ID'),
    },
    async ({ settlementId }) => {
      const settlement = await Settlement.findById(settlementId);
      if (!settlement) return { content: [{ type: 'text', text: 'Error: Settlement not found.' }] };

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
            note: 'Prices are in fuel units. Buy prices = what they pay you. Sell prices = what they charge you.',
          }, null, 2),
        }],
      };
    },
  );
}
