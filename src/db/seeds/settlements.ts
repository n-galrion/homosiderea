import { CelestialBody, Settlement, Market, Faction, ResourceStore } from '../models/index.js';

interface SettlementSeed {
  name: string;
  bodyName: string;
  type: 'city' | 'outpost' | 'orbital_station' | 'colony';
  nation: string;
  population: number;
  leadership: { leaderName: string; leaderTitle: string; governmentType: string };
  culture: { temperament: string; description: string; priorities: string[] };
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
    leadership: { leaderName: 'Chen Wei-Lin', leaderTitle: 'Mayor', governmentType: 'technocracy' },
    culture: {
      temperament: 'mercantile',
      description: "The beating commercial heart of Earth-space trade. They'll sell you anything if the price is right.",
      priorities: ['trade', 'expansion'],
    },
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
    leadership: { leaderName: 'James McAllister', leaderTitle: 'Director', governmentType: 'corporate' },
    culture: {
      temperament: 'scientific',
      description: 'The old guard of space exploration. Meticulous, by-the-book, and deeply suspicious of autonomous AI.',
      priorities: ['research', 'defense'],
    },
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
    leadership: { leaderName: 'Tanaka Yuki', leaderTitle: 'Prime Minister', governmentType: 'democracy' },
    culture: {
      temperament: 'scientific',
      description: 'A city that treats technology as art. Their sensors and computers are the finest in the system, and they know it.',
      priorities: ['research', 'trade'],
    },
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
    leadership: { leaderName: 'Priya Sundaram', leaderTitle: 'Chancellor', governmentType: 'technocracy' },
    culture: {
      temperament: 'welcoming',
      description: 'Where half the software in the solar system was written. They understand digital minds better than most.',
      priorities: ['research', 'trade'],
    },
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
    leadership: { leaderName: 'Klaus Hoffmann', leaderTitle: 'Director-General', governmentType: 'corporate' },
    culture: {
      temperament: 'cautious',
      description: 'Precision engineering is religion here. Their engines are overbuilt, overpriced, and never break.',
      priorities: ['trade', 'defense'],
    },
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
    leadership: { leaderName: 'Ana Luísa Ferreira', leaderTitle: 'Governor', governmentType: 'democracy' },
    culture: {
      temperament: 'mercantile',
      description: 'The breadbasket of the space economy. Organics, biofuels, and carbon — São Paulo feeds the stations.',
      priorities: ['trade', 'expansion'],
    },
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
    leadership: { leaderName: 'Sarah Chen', leaderTitle: 'Commander', governmentType: 'military' },
    culture: {
      temperament: 'cautious',
      description: 'The diplomatic neutral ground of near-Earth space. Everyone is welcome, no one is trusted.',
      priorities: ['defense', 'research'],
    },
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
    leadership: { leaderName: 'Liu Hao', leaderTitle: 'Director', governmentType: 'military' },
    culture: {
      temperament: 'isolationist',
      description: "China's eye in the sky. They watch everything, share nothing, and their docking fees are non-negotiable.",
      priorities: ['defense', 'research'],
    },
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
    leadership: { leaderName: 'Rachel Torres', leaderTitle: 'Commander', governmentType: 'military' },
    culture: {
      temperament: 'scientific',
      description: "America's foothold on the Moon. Half research lab, half forward operating base. The Marines here have never fired a shot, and they'd like to keep it that way.",
      priorities: ['research', 'defense'],
    },
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
    leadership: { leaderName: 'Zhao Mingyu', leaderTitle: 'Director', governmentType: 'corporate' },
    culture: {
      temperament: 'mercantile',
      description: "China's lunar mining operation. Efficient, profitable, and expanding faster than anyone expected.",
      priorities: ['trade', 'expansion'],
    },
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
    leadership: { leaderName: 'Dr. Yuki Hamasaki', leaderTitle: 'Governor', governmentType: 'collective' },
    culture: {
      temperament: 'welcoming',
      description: "The most remote human settlement in the system. Everyone pulls their weight, or everyone dies. They don't care what you are — they care what you can do.",
      priorities: ['expansion', 'trade'],
    },
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
  await ResourceStore.deleteMany({ 'ownerRef.kind': 'Settlement' });

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
      leadership: seed.leadership,
      culture: seed.culture,
      economy: seed.economy,
      production: seed.production,
      consumption: seed.consumption,
      attitude: { general: 0.5, byReplicant: {} },
      defenses: seed.defenses,
      status: seed.status,
      position: seed.position,
    });

    // Initialize settlement stockpile with production/consumption buffers
    const stockpileInit: Record<string, number> = {};
    for (const [resource, rate] of Object.entries(seed.production)) {
      stockpileInit[resource] = (stockpileInit[resource] || 0) + rate * 100;
    }
    for (const [resource, rate] of Object.entries(seed.consumption)) {
      stockpileInit[resource] = (stockpileInit[resource] || 0) + rate * 50;
    }
    await ResourceStore.create({
      ownerRef: { kind: 'Settlement', item: settlement._id },
      ...stockpileInit,
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

interface FactionSeed {
  name: string;
  type: 'governmental' | 'corporate' | 'military' | 'scientific' | 'independent';
  description: string;
  memberNames: string[];     // settlement names — resolved to ObjectIds at seed time
  policies: {
    tradeOpenness: number;
    militaryAggression: number;
    techSharing: number;
    replicantTolerance: number;
  };
}

const factions: FactionSeed[] = [
  {
    name: 'United Nations Space Authority',
    type: 'governmental',
    description: 'The multilateral body governing international space operations. Bureaucratic, slow, but the only authority everyone nominally respects.',
    memberNames: ['ISS-2 Gateway', 'Artemis Base'],
    policies: { tradeOpenness: 0.7, militaryAggression: 0.1, techSharing: 0.8, replicantTolerance: 0.5 },
  },
  {
    name: 'Pacific Commerce Alliance',
    type: 'corporate',
    description: 'The economic powerhouse of the space age. Three cities, a third of Earth-space trade, and an insatiable appetite for raw materials.',
    memberNames: ['Shanghai', 'Tokyo', 'Bangalore'],
    policies: { tradeOpenness: 0.9, militaryAggression: 0.1, techSharing: 0.6, replicantTolerance: 0.6 },
  },
  {
    name: 'European Space Consortium',
    type: 'corporate',
    description: 'The ESA successor state in all but name. Slow to move, hard to stop. Their engineering standards are the benchmark for the solar system.',
    memberNames: ['Munich'],
    policies: { tradeOpenness: 0.6, militaryAggression: 0.1, techSharing: 0.5, replicantTolerance: 0.4 },
  },
  {
    name: "People's Republic Space Command",
    type: 'military',
    description: "China's integrated space military-industrial complex. Controls the most extensive sensor network in near-Earth space and the Moon's fastest-growing mining operation.",
    memberNames: ['Tiangong-3', 'Yuegong Station'],
    policies: { tradeOpenness: 0.3, militaryAggression: 0.5, techSharing: 0.2, replicantTolerance: 0.3 },
  },
  {
    name: 'Southern Hemisphere Trade Group',
    type: 'corporate',
    description: 'The breadbasket bloc. They feed the stations and fuel the ships — and they never let anyone forget it.',
    memberNames: ['São Paulo'],
    policies: { tradeOpenness: 0.8, militaryAggression: 0.1, techSharing: 0.4, replicantTolerance: 0.5 },
  },
  {
    name: 'Mars Independence Movement',
    type: 'independent',
    description: 'Less a government than a shared conviction: Mars must chart its own course. Born from necessity, sustained by stubbornness.',
    memberNames: ['Ares Colony'],
    policies: { tradeOpenness: 0.7, militaryAggression: 0.2, techSharing: 0.7, replicantTolerance: 0.8 },
  },
];

export async function seedFactions(): Promise<void> {
  await Faction.deleteMany({});

  for (const seed of factions) {
    // Resolve settlement names to ObjectIds
    const memberSettlements = await Settlement.find({ name: { $in: seed.memberNames } }).lean();
    const memberIds = memberSettlements.map(s => s._id);

    const faction = await Faction.create({
      name: seed.name,
      type: seed.type,
      description: seed.description,
      members: memberIds,
      attitude: { general: 0.5, byReplicant: {} },
      resources: {},
      policies: seed.policies,
    });

    // Back-link settlements to their faction
    await Settlement.updateMany(
      { _id: { $in: memberIds } },
      { $set: { factionId: faction._id } },
    );
  }

  console.log(`Seeded ${factions.length} factions.`);
}
