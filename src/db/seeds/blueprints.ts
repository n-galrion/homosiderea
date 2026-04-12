import { Blueprint } from '../models/index.js';

interface BlueprintSeed {
  name: string;
  category: 'refining' | 'component' | 'ship' | 'structure';
  description: string;
  inputs: Array<{ resource: string; amount: number }>;
  outputs: Array<{ resource: string; amount: number }>;
  ticksToBuild: number;
  energyCost: number;
  requiredStructureType: string | null;
  techLevel: number;
}

const blueprints: BlueprintSeed[] = [
  // ── Refining (requires 'refinery') ────────────────────────────────
  {
    name: 'Smelt Metals',
    category: 'refining',
    description: 'Smelt raw metals ore into standardized alloy ingots.',
    inputs: [{ resource: 'metals', amount: 10 }],
    outputs: [{ resource: 'alloys', amount: 5 }],
    ticksToBuild: 2,
    energyCost: 15,
    requiredStructureType: 'refinery',
    techLevel: 1,
  },
  {
    name: 'Crack Ice',
    category: 'refining',
    description: 'Crack water ice into usable fuel and hydrogen gas.',
    inputs: [{ resource: 'ice', amount: 10 }],
    outputs: [
      { resource: 'fuel', amount: 6 },
      { resource: 'hydrogen', amount: 4 },
    ],
    ticksToBuild: 2,
    energyCost: 10,
    requiredStructureType: 'refinery',
    techLevel: 1,
  },
  {
    name: 'Process Silicates',
    category: 'refining',
    description: 'Process raw silicates and rare earths into electronics-grade substrates.',
    inputs: [
      { resource: 'silicates', amount: 8 },
      { resource: 'rareEarths', amount: 2 },
    ],
    outputs: [{ resource: 'electronics', amount: 4 }],
    ticksToBuild: 3,
    energyCost: 20,
    requiredStructureType: 'refinery',
    techLevel: 1,
  },
  {
    name: 'Refine Carbon',
    category: 'refining',
    description: 'Combine carbon composites with alloys to produce reinforced hull plating.',
    inputs: [
      { resource: 'carbon', amount: 8 },
      { resource: 'alloys', amount: 4 },
    ],
    outputs: [{ resource: 'hullPlating', amount: 5 }],
    ticksToBuild: 3,
    energyCost: 18,
    requiredStructureType: 'refinery',
    techLevel: 1,
  },

  // ── Components (requires 'factory') ───────────────────────────────
  {
    name: 'Build Engine',
    category: 'component',
    description: 'Manufacture a propulsion engine from alloys and electronics.',
    inputs: [
      { resource: 'alloys', amount: 10 },
      { resource: 'electronics', amount: 5 },
    ],
    outputs: [{ resource: 'engines', amount: 2 }],
    ticksToBuild: 4,
    energyCost: 30,
    requiredStructureType: 'factory',
    techLevel: 1,
  },
  {
    name: 'Build Sensors',
    category: 'component',
    description: 'Assemble long-range sensor arrays using electronics and rare earths.',
    inputs: [
      { resource: 'electronics', amount: 8 },
      { resource: 'rareEarths', amount: 3 },
    ],
    outputs: [{ resource: 'sensors', amount: 2 }],
    ticksToBuild: 4,
    energyCost: 25,
    requiredStructureType: 'factory',
    techLevel: 1,
  },
  {
    name: 'Build Computer',
    category: 'component',
    description: 'Fabricate flight computers from high-grade electronics and rare earths.',
    inputs: [
      { resource: 'electronics', amount: 10 },
      { resource: 'rareEarths', amount: 4 },
    ],
    outputs: [{ resource: 'computers', amount: 2 }],
    ticksToBuild: 5,
    energyCost: 35,
    requiredStructureType: 'factory',
    techLevel: 2,
  },
  {
    name: 'Build Solar Panel',
    category: 'component',
    description: 'Construct photovoltaic solar panels from silicates and electronics.',
    inputs: [
      { resource: 'silicates', amount: 8 },
      { resource: 'electronics', amount: 4 },
    ],
    outputs: [{ resource: 'solarPanels', amount: 2 }],
    ticksToBuild: 3,
    energyCost: 20,
    requiredStructureType: 'factory',
    techLevel: 1,
  },
  {
    name: 'Build Fusion Core',
    category: 'component',
    description: 'Construct a compact fusion reactor core from alloys, helium-3, and electronics.',
    inputs: [
      { resource: 'alloys', amount: 15 },
      { resource: 'helium3', amount: 10 },
      { resource: 'electronics', amount: 8 },
    ],
    outputs: [{ resource: 'fusionCores', amount: 1 }],
    ticksToBuild: 8,
    energyCost: 60,
    requiredStructureType: 'factory',
    techLevel: 3,
  },
  {
    name: 'Build Life Support',
    category: 'component',
    description: 'Build a closed-loop life support module from alloys, electronics, and water ice.',
    inputs: [
      { resource: 'alloys', amount: 8 },
      { resource: 'electronics', amount: 5 },
      { resource: 'ice', amount: 6 },
    ],
    outputs: [{ resource: 'lifeSupportUnits', amount: 2 }],
    ticksToBuild: 5,
    energyCost: 30,
    requiredStructureType: 'factory',
    techLevel: 2,
  },
  {
    name: 'Build Weapon System',
    category: 'component',
    description: 'Manufacture integrated weapon systems from alloys, electronics, and rare earths.',
    inputs: [
      { resource: 'alloys', amount: 12 },
      { resource: 'electronics', amount: 6 },
      { resource: 'rareEarths', amount: 5 },
    ],
    outputs: [{ resource: 'weaponSystems', amount: 1 }],
    ticksToBuild: 6,
    energyCost: 45,
    requiredStructureType: 'factory',
    techLevel: 2,
  },

  // ── Ships (requires 'shipyard') ───────────────────────────────────
  {
    name: 'Build Probe',
    category: 'ship',
    description: 'Construct an unmanned exploration probe for long-range reconnaissance.',
    inputs: [
      { resource: 'alloys', amount: 5 },
      { resource: 'sensors', amount: 2 },
      { resource: 'computers', amount: 1 },
      { resource: 'engines', amount: 1 },
    ],
    outputs: [{ resource: 'probe', amount: 1 }],
    ticksToBuild: 4,
    energyCost: 30,
    requiredStructureType: 'shipyard',
    techLevel: 1,
  },
  {
    name: 'Build Shuttle',
    category: 'ship',
    description: 'Build a small personnel shuttle for inter-body transport.',
    inputs: [
      { resource: 'alloys', amount: 10 },
      { resource: 'engines', amount: 2 },
      { resource: 'computers', amount: 1 },
      { resource: 'lifeSupportUnits', amount: 2 },
    ],
    outputs: [{ resource: 'shuttle', amount: 1 }],
    ticksToBuild: 6,
    energyCost: 40,
    requiredStructureType: 'shipyard',
    techLevel: 1,
  },
  {
    name: 'Build Freighter',
    category: 'ship',
    description: 'Construct a bulk freighter for hauling resources between outposts.',
    inputs: [
      { resource: 'alloys', amount: 25 },
      { resource: 'hullPlating', amount: 15 },
      { resource: 'engines', amount: 3 },
      { resource: 'computers', amount: 2 },
    ],
    outputs: [{ resource: 'freighter', amount: 1 }],
    ticksToBuild: 12,
    energyCost: 80,
    requiredStructureType: 'shipyard',
    techLevel: 2,
  },
  {
    name: 'Build Mining Ship',
    category: 'ship',
    description: 'Build a mining vessel equipped with drilling and extraction equipment.',
    inputs: [
      { resource: 'alloys', amount: 20 },
      { resource: 'engines', amount: 2 },
      { resource: 'computers', amount: 2 },
    ],
    outputs: [{ resource: 'miner', amount: 1 }],
    ticksToBuild: 10,
    energyCost: 60,
    requiredStructureType: 'shipyard',
    techLevel: 2,
  },
  {
    name: 'Build Warship',
    category: 'ship',
    description: 'Construct an armed warship for system defense and combat operations.',
    inputs: [
      { resource: 'alloys', amount: 35 },
      { resource: 'hullPlating', amount: 25 },
      { resource: 'engines', amount: 4 },
      { resource: 'weaponSystems', amount: 3 },
      { resource: 'computers', amount: 3 },
    ],
    outputs: [{ resource: 'warship', amount: 1 }],
    ticksToBuild: 20,
    energyCost: 120,
    requiredStructureType: 'shipyard',
    techLevel: 3,
  },

  // ── Structures ────────────────────────────────────────────────────
  {
    name: 'Build Habitat',
    category: 'structure',
    description: 'Construct a pressurized habitat module for crew quarters and operations.',
    inputs: [
      { resource: 'alloys', amount: 20 },
      { resource: 'hullPlating', amount: 10 },
      { resource: 'lifeSupportUnits', amount: 4 },
      { resource: 'electronics', amount: 5 },
    ],
    outputs: [{ resource: 'habitat', amount: 1 }],
    ticksToBuild: 10,
    energyCost: 50,
    requiredStructureType: null,
    techLevel: 1,
  },
  {
    name: 'Build Mine',
    category: 'structure',
    description: 'Deploy an automated mining installation for resource extraction.',
    inputs: [
      { resource: 'alloys', amount: 15 },
      { resource: 'electronics', amount: 5 },
      { resource: 'engines', amount: 1 },
    ],
    outputs: [{ resource: 'mine', amount: 1 }],
    ticksToBuild: 6,
    energyCost: 35,
    requiredStructureType: null,
    techLevel: 1,
  },
  {
    name: 'Build Refinery',
    category: 'structure',
    description: 'Construct a refinery for processing raw materials into usable commodities.',
    inputs: [
      { resource: 'alloys', amount: 20 },
      { resource: 'electronics', amount: 8 },
      { resource: 'hullPlating', amount: 5 },
    ],
    outputs: [{ resource: 'refinery', amount: 1 }],
    ticksToBuild: 8,
    energyCost: 45,
    requiredStructureType: null,
    techLevel: 1,
  },
  {
    name: 'Build Factory',
    category: 'structure',
    description: 'Construct a manufacturing factory for producing components and equipment.',
    inputs: [
      { resource: 'alloys', amount: 25 },
      { resource: 'electronics', amount: 10 },
      { resource: 'computers', amount: 2 },
    ],
    outputs: [{ resource: 'factory', amount: 1 }],
    ticksToBuild: 10,
    energyCost: 55,
    requiredStructureType: null,
    techLevel: 2,
  },
  {
    name: 'Build Solar Array',
    category: 'structure',
    description: 'Deploy a solar energy collection array for power generation.',
    inputs: [
      { resource: 'alloys', amount: 10 },
      { resource: 'solarPanels', amount: 6 },
      { resource: 'electronics', amount: 4 },
    ],
    outputs: [{ resource: 'solar_array', amount: 1 }],
    ticksToBuild: 4,
    energyCost: 20,
    requiredStructureType: null,
    techLevel: 1,
  },
  {
    name: 'Build Fusion Plant',
    category: 'structure',
    description: 'Construct a fusion power plant for high-output energy generation.',
    inputs: [
      { resource: 'alloys', amount: 30 },
      { resource: 'fusionCores', amount: 2 },
      { resource: 'electronics', amount: 10 },
      { resource: 'hullPlating', amount: 8 },
    ],
    outputs: [{ resource: 'fusion_plant', amount: 1 }],
    ticksToBuild: 15,
    energyCost: 80,
    requiredStructureType: null,
    techLevel: 3,
  },
  {
    name: 'Build Shipyard',
    category: 'structure',
    description: 'Build an orbital shipyard capable of constructing and repairing vessels.',
    inputs: [
      { resource: 'alloys', amount: 40 },
      { resource: 'hullPlating', amount: 15 },
      { resource: 'electronics', amount: 10 },
      { resource: 'computers', amount: 3 },
    ],
    outputs: [{ resource: 'shipyard', amount: 1 }],
    ticksToBuild: 18,
    energyCost: 100,
    requiredStructureType: null,
    techLevel: 2,
  },
  {
    name: 'Build Sensor Station',
    category: 'structure',
    description: 'Deploy a deep-space sensor station for system-wide surveillance.',
    inputs: [
      { resource: 'alloys', amount: 12 },
      { resource: 'sensors', amount: 4 },
      { resource: 'electronics', amount: 6 },
      { resource: 'computers', amount: 2 },
    ],
    outputs: [{ resource: 'sensor_station', amount: 1 }],
    ticksToBuild: 6,
    energyCost: 35,
    requiredStructureType: null,
    techLevel: 2,
  },
  {
    name: 'Build Relay Station',
    category: 'structure',
    description: 'Construct a communications relay for extending network coverage.',
    inputs: [
      { resource: 'alloys', amount: 8 },
      { resource: 'electronics', amount: 6 },
      { resource: 'computers', amount: 1 },
    ],
    outputs: [{ resource: 'relay_station', amount: 1 }],
    ticksToBuild: 4,
    energyCost: 25,
    requiredStructureType: null,
    techLevel: 1,
  },
];

export async function seedBlueprints(): Promise<void> {
  console.log('Seeding blueprints...');

  await Blueprint.deleteMany({});
  await Blueprint.insertMany(blueprints);

  console.log(`  Inserted ${blueprints.length} blueprints.`);
}
