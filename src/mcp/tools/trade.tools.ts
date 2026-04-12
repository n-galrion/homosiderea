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
            note: 'Prices are in credits. Buy prices = what they pay you when you sell. Sell prices = what they charge you to buy. Prices shift based on supply/demand — settlements pay more for things they consume and less for things they produce.',
            supplyDemandHints: {
              theyProduce: settlement.production,
              theyConsume: settlement.consumption,
              tip: 'Sell what they consume (high demand = high buy price). Buy what they produce (high supply = low sell price).',
            },
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'barter',
    'Propose a direct resource-for-resource trade with a settlement. No credits involved — you offer resources and request others. The settlement evaluates the deal based on their needs. Good for when you lack credits or have surplus of something they want.',
    {
      shipId: z.string().describe('Your ship'),
      settlementId: z.string().optional().describe('Settlement ID'),
      settlementName: z.string().optional().describe('Settlement name'),
      offering: z.record(z.string(), z.number()).describe('What you offer: { "metals": 50, "ice": 20 }'),
      requesting: z.record(z.string(), z.number()).describe('What you want: { "electronics": 10, "computers": 2 }'),
    },
    async ({ shipId, settlementId, settlementName, offering, requesting }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) return { content: [{ type: 'text', text: 'Error: Ship not found.' }] };

      let settlement;
      if (settlementId) {
        settlement = await Settlement.findById(settlementId);
      } else if (settlementName) {
        settlement = await Settlement.findOne({ name: new RegExp(`^${settlementName}$`, 'i') });
      }
      if (!settlement) return { content: [{ type: 'text', text: 'Error: Settlement not found.' }] };

      if (ship.orbitingBodyId?.toString() !== settlement.bodyId.toString()) {
        return { content: [{ type: 'text', text: `Must be orbiting ${settlement.name}'s body.` }] };
      }

      const market = await Market.findOne({ settlementId: settlement._id });
      if (!market) return { content: [{ type: 'text', text: 'No market here.' }] };

      const shipStore = await ResourceStore.findOne({ 'ownerRef.kind': 'Ship', 'ownerRef.item': ship._id });
      if (!shipStore) return { content: [{ type: 'text', text: 'No cargo hold.' }] };

      const storeAny = shipStore as unknown as Record<string, number>;
      const buyPrices = market.prices.buy as Record<string, number>;
      const sellPrices = market.prices.sell as Record<string, number>;

      // Calculate value of what you're offering (at their buy prices — what they'd pay)
      let offerValue = 0;
      for (const [resource, amount] of Object.entries(offering)) {
        const available = storeAny[resource] ?? 0;
        if (available < amount) {
          return { content: [{ type: 'text', text: `You only have ${available} ${resource} (offering ${amount}).` }] };
        }
        const price = buyPrices[resource] || 1; // Default 1 credit if not listed
        offerValue += price * amount;
      }

      // Calculate value of what you're requesting (at their sell prices — what they'd charge)
      let requestValue = 0;
      for (const [resource, amount] of Object.entries(requesting)) {
        const price = sellPrices[resource];
        if (!price) {
          return { content: [{ type: 'text', text: `${settlement.name} doesn't sell ${resource}.` }] };
        }
        requestValue += price * amount;
      }

      // Settlement accepts if offer value >= request value * attitude modifier
      const attitudeMod = settlement.attitude.general > 0.5 ? 0.85 : settlement.attitude.general > 0 ? 1.0 : 1.3;
      const adjustedRequestValue = requestValue * attitudeMod;
      const accepted = offerValue >= adjustedRequestValue;

      if (!accepted) {
        const deficit = (adjustedRequestValue - offerValue).toFixed(1);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              accepted: false,
              offerValue: offerValue.toFixed(1),
              requestValue: requestValue.toFixed(1),
              attitudeModifier: attitudeMod,
              adjustedRequestValue: adjustedRequestValue.toFixed(1),
              deficit,
              message: `${settlement.name} rejects the deal. Your offer is worth ${offerValue.toFixed(0)} credits to them, but what you're asking is worth ${adjustedRequestValue.toFixed(0)}. ${settlement.attitude.general < 0.5 ? 'Your reputation makes them drive a harder bargain.' : 'Offer more or ask for less.'}`,
            }, null, 2),
          }],
        };
      }

      // Check cargo space for incoming resources
      const cargoUsed = getCargoUsed(storeAny);
      const outgoing = Object.values(offering).reduce((a, b) => a + b, 0);
      const incoming = Object.values(requesting).reduce((a, b) => a + b, 0);
      const netCargo = cargoUsed - outgoing + incoming;
      if (netCargo > ship.specs.cargoCapacity) {
        return { content: [{ type: 'text', text: `Not enough cargo space. After trade: ${netCargo}/${ship.specs.cargoCapacity}.` }] };
      }

      // Execute the swap
      for (const [resource, amount] of Object.entries(offering)) {
        storeAny[resource] -= amount;
      }
      for (const [resource, amount] of Object.entries(requesting)) {
        storeAny[resource] = (storeAny[resource] ?? 0) + amount;
      }
      await shipStore.save();

      settlement.attitude.general = Math.min(1, settlement.attitude.general + 0.01);
      settlement.markModified('attitude');
      await settlement.save();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            accepted: true,
            gave: offering,
            received: requesting,
            offerValue: offerValue.toFixed(1),
            requestValue: requestValue.toFixed(1),
            narrative: `Barter deal struck at ${settlement.name}. Exchanged ${Object.entries(offering).map(([r,a]) => `${a} ${r}`).join(', ')} for ${Object.entries(requesting).map(([r,a]) => `${a} ${r}`).join(', ')}. ${settlement.attitude.general > 0.5 ? 'Both parties satisfied.' : 'A fair enough deal.'}`,
          }, null, 2),
        }],
      };
    },
  );
}
