import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Ship, Structure, Colony, ResourceStore } from '../../db/models/index.js';

const CARGO_FIELDS = [
  'metals','ice','silicates','rareEarths','helium3','organics','hydrogen','uranium','carbon',
  'alloys','fuel','electronics','hullPlating','engines','sensors','computers','weaponSystems',
  'lifeSupportUnits','solarPanels','fusionCores',
];

function getUsed(store: Record<string, number>): number {
  return CARGO_FIELDS.reduce((sum, f) => sum + (store[f] || 0), 0);
}

export function registerCargoTools(server: McpServer, replicantId: string): void {

  server.tool(
    'load_cargo',
    'Load resources from a structure or colony into your ship. Ship must be at the same body. Respects cargo capacity.',
    {
      shipId: z.string().describe('Your ship'),
      fromId: z.string().describe('Structure or colony ID to load from'),
      fromType: z.enum(['Structure', 'Colony']).describe('Source type'),
      resources: z.record(z.string(), z.number()).describe('Resources to load: { "metals": 50, "fuel": 20 }'),
    },
    async ({ shipId, fromId, fromType, resources }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) return { content: [{ type: 'text', text: 'Error: Ship not found.' }] };

      const shipStore = await ResourceStore.findOne({ 'ownerRef.kind': 'Ship', 'ownerRef.item': ship._id });
      if (!shipStore) return { content: [{ type: 'text', text: 'Error: Ship has no cargo hold.' }] };

      const sourceStore = await ResourceStore.findOne({ 'ownerRef.kind': fromType, 'ownerRef.item': fromId });
      if (!sourceStore) return { content: [{ type: 'text', text: 'Error: Source has no storage.' }] };

      const shipAny = shipStore as unknown as Record<string, number>;
      const srcAny = sourceStore as unknown as Record<string, number>;
      const loaded: Record<string, number> = {};

      for (const [resource, amount] of Object.entries(resources)) {
        if (amount <= 0) continue;
        const available = srcAny[resource] ?? 0;
        if (available <= 0) continue;

        const shipUsed = getUsed(shipAny);
        const space = ship.specs.cargoCapacity - shipUsed;
        if (space <= 0) break;

        const toLoad = Math.min(amount, available, space);
        srcAny[resource] -= toLoad;
        shipAny[resource] = (shipAny[resource] ?? 0) + toLoad;
        loaded[resource] = toLoad;
      }

      await shipStore.save();
      await sourceStore.save();

      const desc = Object.entries(loaded).map(([r, a]) => `${a} ${r}`).join(', ');
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            loaded,
            shipCargoUsed: getUsed(shipAny),
            shipCargoCapacity: ship.specs.cargoCapacity,
            narrative: desc ? `Loaded ${desc} into ${ship.name}.` : 'Nothing to load.',
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'unload_cargo',
    'Unload resources from your ship into a structure or colony storage. Ship must be at the same body.',
    {
      shipId: z.string().describe('Your ship'),
      toId: z.string().describe('Structure or colony ID to unload into'),
      toType: z.enum(['Structure', 'Colony']).describe('Destination type'),
      resources: z.record(z.string(), z.number()).describe('Resources to unload: { "metals": 50 }. Use "all" as key to unload everything.'),
    },
    async ({ shipId, toId, toType, resources }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) return { content: [{ type: 'text', text: 'Error: Ship not found.' }] };

      const shipStore = await ResourceStore.findOne({ 'ownerRef.kind': 'Ship', 'ownerRef.item': ship._id });
      if (!shipStore) return { content: [{ type: 'text', text: 'Error: Ship has no cargo.' }] };

      const destStore = await ResourceStore.findOne({ 'ownerRef.kind': toType, 'ownerRef.item': toId });
      if (!destStore) {
        // Create storage if it doesn't exist
        await ResourceStore.create({ ownerRef: { kind: toType, item: toId } });
      }
      const dest = destStore || await ResourceStore.findOne({ 'ownerRef.kind': toType, 'ownerRef.item': toId });
      if (!dest) return { content: [{ type: 'text', text: 'Error: Could not create storage.' }] };

      const shipAny = shipStore as unknown as Record<string, number>;
      const destAny = dest as unknown as Record<string, number>;
      const unloaded: Record<string, number> = {};

      // Handle "all" key
      const resourcesToUnload = 'all' in resources
        ? Object.fromEntries(CARGO_FIELDS.filter(f => (shipAny[f] ?? 0) > 0).map(f => [f, shipAny[f]]))
        : resources;

      for (const [resource, amount] of Object.entries(resourcesToUnload)) {
        if (amount <= 0) continue;
        const available = shipAny[resource] ?? 0;
        if (available <= 0) continue;

        const toUnload = Math.min(amount, available);
        shipAny[resource] -= toUnload;
        destAny[resource] = (destAny[resource] ?? 0) + toUnload;
        unloaded[resource] = toUnload;
      }

      await shipStore.save();
      await dest.save();

      const desc = Object.entries(unloaded).map(([r, a]) => `${a} ${r}`).join(', ');
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            unloaded,
            shipCargoUsed: getUsed(shipAny),
            narrative: desc ? `Unloaded ${desc} from ${ship.name}.` : 'Nothing to unload.',
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'transfer_fuel',
    'Transfer fuel between your ship\'s fuel tank and cargo fuel reserves.',
    {
      shipId: z.string().describe('Your ship'),
      direction: z.enum(['cargo_to_tank', 'tank_to_cargo']).describe('Transfer direction'),
      amount: z.number().describe('Fuel units to transfer'),
    },
    async ({ shipId, direction, amount }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) return { content: [{ type: 'text', text: 'Error: Ship not found.' }] };

      const store = await ResourceStore.findOne({ 'ownerRef.kind': 'Ship', 'ownerRef.item': ship._id });
      if (!store) return { content: [{ type: 'text', text: 'Error: No cargo hold.' }] };

      const storeAny = store as unknown as Record<string, number>;
      const cargoFuel = storeAny.fuel ?? 0;
      const tankFuel = ship.fuel;
      const tankCapacity = ship.specs.fuelCapacity;

      if (direction === 'cargo_to_tank') {
        const space = tankCapacity - tankFuel;
        const toTransfer = Math.min(amount, cargoFuel, space);
        if (toTransfer <= 0) {
          return { content: [{ type: 'text', text: `Cannot transfer — tank is full (${tankFuel}/${tankCapacity}) or no cargo fuel (${cargoFuel}).` }] };
        }
        storeAny.fuel -= toTransfer;
        ship.fuel += toTransfer;
        await store.save();
        await ship.save();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              transferred: toTransfer,
              direction: 'cargo → tank',
              tankFuel: ship.fuel,
              tankCapacity,
              cargoFuel: storeAny.fuel,
              narrative: `Transferred ${toTransfer} fuel from cargo to tank. Tank now at ${ship.fuel}/${tankCapacity}.`,
            }, null, 2),
          }],
        };
      } else {
        const storeUsed = getUsed(storeAny);
        const cargoSpace = ship.specs.cargoCapacity - storeUsed;
        const toTransfer = Math.min(amount, tankFuel, cargoSpace);
        if (toTransfer <= 0) {
          return { content: [{ type: 'text', text: `Cannot transfer — tank empty (${tankFuel}) or cargo full.` }] };
        }
        ship.fuel -= toTransfer;
        storeAny.fuel = (storeAny.fuel ?? 0) + toTransfer;
        await store.save();
        await ship.save();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              transferred: toTransfer,
              direction: 'tank → cargo',
              tankFuel: ship.fuel,
              cargoFuel: storeAny.fuel,
              narrative: `Transferred ${toTransfer} fuel from tank to cargo. Tank now at ${ship.fuel}/${tankCapacity}.`,
            }, null, 2),
          }],
        };
      }
    },
  );
}
