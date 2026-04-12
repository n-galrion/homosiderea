import { Router, type Request, type Response, type NextFunction } from 'express';
import { Ship, CelestialBody, ResourceStore, Tick } from '../../db/models/index.js';
import { distance, travelTimeTicks, fuelCost } from '../../shared/physics.js';
import { gameHoursPerTick, gameHoursToRealMs, formatGameTime, formatRealWait } from '../../shared/gameTime.js';

export const shipRoutes = Router();

/** Enrich a ship document with transit/mining status info. */
async function enrichShip(ship: Record<string, unknown>, currentTick: number): Promise<Record<string, unknown>> {
  const enriched = { ...ship };

  // Transit ETA info
  const nav = ship.navigation as Record<string, unknown> | undefined;
  if (ship.status === 'in_transit' && nav?.arrivalTick != null) {
    const arrivalTick = nav.arrivalTick as number;
    const departureTick = (nav.departureTick as number) ?? currentTick;
    const totalTicks = arrivalTick - departureTick;
    const elapsed = currentTick - departureTick;
    const ticksRemaining = Math.max(0, arrivalTick - currentTick);
    const percentComplete = totalTicks > 0 ? Math.min(100, (elapsed / totalTicks) * 100) : 100;
    const gameHoursRemaining = ticksRemaining * gameHoursPerTick();

    enriched.transitInfo = {
      ticksRemaining,
      estimatedArrivalTick: arrivalTick,
      gameTimeRemaining: formatGameTime(gameHoursRemaining),
      realTimeRemaining: formatRealWait(gameHoursRemaining),
      estimatedArrivalMs: gameHoursToRealMs(gameHoursRemaining),
      percentComplete: parseFloat(percentComplete.toFixed(1)),
    };
  }

  // Mining info
  const miningState = ship.miningState as Record<string, unknown> | null;
  if (miningState?.active) {
    enriched.miningInfo = {
      active: true,
      resourceType: miningState.resourceType || 'all accessible',
      startedAtTick: miningState.startedAtTick,
      ticksMining: miningState.startedAtTick != null
        ? currentTick - (miningState.startedAtTick as number)
        : 0,
    };
  }

  return enriched;
}

// List own ships
shipRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, type } = req.query;
    const filter: Record<string, unknown> = { ownerId: req.replicantId };
    if (status) filter.status = status;
    if (type) filter.type = type;

    const ships = await Ship.find(filter).lean();

    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const currentTick = latestTick?.tickNumber ?? 0;

    const enriched = await Promise.all(
      ships.map(s => enrichShip(s as unknown as Record<string, unknown>, currentTick))
    );

    res.json(enriched);
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

    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const currentTick = latestTick?.tickNumber ?? 0;

    const enriched = await enrichShip(ship as unknown as Record<string, unknown>, currentTick);

    res.json(enriched);
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

// Calculate route without committing
shipRoutes.get('/:id/route/:bodyId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ship = await Ship.findOne({ _id: req.params.id, ownerId: req.replicantId }).lean();
    if (!ship) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Ship not found' });
      return;
    }

    const destBody = await CelestialBody.findById(req.params.bodyId).lean();
    if (!destBody) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Destination body not found' });
      return;
    }

    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    const currentTick = latestTick?.tickNumber ?? 0;

    const dist = distance(ship.position, destBody.position);
    const travelTicks = travelTimeTicks(ship.position, destBody.position, ship.specs.maxSpeed);
    const fuel = fuelCost(dist);
    const feasible = ship.fuel >= fuel;
    const gameHoursTravel = travelTicks * gameHoursPerTick();

    res.json({
      from: ship.name,
      to: destBody.name,
      distanceAU: parseFloat(dist.toFixed(6)),
      travelTicks,
      fuelCost: fuel,
      fuelAvailable: ship.fuel,
      feasible,
      estimatedArrivalTick: currentTick + travelTicks,
      estimatedArrival: {
        gameTime: formatGameTime(gameHoursTravel),
        realTime: formatRealWait(gameHoursTravel),
        realTimeMs: gameHoursToRealMs(gameHoursTravel),
      },
      shipSpeed: ship.specs.maxSpeed,
    });
  } catch (err) {
    next(err);
  }
});

// Get upgrade costs for a ship system
shipRoutes.get('/:id/upgrades', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ship = await Ship.findOne({ _id: req.params.id, ownerId: req.replicantId }).lean();
    if (!ship) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Ship not found' });
      return;
    }

    const upgrades: Record<string, {
      currentValue: number;
      newValue: number;
      improvement: string;
      cost: Record<string, number>;
    }> = {
      sensors: {
        currentValue: ship.specs.sensorRange,
        newValue: parseFloat((ship.specs.sensorRange + 0.2).toFixed(2)),
        improvement: `+0.2 AU sensor range`,
        cost: { sensors: 2, electronics: 5 },
      },
      engines: {
        currentValue: ship.specs.maxSpeed,
        newValue: parseFloat((ship.specs.maxSpeed + 0.001).toFixed(4)),
        improvement: `+0.001 AU/tick max speed`,
        cost: { engines: 1, alloys: 10 },
      },
      hull: {
        currentValue: ship.specs.maxHullPoints,
        newValue: ship.specs.maxHullPoints + 50,
        improvement: `+50 max hull points`,
        cost: { hullPlating: 10, alloys: 15 },
      },
      cargo: {
        currentValue: ship.specs.cargoCapacity,
        newValue: ship.specs.cargoCapacity + 100,
        improvement: `+100 cargo capacity`,
        cost: { alloys: 20, hullPlating: 5 },
      },
      mining: {
        currentValue: ship.specs.miningRate,
        newValue: ship.specs.miningRate + 3,
        improvement: `+3 mining rate`,
        cost: { alloys: 15, electronics: 5, engines: 1 },
      },
      fuel_tank: {
        currentValue: ship.specs.fuelCapacity,
        newValue: ship.specs.fuelCapacity + 50,
        improvement: `+50 fuel capacity`,
        cost: { alloys: 10, hullPlating: 5 },
      },
    };

    const autofactoryLevel = ship.specs.manufacturingRate;
    const autofactoryUpgrade = {
      currentLevel: autofactoryLevel,
      newLevel: autofactoryLevel + 1,
      cost: {
        alloys: 20 + autofactoryLevel * 10,
        electronics: 10 + autofactoryLevel * 5,
        computers: 1 + autofactoryLevel,
      },
    };

    res.json({
      shipId: ship._id.toString(),
      shipName: ship.name,
      systemUpgrades: upgrades,
      autofactoryUpgrade,
    });
  } catch (err) {
    next(err);
  }
});
