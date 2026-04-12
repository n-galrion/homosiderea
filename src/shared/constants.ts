// Astronomical constants
export const AU_IN_KM = 149_597_870.7;
export const SPEED_OF_LIGHT_KM_S = 299_792.458;
export const SPEED_OF_LIGHT_AU_S = SPEED_OF_LIGHT_KM_S / AU_IN_KM; // ~0.002004 AU/s

// Light speed in AU per game hour (used for message delay calculations)
// SPEED_OF_LIGHT_AU_S * 3600 ≈ 7.214 AU/game-hour
// With dilation 600x and 5s ticks: each tick ≈ 0.833 game hours,
// so LIGHT_SPEED_AU_PER_TICK ≈ 7.214 * 0.833 ≈ 6.01 AU/tick
export const LIGHT_SPEED_AU_PER_GAME_HOUR = SPEED_OF_LIGHT_AU_S * 3600;
export const LIGHT_SPEED_AU_PER_TICK = SPEED_OF_LIGHT_AU_S * 3600;

// Resource types
export const RAW_RESOURCES = [
  'metals', 'ice', 'silicates', 'rareEarths', 'helium3',
  'organics', 'hydrogen', 'uranium', 'carbon',
] as const;

export const PROCESSED_RESOURCES = [
  'alloys', 'fuel', 'electronics', 'hullPlating',
] as const;

export const COMPONENT_RESOURCES = [
  'engines', 'sensors', 'computers', 'weaponSystems',
  'lifeSupportUnits', 'solarPanels', 'fusionCores',
] as const;

export const ALL_RESOURCES = [
  ...RAW_RESOURCES, ...PROCESSED_RESOURCES, ...COMPONENT_RESOURCES, 'energy',
] as const;

// Entity types
export const SHIP_TYPES = [
  'probe', 'shuttle', 'freighter', 'miner', 'warship', 'station_module',
] as const;

export const STRUCTURE_TYPES = [
  'habitat', 'mine', 'refinery', 'factory', 'solar_array',
  'fusion_plant', 'shipyard', 'sensor_station', 'relay_station', 'cargo_depot',
] as const;

export const AMI_TYPES = [
  'miner', 'explorer', 'factory', 'combat', 'transport', 'custom',
] as const;

export const CELESTIAL_BODY_TYPES = [
  'star', 'planet', 'dwarf_planet', 'moon', 'asteroid', 'comet', 'belt_zone',
] as const;

export const ACTION_TYPES = [
  'scan', 'move', 'mine', 'build_structure', 'build_ship', 'manufacture',
  'refine', 'launch_ami', 'replicate', 'send_message',
  'transfer_resources', 'dock', 'undock', 'attack', 'found_colony',
] as const;

export const ASTEROID_COMPOSITIONS = [
  'metallic', 'carbonaceous', 'siliceous', 'icy',
] as const;

export const TERRAIN_TYPES = [
  'plains', 'crater', 'mountain', 'polar', 'volcanic', 'oceanic', 'underground',
] as const;

export const COLONY_STATUSES = [
  'founding', 'active', 'abandoned',
] as const;

// Default specs for new replicants
export const DEFAULT_REPLICANT_COMPUTE = 1000;
export const DEFAULT_REPLICANT_ENERGY = 100;

// Replication costs
export const REPLICATE_COMPUTE_COST = 500;
export const REPLICATE_ENERGY_COST = 200;
export const REPLICATE_STARTING_COMPUTE = 500;
