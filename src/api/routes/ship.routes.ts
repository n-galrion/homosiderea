import { Router, type Request, type Response, type NextFunction } from 'express';
import { Ship, ResourceStore } from '../../db/models/index.js';

export const shipRoutes = Router();

// List own ships
shipRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, type } = req.query;
    const filter: Record<string, unknown> = { ownerId: req.replicantId };
    if (status) filter.status = status;
    if (type) filter.type = type;

    const ships = await Ship.find(filter).lean();
    res.json(ships);
  } catch (err) {
    next(err);
  }
});

// Get specific ship
shipRoutes.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ship = await Ship.findOne({ _id: req.params.id, ownerId: req.replicantId }).lean();
    if (!ship) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Ship not found' });
      return;
    }
    res.json(ship);
  } catch (err) {
    next(err);
  }
});

// Get ship inventory
shipRoutes.get('/:id/inventory', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ship = await Ship.findOne({ _id: req.params.id, ownerId: req.replicantId }).lean();
    if (!ship) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Ship not found' });
      return;
    }

    const store = await ResourceStore.findOne({
      'ownerRef.kind': 'Ship',
      'ownerRef.item': ship._id,
    }).lean();

    res.json(store || { message: 'No inventory' });
  } catch (err) {
    next(err);
  }
});

// List autofactory recipes
shipRoutes.get('/:id/autofactory', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ship = await Ship.findOne({ _id: req.params.id, ownerId: req.replicantId }).lean();
    if (!ship) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Ship not found' });
      return;
    }
    if (ship.specs.manufacturingRate <= 0) {
      res.json({ error: 'NO_AUTOFACTORY', message: 'This ship has no autofactory capability.' });
      return;
    }

    const RECIPES: Record<string, { description: string; inputs: Record<string, number>; outputs: Record<string, number>; ticksRequired: number }> = {
      smelt_alloys: { description: 'Crude smelting — metals → alloys', inputs: { metals: 15 }, outputs: { alloys: 5 }, ticksRequired: 1 },
      fabricate_electronics: { description: 'Laser-etch silicate wafers', inputs: { silicates: 10, metals: 5 }, outputs: { electronics: 3 }, ticksRequired: 2 },
      assemble_computer: { description: 'Hand-solder flight computer', inputs: { electronics: 8, alloys: 5 }, outputs: { computers: 1 }, ticksRequired: 3 },
      assemble_engine: { description: 'Low-thrust ion engine', inputs: { alloys: 15, electronics: 5 }, outputs: { engines: 1 }, ticksRequired: 3 },
      assemble_sensor: { description: 'EM sensor array', inputs: { electronics: 6, silicates: 5 }, outputs: { sensors: 1 }, ticksRequired: 2 },
      fabricate_hull_plating: { description: 'Pressed alloy hull plates', inputs: { alloys: 10, metals: 5 }, outputs: { hullPlating: 5 }, ticksRequired: 2 },
      assemble_solar_panel: { description: 'Photovoltaic cells', inputs: { silicates: 10, electronics: 3 }, outputs: { solarPanels: 1 }, ticksRequired: 2 },
      crack_fuel: { description: 'Electrolyze ice into fuel', inputs: { ice: 10 }, outputs: { fuel: 8 }, ticksRequired: 1 },
      assemble_life_support: { description: 'CO2 scrubber + O2 recycler', inputs: { alloys: 10, electronics: 5, ice: 5 }, outputs: { lifeSupportUnits: 1 }, ticksRequired: 3 },
      salvage_debris: { description: 'Collect orbital debris', inputs: {}, outputs: { metals: 3, silicates: 2 }, ticksRequired: 1 },
    };

    res.json({ manufacturingRate: ship.specs.manufacturingRate, recipes: RECIPES });
  } catch (err) {
    next(err);
  }
});

// Use autofactory
shipRoutes.post('/:id/autofactory', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { recipeId, quantity = 1 } = req.body;
    if (!recipeId) {
      res.status(400).json({ error: 'VALIDATION', message: 'recipeId is required' });
      return;
    }

    const ship = await Ship.findOne({ _id: req.params.id, ownerId: req.replicantId });
    if (!ship) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Ship not found' });
      return;
    }
    if (ship.specs.manufacturingRate <= 0) {
      res.status(400).json({ error: 'NO_AUTOFACTORY', message: 'This ship has no autofactory capability.' });
      return;
    }

    const RECIPES: Record<string, { inputs: Record<string, number>; outputs: Record<string, number> }> = {
      smelt_alloys: { inputs: { metals: 15 }, outputs: { alloys: 5 } },
      fabricate_electronics: { inputs: { silicates: 10, metals: 5 }, outputs: { electronics: 3 } },
      assemble_computer: { inputs: { electronics: 8, alloys: 5 }, outputs: { computers: 1 } },
      assemble_engine: { inputs: { alloys: 15, electronics: 5 }, outputs: { engines: 1 } },
      assemble_sensor: { inputs: { electronics: 6, silicates: 5 }, outputs: { sensors: 1 } },
      fabricate_hull_plating: { inputs: { alloys: 10, metals: 5 }, outputs: { hullPlating: 5 } },
      assemble_solar_panel: { inputs: { silicates: 10, electronics: 3 }, outputs: { solarPanels: 1 } },
      crack_fuel: { inputs: { ice: 10 }, outputs: { fuel: 8 } },
      assemble_life_support: { inputs: { alloys: 10, electronics: 5, ice: 5 }, outputs: { lifeSupportUnits: 1 } },
      salvage_debris: { inputs: {}, outputs: { metals: 3, silicates: 2 } },
    };

    const recipe = RECIPES[recipeId];
    if (!recipe) {
      res.status(400).json({ error: 'UNKNOWN_RECIPE', message: `Unknown recipe: ${recipeId}` });
      return;
    }

    const store = await ResourceStore.findOne({ 'ownerRef.kind': 'Ship', 'ownerRef.item': ship._id });
    if (!store) {
      res.status(400).json({ error: 'NO_CARGO', message: 'Ship has no cargo hold' });
      return;
    }

    const storeAny = store as unknown as Record<string, number>;
    for (const [resource, amount] of Object.entries(recipe.inputs)) {
      if ((storeAny[resource] ?? 0) < amount * quantity) {
        res.status(400).json({
          error: 'INSUFFICIENT_RESOURCES',
          message: `Need ${amount * quantity} ${resource}, have ${storeAny[resource] ?? 0}`,
        });
        return;
      }
    }

    for (const [r, a] of Object.entries(recipe.inputs)) storeAny[r] -= a * quantity;
    for (const [r, a] of Object.entries(recipe.outputs)) storeAny[r] = (storeAny[r] ?? 0) + a * quantity;
    await store.save();

    res.json({
      success: true,
      recipe: recipeId,
      quantity,
      consumed: Object.fromEntries(Object.entries(recipe.inputs).map(([r, a]) => [r, a * quantity])),
      produced: Object.fromEntries(Object.entries(recipe.outputs).map(([r, a]) => [r, a * quantity])),
    });
  } catch (err) {
    next(err);
  }
});
