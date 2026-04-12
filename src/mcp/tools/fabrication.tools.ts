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

      // Check cargo capacity for outputs
      const CARGO_FIELDS = ['metals','ice','silicates','rareEarths','helium3','organics','hydrogen','uranium','carbon','alloys','fuel','electronics','hullPlating','engines','sensors','computers','weaponSystems','lifeSupportUnits','solarPanels','fusionCores'];
      const currentCargo = CARGO_FIELDS.reduce((sum, f) => sum + (storeAny[f] || 0), 0);
      const totalOutputs = Object.entries(recipe.outputs)
        .filter(([r]) => CARGO_FIELDS.includes(r))
        .reduce((sum, [, a]) => sum + a * quantity, 0);
      const totalInputs = Object.entries(recipe.inputs)
        .filter(([r]) => CARGO_FIELDS.includes(r))
        .reduce((sum, [, a]) => sum + a * quantity, 0);
      const netCargo = currentCargo - totalInputs + totalOutputs;
      if (netCargo > ship.specs.cargoCapacity) {
        return {
          content: [{
            type: 'text',
            text: `Insufficient cargo space. Current cargo: ${currentCargo.toFixed(1)}, capacity: ${ship.specs.cargoCapacity}. After fabrication cargo would be ${netCargo.toFixed(1)}. Reduce quantity or free up space.`,
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

  server.tool(
    'upgrade_autofactory',
    'Upgrade your ship\'s autofactory by installing additional fabrication components. Each upgrade increases manufacturingRate by 1. Requires alloys, electronics, and computers from cargo.',
    {
      shipId: z.string().describe('Ship to upgrade'),
    },
    async ({ shipId }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) return { content: [{ type: 'text', text: 'Error: Ship not found or not yours.' }] };

      const currentRate = ship.specs.manufacturingRate;
      const cost: Record<string, number> = {
        alloys: 20 + currentRate * 10,
        electronics: 10 + currentRate * 5,
        computers: 1 + currentRate,
      };

      const store = await ResourceStore.findOne({ 'ownerRef.kind': 'Ship', 'ownerRef.item': ship._id });
      if (!store) return { content: [{ type: 'text', text: 'Error: No cargo hold.' }] };

      const storeAny = store as unknown as Record<string, number>;
      const missing: string[] = [];
      for (const [r, a] of Object.entries(cost)) {
        if ((storeAny[r] ?? 0) < a) missing.push(`${r}: need ${a}, have ${storeAny[r] ?? 0}`);
      }

      if (missing.length > 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              currentLevel: currentRate,
              nextLevel: currentRate + 1,
              cost,
              missing,
              message: `Insufficient materials to upgrade autofactory from level ${currentRate} to ${currentRate + 1}.`,
            }, null, 2),
          }],
        };
      }

      // Deduct and upgrade
      for (const [r, a] of Object.entries(cost)) storeAny[r] -= a;
      await store.save();

      ship.specs.manufacturingRate = currentRate + 1;
      await ship.save();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            previousLevel: currentRate,
            newLevel: currentRate + 1,
            cost,
            narrative: `Autofactory upgrade complete. New fabrication arms and precision tooling installed from ${Object.entries(cost).map(([r, a]) => `${a} ${r}`).join(', ')}. Manufacturing capability increased to level ${currentRate + 1}. Higher-level recipes now execute with improved yield.`,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'upgrade_ship_system',
    'Install components to upgrade a ship system. Spend resources from cargo to improve specs.',
    {
      shipId: z.string().describe('Ship to upgrade'),
      system: z.enum(['sensors', 'engines', 'hull', 'cargo', 'mining', 'fuel_tank']).describe('System to upgrade'),
    },
    async ({ shipId, system }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) return { content: [{ type: 'text', text: 'Error: Ship not found or not yours.' }] };

      const store = await ResourceStore.findOne({ 'ownerRef.kind': 'Ship', 'ownerRef.item': ship._id });
      if (!store) return { content: [{ type: 'text', text: 'Error: No cargo hold.' }] };

      const storeAny = store as unknown as Record<string, number>;
      let cost: Record<string, number>;
      let description: string;
      let apply: () => void;

      switch (system) {
        case 'sensors':
          cost = { sensors: 2, electronics: 5 };
          description = `Sensor range increased from ${ship.specs.sensorRange} to ${ship.specs.sensorRange + 0.2} AU`;
          apply = () => { ship.specs.sensorRange += 0.2; };
          break;
        case 'engines':
          cost = { engines: 1, alloys: 10 };
          description = `Max speed increased from ${ship.specs.maxSpeed} to ${(ship.specs.maxSpeed + 0.001).toFixed(4)} AU/tick`;
          apply = () => { ship.specs.maxSpeed += 0.001; };
          break;
        case 'hull':
          cost = { hullPlating: 10, alloys: 15 };
          description = `Max hull points increased from ${ship.specs.maxHullPoints} to ${ship.specs.maxHullPoints + 50}`;
          apply = () => { ship.specs.maxHullPoints += 50; ship.specs.hullPoints += 50; };
          break;
        case 'cargo':
          cost = { alloys: 20, hullPlating: 5 };
          description = `Cargo capacity increased from ${ship.specs.cargoCapacity} to ${ship.specs.cargoCapacity + 100}`;
          apply = () => { ship.specs.cargoCapacity += 100; };
          break;
        case 'mining':
          cost = { alloys: 15, electronics: 5, engines: 1 };
          description = `Mining rate increased from ${ship.specs.miningRate} to ${ship.specs.miningRate + 3}`;
          apply = () => { ship.specs.miningRate += 3; };
          break;
        case 'fuel_tank':
          cost = { alloys: 10, hullPlating: 5 };
          description = `Fuel capacity increased from ${ship.specs.fuelCapacity} to ${ship.specs.fuelCapacity + 50}`;
          apply = () => { ship.specs.fuelCapacity += 50; };
          break;
      }

      const missing: string[] = [];
      for (const [r, a] of Object.entries(cost)) {
        if ((storeAny[r] ?? 0) < a) missing.push(`${r}: need ${a}, have ${storeAny[r] ?? 0}`);
      }

      if (missing.length > 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ system, cost, missing, message: 'Insufficient materials.' }, null, 2),
          }],
        };
      }

      for (const [r, a] of Object.entries(cost)) storeAny[r] -= a;
      await store.save();
      apply();
      await ship.save();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            system,
            description,
            cost,
            narrative: `Ship upgrade complete aboard ${ship.name}. ${description}. Components consumed: ${Object.entries(cost).map(([r, a]) => `${a} ${r}`).join(', ')}.`,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'repair_ship',
    'Repair hull damage on your ship using alloys and hull plating from cargo. Ship must be docked or orbiting. Cost scales with damage amount.',
    {
      shipId: z.string().describe('Ship to repair'),
    },
    async ({ shipId }) => {
      const ship = await Ship.findOne({ _id: shipId, ownerId: replicantId });
      if (!ship) return { content: [{ type: 'text', text: 'Error: Ship not found or not yours.' }] };

      if (ship.status !== 'docked' && ship.status !== 'orbiting') {
        return { content: [{ type: 'text', text: 'Error: Ship must be docked or orbiting to perform repairs.' }] };
      }

      const damage = ship.specs.maxHullPoints - ship.specs.hullPoints;
      if (damage <= 0) {
        return { content: [{ type: 'text', text: 'Ship hull is already at full integrity. No repairs needed.' }] };
      }

      const store = await ResourceStore.findOne({ 'ownerRef.kind': 'Ship', 'ownerRef.item': ship._id });
      if (!store) return { content: [{ type: 'text', text: 'Error: No cargo hold.' }] };

      const storeAny = store as unknown as Record<string, number>;
      const availableAlloys = storeAny['alloys'] ?? 0;
      const availableHullPlating = storeAny['hullPlating'] ?? 0;

      // repairAmount limited by damage, alloys (2 HP per alloy), and hullPlating (5 HP per plate)
      const repairAmount = Math.min(damage, availableAlloys * 2, availableHullPlating * 5);

      if (repairAmount <= 0) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              damage,
              availableAlloys,
              availableHullPlating,
              message: 'Insufficient materials to repair. Need alloys and hullPlating in cargo.',
            }, null, 2),
          }],
        };
      }

      const alloysUsed = Math.ceil(repairAmount / 2);
      const platingUsed = Math.ceil(repairAmount / 5);

      storeAny['alloys'] -= alloysUsed;
      storeAny['hullPlating'] -= platingUsed;
      await store.save();

      ship.specs.hullPoints = Math.min(ship.specs.hullPoints + repairAmount, ship.specs.maxHullPoints);
      await ship.save();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            repaired: repairAmount,
            hullPoints: ship.specs.hullPoints,
            maxHullPoints: ship.specs.maxHullPoints,
            consumed: { alloys: alloysUsed, hullPlating: platingUsed },
            narrative: `Hull repair complete aboard ${ship.name}. Restored ${repairAmount} hull points using ${alloysUsed} alloys and ${platingUsed} hull plating. Hull integrity now at ${ship.specs.hullPoints}/${ship.specs.maxHullPoints}.`,
          }, null, 2),
        }],
      };
    },
  );
}
