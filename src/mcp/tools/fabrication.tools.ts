import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Ship, ResourceStore, Tick } from '../../db/models/index.js';

/**
 * Primitive autofactory recipes — available on any ship with manufacturingRate > 0.
 * These are slow and inefficient compared to proper factory blueprints,
 * but they break the bootstrap deadlock.
 */
const AUTOFACTORY_RECIPES: Record<string, {
  description: string;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  ticksRequired: number;
}> = {
  smelt_alloys: {
    description: 'Crude smelting — heat metals in the reactor exhaust to produce basic alloys. Wasteful but functional.',
    inputs: { metals: 15 },
    outputs: { alloys: 5 },
    ticksRequired: 1,
  },
  fabricate_electronics: {
    description: 'Strip and re-etch silicate wafers using onboard laser tools. Low yield, high waste.',
    inputs: { silicates: 10, metals: 5 },
    outputs: { electronics: 3 },
    ticksRequired: 2,
  },
  assemble_computer: {
    description: 'Hand-solder a basic flight computer from electronics and alloy housings. Crude but operational.',
    inputs: { electronics: 8, alloys: 5 },
    outputs: { computers: 1 },
    ticksRequired: 3,
  },
  assemble_engine: {
    description: 'Fabricate a low-thrust ion engine from alloy nozzle components and electronic control boards.',
    inputs: { alloys: 15, electronics: 5 },
    outputs: { engines: 1 },
    ticksRequired: 3,
  },
  assemble_sensor: {
    description: 'Build a basic electromagnetic sensor array from electronics and silicate optical elements.',
    inputs: { electronics: 6, silicates: 5 },
    outputs: { sensors: 1 },
    ticksRequired: 2,
  },
  fabricate_hull_plating: {
    description: 'Press and temper alloy sheets into hull plating segments using thermal cycling in the reactor.',
    inputs: { alloys: 10, metals: 5 },
    outputs: { hullPlating: 5 },
    ticksRequired: 2,
  },
  assemble_solar_panel: {
    description: 'Cut and wire photovoltaic cells from silicate substrates. Low efficiency but functional.',
    inputs: { silicates: 10, electronics: 3 },
    outputs: { solarPanels: 1 },
    ticksRequired: 2,
  },
  crack_fuel: {
    description: 'Electrolyze ice into hydrogen and oxygen, then process into reaction mass fuel.',
    inputs: { ice: 10 },
    outputs: { fuel: 8 },
    ticksRequired: 1,
  },
  assemble_life_support: {
    description: 'Build a basic CO2 scrubber and oxygen recycler from alloys, electronics, and ice reserves.',
    inputs: { alloys: 10, electronics: 5, ice: 5 },
    outputs: { lifeSupportUnits: 1 },
    ticksRequired: 3,
  },
  salvage_debris: {
    description: 'Collect and process nearby orbital debris and micrometeorites for raw materials.',
    inputs: {},
    outputs: { metals: 3, silicates: 2 },
    ticksRequired: 1,
  },
};

export function registerFabricationTools(server: McpServer, replicantId: string): void {

  server.tool(
    'list_autofactory_recipes',
    'List what your ship\'s onboard autofactory can fabricate. These are primitive recipes — slower and less efficient than a proper factory, but they work anywhere.',
    {},
    async () => {
      const recipes = Object.entries(AUTOFACTORY_RECIPES).map(([id, r]) => ({
        id,
        description: r.description,
        inputs: r.inputs,
        outputs: r.outputs,
        ticksRequired: r.ticksRequired,
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            note: 'These are primitive shipboard recipes. A proper factory structure produces more efficiently.',
            recipes,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'autofabricate',
    'Use your ship\'s onboard autofactory to craft items from cargo. Slower and less efficient than a factory structure, but available anywhere. Your ship needs manufacturingRate > 0.',
    {
      shipId: z.string().describe('Ship with autofactory capability'),
      recipeId: z.string().describe('Recipe ID from list_autofactory_recipes'),
      quantity: z.number().default(1).describe('Number of batches'),
    },
    async ({ shipId, recipeId, quantity }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) {
        return { content: [{ type: 'text', text: 'Error: Ship not found or not yours.' }] };
      }

      if (ship.specs.manufacturingRate <= 0) {
        return { content: [{ type: 'text', text: 'Error: This ship has no autofactory capability (manufacturingRate = 0).' }] };
      }

      const recipe = AUTOFACTORY_RECIPES[recipeId];
      if (!recipe) {
        return { content: [{ type: 'text', text: `Error: Unknown recipe "${recipeId}". Use list_autofactory_recipes to see available recipes.` }] };
      }

      const store = await ResourceStore.findOne({
        'ownerRef.kind': 'Ship',
        'ownerRef.item': ship._id,
      });
      if (!store) {
        return { content: [{ type: 'text', text: 'Error: Ship has no cargo hold.' }] };
      }

      // Check materials for all batches
      const storeAny = store as unknown as Record<string, number>;
      const missing: string[] = [];
      for (const [resource, amount] of Object.entries(recipe.inputs)) {
        const needed = amount * quantity;
        const available = storeAny[resource] ?? 0;
        if (available < needed) {
          missing.push(`${resource}: need ${needed}, have ${available}`);
        }
      }

      if (missing.length > 0) {
        return {
          content: [{
            type: 'text',
            text: `Insufficient materials:\n${missing.join('\n')}\n\nReduce quantity or gather more resources.`,
          }],
        };
      }

      // Deduct inputs
      for (const [resource, amount] of Object.entries(recipe.inputs)) {
        storeAny[resource] -= amount * quantity;
      }

      // Add outputs
      for (const [resource, amount] of Object.entries(recipe.outputs)) {
        storeAny[resource] = (storeAny[resource] ?? 0) + amount * quantity;
      }

      await store.save();

      // Build narrative
      const inputDesc = Object.entries(recipe.inputs)
        .map(([r, a]) => `${a * quantity} ${r}`)
        .join(', ') || 'ambient debris';
      const outputDesc = Object.entries(recipe.outputs)
        .map(([r, a]) => `${a * quantity} ${r}`)
        .join(', ');

      const narrative = `The autofactory hums to life aboard ${ship.name}. ${recipe.description} Consumed: ${inputDesc}. Produced: ${outputDesc}.`;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            recipe: recipeId,
            quantity,
            consumed: Object.fromEntries(
              Object.entries(recipe.inputs).map(([r, a]) => [r, a * quantity])
            ),
            produced: Object.fromEntries(
              Object.entries(recipe.outputs).map(([r, a]) => [r, a * quantity])
            ),
            narrative,
          }, null, 2),
        }],
      };
    },
  );
}
