import { CelestialBody, Settlement, Market } from '../models/index.js';

interface SettlementSeed {
  name: string;
  bodyName: string;
  type: 'city' | 'outpost' | 'orbital_station' | 'colony';
  nation: string;
  population: number;
  economy: { gdp: number; techLevel: number; industrialCapacity: number; spaceportLevel: number };
  production: Record<string, number>;
  consumption: Record<string, number>;
  defenses: { militaryStrength: number; orbitalDefenses: number; shieldLevel: number };
  position: { lat: number; lon: number };
  status: 'thriving' | 'stable' | 'struggling' | 'damaged' | 'destroyed';
  market?: {
    buy: Record<string, number>;
    sell: Record<string, number>;
    resources: string[];
  };
}

const settlements: SettlementSeed[] = [
  // ── Earth Cities ──────────────────────────────────────────
  {
    name: 'Shanghai', bodyName: 'Earth', type: 'city', nation: 'China',
    population: 28_000_000,
    economy: { gdp: 8000, techLevel: 7, industrialCapacity: 900, spaceportLevel: 2 },
    production: { electronics: 200, alloys: 150 },
    consumption: { metals: 300, rareEarths: 50, energy: 500 },
    defenses: { militaryStrength: 8, orbitalDefenses: 2, shieldLevel: 0 },
    position: { lat: 31.2, lon: 121.5 }, status: 'thriving',
    market: {
      buy: { metals: 10, rareEarths: 80, ice: 5, helium3: 200, uranium: 500 },
      sell: { electronics: 50, alloys: 25, computers: 120, engines: 200 },
      resources: ['metals', 'rareEarths', 'ice', 'helium3', 'uranium', 'electronics', 'alloys', 'computers', 'engines'],
    },
  },
  {
    name: 'Houston', bodyName: 'Earth', type: 'city', nation: 'United States',
    population: 7_000_000,
    economy: { gdp: 5000, techLevel: 8, industrialCapacity: 600, spaceportLevel: 4 },
    production: { fuel: 100, engines: 50 },
    consumption: { metals: 200, hydrogen: 100, energy: 300 },
    defenses: { militaryStrength: 9, orbitalDefenses: 3, shieldLevel: 0 },
    position: { lat: 29.8, lon: -95.4 }, status: 'thriving',
    market: {
      buy: { metals: 12, hydrogen: 8, helium3: 180, rareEarths: 75 },
      sell: { fuel: 15, engines: 250, sensors: 180, solarPanels: 80 },
      resources: ['metals', 'hydrogen', 'helium3', 'rareEarths', 'fuel', 'engines', 'sensors', 'solarPanels'],
    },
  },
  {
    name: 'Tokyo', bodyName: 'Earth', type: 'city', nation: 'Japan',
    population: 14_000_000,
    economy: { gdp: 7000, techLevel: 9, industrialCapacity: 700, spaceportLevel: 2 },
    production: { sensors: 80, computers: 100, electronics: 180 },
    consumption: { metals: 150, rareEarths: 80, silicates: 50, energy: 400 },
    defenses: { militaryStrength: 6, orbitalDefenses: 2, shieldLevel: 0 },
    position: { lat: 35.7, lon: 139.7 }, status: 'thriving',
    market: {
      buy: { metals: 11, rareEarths: 90, silicates: 15, ice: 6 },
      sell: { sensors: 200, computers: 150, electronics: 60 },
      resources: ['metals', 'rareEarths', 'silicates', 'ice', 'sensors', 'computers', 'electronics'],
    },
  },
  {
    name: 'Bangalore', bodyName: 'Earth', type: 'city', nation: 'India',
    population: 13_000_000,
    economy: { gdp: 3000, techLevel: 7, industrialCapacity: 400, spaceportLevel: 3 },
    production: { computers: 80, electronics: 120 },
    consumption: { metals: 100, rareEarths: 40, energy: 250 },
    defenses: { militaryStrength: 5, orbitalDefenses: 1, shieldLevel: 0 },
    position: { lat: 12.97, lon: 77.59 }, status: 'thriving',
    market: {
      buy: { metals: 9, rareEarths: 70, helium3: 150 },
      sell: { computers: 130, electronics: 45 },
      resources: ['metals', 'rareEarths', 'helium3', 'computers', 'electronics'],
    },
  },
  {
    name: 'Munich', bodyName: 'Earth', type: 'city', nation: 'Germany',
    population: 3_000_000,
    economy: { gdp: 4000, techLevel: 8, industrialCapacity: 500, spaceportLevel: 1 },
    production: { engines: 60, alloys: 80 },
    consumption: { metals: 120, carbon: 50, energy: 200 },
    defenses: { militaryStrength: 6, orbitalDefenses: 1, shieldLevel: 0 },
    position: { lat: 48.1, lon: 11.6 }, status: 'stable',
    market: {
      buy: { metals: 11, carbon: 20, rareEarths: 85 },
      sell: { engines: 220, alloys: 30, hullPlating: 45 },
      resources: ['metals', 'carbon', 'rareEarths', 'engines', 'alloys', 'hullPlating'],
    },
  },
  {
    name: 'São Paulo', bodyName: 'Earth', type: 'city', nation: 'Brazil',
    population: 22_000_000,
    economy: { gdp: 3500, techLevel: 6, industrialCapacity: 350, spaceportLevel: 1 },
    production: { organics: 200, fuel: 80 },
    consumption: { metals: 80, electronics: 60, energy: 300 },
    defenses: { militaryStrength: 4, orbitalDefenses: 0, shieldLevel: 0 },
    position: { lat: -23.5, lon: -46.6 }, status: 'stable',
    market: {
      buy: { metals: 8, electronics: 55, computers: 140 },
      sell: { organics: 12, fuel: 14, carbon: 18 },
      resources: ['metals', 'electronics', 'computers', 'organics', 'fuel', 'carbon'],
    },
  },
  // ── Orbital Stations ──────────────────────────────────────
  {
    name: 'ISS-2 Gateway', bodyName: 'Earth', type: 'orbital_station', nation: 'International',
    population: 500,
    economy: { gdp: 200, techLevel: 9, industrialCapacity: 50, spaceportLevel: 5 },
    production: {},
    consumption: { fuel: 20, ice: 10, energy: 50 },
    defenses: { militaryStrength: 1, orbitalDefenses: 0, shieldLevel: 0 },
    position: { lat: 0, lon: 0 }, status: 'stable',
    market: {
      buy: { fuel: 20, ice: 12, metals: 15, alloys: 35 },
      sell: {},
      resources: ['fuel', 'ice', 'metals', 'alloys'],
    },
  },
  {
    name: 'Tiangong-3', bodyName: 'Earth', type: 'orbital_station', nation: 'China',
    population: 200,
    economy: { gdp: 150, techLevel: 8, industrialCapacity: 30, spaceportLevel: 4 },
    production: {},
    consumption: { fuel: 10, ice: 5, energy: 30 },
    defenses: { militaryStrength: 2, orbitalDefenses: 1, shieldLevel: 0 },
    position: { lat: 0, lon: 0 }, status: 'stable',
    market: {
      buy: { fuel: 18, ice: 10, helium3: 200 },
      sell: { electronics: 55 },
      resources: ['fuel', 'ice', 'helium3', 'electronics'],
    },
  },
  // ── Luna Outposts ──────────────────────────────────────
  {
    name: 'Artemis Base', bodyName: 'Luna', type: 'outpost', nation: 'United States',
    population: 2000,
    economy: { gdp: 500, techLevel: 8, industrialCapacity: 100, spaceportLevel: 3 },
    production: { helium3: 10, ice: 20 },
    consumption: { metals: 30, electronics: 20, fuel: 15, energy: 80 },
    defenses: { militaryStrength: 3, orbitalDefenses: 0, shieldLevel: 0 },
    position: { lat: -89.5, lon: 0 }, status: 'stable',
    market: {
      buy: { metals: 14, electronics: 60, fuel: 22, alloys: 40 },
      sell: { helium3: 160, ice: 8 },
      resources: ['metals', 'electronics', 'fuel', 'alloys', 'helium3', 'ice'],
    },
  },
  {
    name: 'Yuegong Station', bodyName: 'Luna', type: 'outpost', nation: 'China',
    population: 800,
    economy: { gdp: 300, techLevel: 7, industrialCapacity: 60, spaceportLevel: 2 },
    production: { silicates: 15, metals: 10 },
    consumption: { fuel: 10, electronics: 10, ice: 8, energy: 40 },
    defenses: { militaryStrength: 2, orbitalDefenses: 0, shieldLevel: 0 },
    position: { lat: 20, lon: 30 }, status: 'stable',
    market: {
      buy: { fuel: 20, electronics: 58, ice: 10 },
      sell: { silicates: 18, metals: 13 },
      resources: ['fuel', 'electronics', 'ice', 'silicates', 'metals'],
    },
  },
  // ── Mars Outpost ──────────────────────────────────────
  {
    name: 'Ares Colony', bodyName: 'Mars', type: 'colony', nation: 'International',
    population: 500,
    economy: { gdp: 200, techLevel: 7, industrialCapacity: 40, spaceportLevel: 2 },
    production: { ice: 5, metals: 5 },
    consumption: { fuel: 20, electronics: 15, alloys: 10, energy: 60 },
    defenses: { militaryStrength: 1, orbitalDefenses: 0, shieldLevel: 0 },
    position: { lat: 18.4, lon: -226 }, status: 'struggling',
    market: {
      buy: { fuel: 25, electronics: 65, alloys: 45, engines: 280, lifeSupportUnits: 300 },
      sell: { ice: 7, metals: 11 },
      resources: ['fuel', 'electronics', 'alloys', 'engines', 'lifeSupportUnits', 'ice', 'metals'],
    },
  },
];

export async function seedSettlements(): Promise<void> {
  await Settlement.deleteMany({});
  await Market.deleteMany({});

  const bodyCache = new Map<string, typeof CelestialBody.prototype>();

  for (const seed of settlements) {
    let body = bodyCache.get(seed.bodyName);
    if (!body) {
      body = await CelestialBody.findOne({ name: seed.bodyName });
      if (body) bodyCache.set(seed.bodyName, body);
    }
    if (!body) {
      console.warn(`Body not found for settlement: ${seed.name} (${seed.bodyName})`);
      continue;
    }

    const settlement = await Settlement.create({
      name: seed.name,
      bodyId: body._id,
      type: seed.type,
      nation: seed.nation,
      population: seed.population,
      economy: seed.economy,
      production: seed.production,
      consumption: seed.consumption,
      attitude: { general: 0.5, byReplicant: {} },
      defenses: seed.defenses,
      status: seed.status,
      position: seed.position,
    });

    // Create market if seed has one
    if (seed.market) {
      await Market.create({
        settlementId: settlement._id,
        bodyId: body._id,
        name: `${seed.name} Exchange`,
        prices: { buy: seed.market.buy, sell: seed.market.sell },
        supply: seed.production,
        demand: seed.consumption,
        availableResources: seed.market.resources,
      });
    }
  }

  console.log(`Seeded ${settlements.length} settlements with markets.`);
}
