import { CelestialBody } from '../models/index.js';

interface BodySeed {
  name: string;
  type: 'star' | 'planet' | 'dwarf_planet' | 'moon' | 'asteroid' | 'comet' | 'belt_zone';
  parentName: string | null;
  orbit: {
    semiMajorAxis: number;
    eccentricity: number;
    inclination: number;
    longitudeOfAscendingNode: number;
    argumentOfPeriapsis: number;
    meanAnomalyAtEpoch: number;
    orbitalPeriod: number;
  } | null;
  physical: {
    mass: number;
    radius: number;
    gravity: number;
    hasAtmosphere: boolean;
  };
  resources: Array<{
    resourceType: string;
    abundance: number;
    totalDeposit: number;
    remaining: number;
    accessible: boolean;
  }>;
  position: { x: number; y: number; z: number };
  solarEnergyFactor: number;
  beltConfig?: {
    maxAsteroids: number;
    generatedCount: number;
    density: number;
    compositionWeights: {
      metallic: number;
      carbonaceous: number;
      siliceous: number;
      icy: number;
    };
  } | null;
  surfaceConfig?: {
    maxLandingSites: number;
    generatedCount: number;
  } | null;
}

// 1 tick = 1 game hour
// Earth orbital period = 365.25 days * 24 hours = 8766 ticks
const EARTH_YEAR_TICKS = 8766;

const bodies: BodySeed[] = [
  // ── Star ────────────────────────────────────────────────────────────
  {
    name: 'Sol',
    type: 'star',
    parentName: null,
    orbit: null,
    physical: {
      mass: 1.989e30,
      radius: 696340,
      gravity: 274.0,
      hasAtmosphere: true,
    },
    resources: [
      { resourceType: 'hydrogen', abundance: 0.92, totalDeposit: 100_000_000, remaining: 100_000_000, accessible: false },
      { resourceType: 'helium3', abundance: 0.08, totalDeposit: 100_000_000, remaining: 100_000_000, accessible: false },
    ],
    position: { x: 0, y: 0, z: 0 },
    solarEnergyFactor: 1000.0,
  },

  // ── Inner Planets ──────────────────────────────────────────────────
  {
    name: 'Mercury',
    type: 'planet',
    parentName: 'Sol',
    orbit: {
      semiMajorAxis: 0.387,
      eccentricity: 0.2056,
      inclination: 7.0,
      longitudeOfAscendingNode: 48.33,
      argumentOfPeriapsis: 29.12,
      meanAnomalyAtEpoch: 174.8,
      orbitalPeriod: Math.round(0.2408 * EARTH_YEAR_TICKS), // ~88 days
    },
    physical: {
      mass: 3.301e23,
      radius: 2439.7,
      gravity: 3.7,
      hasAtmosphere: false,
    },
    resources: [
      { resourceType: 'metals', abundance: 0.85, totalDeposit: 800_000, remaining: 800_000, accessible: true },
      { resourceType: 'silicates', abundance: 0.6, totalDeposit: 600_000, remaining: 600_000, accessible: true },
      { resourceType: 'rareEarths', abundance: 0.15, totalDeposit: 500_000, remaining: 500_000, accessible: true },
      { resourceType: 'carbon', abundance: 0.05, totalDeposit: 500_000, remaining: 500_000, accessible: true },
    ],
    position: { x: 0.387, y: 0, z: 0 },
    solarEnergyFactor: 6.68, // ~1/r^2 from Sol
    surfaceConfig: { maxLandingSites: 4, generatedCount: 0 },
  },
  {
    name: 'Venus',
    type: 'planet',
    parentName: 'Sol',
    orbit: {
      semiMajorAxis: 0.723,
      eccentricity: 0.0068,
      inclination: 3.39,
      longitudeOfAscendingNode: 76.68,
      argumentOfPeriapsis: 54.85,
      meanAnomalyAtEpoch: 50.42,
      orbitalPeriod: Math.round(0.6152 * EARTH_YEAR_TICKS), // ~225 days
    },
    physical: {
      mass: 4.867e24,
      radius: 6051.8,
      gravity: 8.87,
      hasAtmosphere: true,
    },
    resources: [
      { resourceType: 'silicates', abundance: 0.7, totalDeposit: 1_500_000, remaining: 1_500_000, accessible: true },
      { resourceType: 'carbon', abundance: 0.55, totalDeposit: 1_200_000, remaining: 1_200_000, accessible: true },
      { resourceType: 'metals', abundance: 0.4, totalDeposit: 1_000_000, remaining: 1_000_000, accessible: true },
      { resourceType: 'uranium', abundance: 0.08, totalDeposit: 500_000, remaining: 500_000, accessible: true },
    ],
    position: { x: 0.723, y: 0, z: 0 },
    solarEnergyFactor: 1.91,
    surfaceConfig: { maxLandingSites: 4, generatedCount: 0 },
  },
  {
    name: 'Earth',
    type: 'planet',
    parentName: 'Sol',
    orbit: {
      semiMajorAxis: 1.0,
      eccentricity: 0.0167,
      inclination: 0.0,
      longitudeOfAscendingNode: 348.74,
      argumentOfPeriapsis: 114.21,
      meanAnomalyAtEpoch: 357.52,
      orbitalPeriod: EARTH_YEAR_TICKS,
    },
    physical: {
      mass: 5.972e24,
      radius: 6371.0,
      gravity: 9.81,
      hasAtmosphere: true,
    },
    resources: [
      { resourceType: 'metals', abundance: 0.5, totalDeposit: 2_000_000, remaining: 2_000_000, accessible: true },
      { resourceType: 'silicates', abundance: 0.65, totalDeposit: 2_000_000, remaining: 2_000_000, accessible: true },
      { resourceType: 'ice', abundance: 0.35, totalDeposit: 1_500_000, remaining: 1_500_000, accessible: true },
      { resourceType: 'organics', abundance: 0.45, totalDeposit: 1_800_000, remaining: 1_800_000, accessible: true },
      { resourceType: 'rareEarths', abundance: 0.12, totalDeposit: 800_000, remaining: 800_000, accessible: true },
      { resourceType: 'uranium', abundance: 0.05, totalDeposit: 500_000, remaining: 500_000, accessible: true },
      { resourceType: 'carbon', abundance: 0.3, totalDeposit: 1_200_000, remaining: 1_200_000, accessible: true },
    ],
    position: { x: 1.0, y: 0, z: 0 },
    solarEnergyFactor: 1.0,
    surfaceConfig: { maxLandingSites: 10, generatedCount: 0 },
  },
  {
    name: 'Mars',
    type: 'planet',
    parentName: 'Sol',
    orbit: {
      semiMajorAxis: 1.524,
      eccentricity: 0.0934,
      inclination: 1.85,
      longitudeOfAscendingNode: 49.56,
      argumentOfPeriapsis: 286.5,
      meanAnomalyAtEpoch: 19.37,
      orbitalPeriod: Math.round(1.8809 * EARTH_YEAR_TICKS), // ~687 days
    },
    physical: {
      mass: 6.417e23,
      radius: 3389.5,
      gravity: 3.72,
      hasAtmosphere: true,
    },
    resources: [
      { resourceType: 'metals', abundance: 0.55, totalDeposit: 1_200_000, remaining: 1_200_000, accessible: true },
      { resourceType: 'silicates', abundance: 0.7, totalDeposit: 1_500_000, remaining: 1_500_000, accessible: true },
      { resourceType: 'ice', abundance: 0.25, totalDeposit: 800_000, remaining: 800_000, accessible: true },
      { resourceType: 'carbon', abundance: 0.2, totalDeposit: 700_000, remaining: 700_000, accessible: true },
      { resourceType: 'rareEarths', abundance: 0.1, totalDeposit: 500_000, remaining: 500_000, accessible: true },
    ],
    position: { x: 1.524, y: 0, z: 0 },
    solarEnergyFactor: 0.431,
    surfaceConfig: { maxLandingSites: 8, generatedCount: 0 },
  },

  // ── Earth's Moon ───────────────────────────────────────────────────
  {
    name: 'Luna',
    type: 'moon',
    parentName: 'Earth',
    orbit: {
      semiMajorAxis: 0.00257, // ~384400 km in AU
      eccentricity: 0.0549,
      inclination: 5.145,
      longitudeOfAscendingNode: 125.08,
      argumentOfPeriapsis: 318.15,
      meanAnomalyAtEpoch: 135.27,
      orbitalPeriod: Math.round(27.322 * 24), // ~656 hours
    },
    physical: {
      mass: 7.342e22,
      radius: 1737.4,
      gravity: 1.62,
      hasAtmosphere: false,
    },
    resources: [
      { resourceType: 'silicates', abundance: 0.65, totalDeposit: 400_000, remaining: 400_000, accessible: true },
      { resourceType: 'metals', abundance: 0.45, totalDeposit: 300_000, remaining: 300_000, accessible: true },
      { resourceType: 'ice', abundance: 0.12, totalDeposit: 80_000, remaining: 80_000, accessible: true },
      { resourceType: 'helium3', abundance: 0.08, totalDeposit: 50_000, remaining: 50_000, accessible: true },
      { resourceType: 'rareEarths', abundance: 0.06, totalDeposit: 60_000, remaining: 60_000, accessible: true },
    ],
    position: { x: 1.00257, y: 0, z: 0 },
    solarEnergyFactor: 1.0,
    surfaceConfig: { maxLandingSites: 6, generatedCount: 0 },
  },

  // ── Mars Moons ─────────────────────────────────────────────────────
  {
    name: 'Phobos',
    type: 'moon',
    parentName: 'Mars',
    orbit: {
      semiMajorAxis: 0.0000628, // ~9376 km in AU
      eccentricity: 0.0151,
      inclination: 1.093,
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      orbitalPeriod: Math.round(0.3189 * 24), // ~7.65 hours
    },
    physical: {
      mass: 1.0659e16,
      radius: 11.267,
      gravity: 0.0057,
      hasAtmosphere: false,
    },
    resources: [
      { resourceType: 'carbon', abundance: 0.55, totalDeposit: 50_000, remaining: 50_000, accessible: true },
      { resourceType: 'silicates', abundance: 0.5, totalDeposit: 45_000, remaining: 45_000, accessible: true },
      { resourceType: 'metals', abundance: 0.3, totalDeposit: 30_000, remaining: 30_000, accessible: true },
      { resourceType: 'ice', abundance: 0.15, totalDeposit: 15_000, remaining: 15_000, accessible: true },
    ],
    position: { x: 1.524063, y: 0, z: 0 },
    solarEnergyFactor: 0.431,
    surfaceConfig: { maxLandingSites: 2, generatedCount: 0 },
  },
  {
    name: 'Deimos',
    type: 'moon',
    parentName: 'Mars',
    orbit: {
      semiMajorAxis: 0.000157, // ~23460 km in AU
      eccentricity: 0.00033,
      inclination: 0.93,
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      orbitalPeriod: Math.round(1.2624 * 24), // ~30.3 hours
    },
    physical: {
      mass: 1.4762e15,
      radius: 6.2,
      gravity: 0.003,
      hasAtmosphere: false,
    },
    resources: [
      { resourceType: 'carbon', abundance: 0.6, totalDeposit: 40_000, remaining: 40_000, accessible: true },
      { resourceType: 'silicates', abundance: 0.45, totalDeposit: 30_000, remaining: 30_000, accessible: true },
      { resourceType: 'metals', abundance: 0.25, totalDeposit: 20_000, remaining: 20_000, accessible: true },
    ],
    position: { x: 1.524157, y: 0, z: 0 },
    solarEnergyFactor: 0.431,
    surfaceConfig: { maxLandingSites: 2, generatedCount: 0 },
  },

  // ── Asteroid Belt ──────────────────────────────────────────────────
  {
    name: 'Ceres',
    type: 'dwarf_planet',
    parentName: 'Sol',
    orbit: {
      semiMajorAxis: 2.768,
      eccentricity: 0.0758,
      inclination: 10.59,
      longitudeOfAscendingNode: 80.33,
      argumentOfPeriapsis: 73.6,
      meanAnomalyAtEpoch: 77.37,
      orbitalPeriod: Math.round(4.6 * EARTH_YEAR_TICKS), // ~4.6 years
    },
    physical: {
      mass: 9.393e20,
      radius: 473.0,
      gravity: 0.28,
      hasAtmosphere: false,
    },
    resources: [
      { resourceType: 'ice', abundance: 0.55, totalDeposit: 150_000, remaining: 150_000, accessible: true },
      { resourceType: 'silicates', abundance: 0.5, totalDeposit: 120_000, remaining: 120_000, accessible: true },
      { resourceType: 'metals', abundance: 0.35, totalDeposit: 100_000, remaining: 100_000, accessible: true },
      { resourceType: 'carbon', abundance: 0.25, totalDeposit: 80_000, remaining: 80_000, accessible: true },
      { resourceType: 'rareEarths', abundance: 0.08, totalDeposit: 30_000, remaining: 30_000, accessible: true },
    ],
    position: { x: 2.768, y: 0, z: 0 },
    solarEnergyFactor: 0.131,
    surfaceConfig: { maxLandingSites: 4, generatedCount: 0 },
  },
  {
    name: 'Vesta',
    type: 'asteroid',
    parentName: 'Sol',
    orbit: {
      semiMajorAxis: 2.362,
      eccentricity: 0.0887,
      inclination: 7.14,
      longitudeOfAscendingNode: 103.85,
      argumentOfPeriapsis: 149.84,
      meanAnomalyAtEpoch: 20.86,
      orbitalPeriod: Math.round(3.63 * EARTH_YEAR_TICKS),
    },
    physical: {
      mass: 2.59e20,
      radius: 262.7,
      gravity: 0.25,
      hasAtmosphere: false,
    },
    resources: [
      { resourceType: 'metals', abundance: 0.8, totalDeposit: 200_000, remaining: 200_000, accessible: true },
      { resourceType: 'silicates', abundance: 0.55, totalDeposit: 120_000, remaining: 120_000, accessible: true },
      { resourceType: 'rareEarths', abundance: 0.2, totalDeposit: 50_000, remaining: 50_000, accessible: true },
    ],
    position: { x: 2.362, y: 0, z: 0 },
    solarEnergyFactor: 0.179,
  },
  {
    name: 'Inner Belt Zone',
    type: 'belt_zone',
    parentName: 'Sol',
    orbit: {
      semiMajorAxis: 2.2,
      eccentricity: 0.1,
      inclination: 5.0,
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      orbitalPeriod: Math.round(3.26 * EARTH_YEAR_TICKS),
    },
    physical: {
      mass: 0,
      radius: 0,
      gravity: 0,
      hasAtmosphere: false,
    },
    resources: [
      { resourceType: 'metals', abundance: 0.75, totalDeposit: 0, remaining: 0, accessible: true },
      { resourceType: 'silicates', abundance: 0.6, totalDeposit: 0, remaining: 0, accessible: true },
      { resourceType: 'rareEarths', abundance: 0.18, totalDeposit: 0, remaining: 0, accessible: true },
      { resourceType: 'carbon', abundance: 0.3, totalDeposit: 0, remaining: 0, accessible: true },
    ],
    position: { x: 2.2, y: 0, z: 0 },
    solarEnergyFactor: 0.207,
    beltConfig: {
      maxAsteroids: 200,
      generatedCount: 0,
      density: 3,
      compositionWeights: { metallic: 0.4, carbonaceous: 0.2, siliceous: 0.3, icy: 0.1 },
    },
  },
  {
    name: 'Outer Belt Zone',
    type: 'belt_zone',
    parentName: 'Sol',
    orbit: {
      semiMajorAxis: 3.2,
      eccentricity: 0.1,
      inclination: 8.0,
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 180,
      orbitalPeriod: Math.round(5.72 * EARTH_YEAR_TICKS),
    },
    physical: {
      mass: 0,
      radius: 0,
      gravity: 0,
      hasAtmosphere: false,
    },
    resources: [
      { resourceType: 'ice', abundance: 0.5, totalDeposit: 0, remaining: 0, accessible: true },
      { resourceType: 'carbon', abundance: 0.55, totalDeposit: 0, remaining: 0, accessible: true },
      { resourceType: 'silicates', abundance: 0.45, totalDeposit: 0, remaining: 0, accessible: true },
      { resourceType: 'metals', abundance: 0.4, totalDeposit: 0, remaining: 0, accessible: true },
      { resourceType: 'organics', abundance: 0.2, totalDeposit: 0, remaining: 0, accessible: true },
    ],
    position: { x: 3.2, y: 0, z: 0 },
    solarEnergyFactor: 0.098,
    beltConfig: {
      maxAsteroids: 200,
      generatedCount: 0,
      density: 3,
      compositionWeights: { metallic: 0.2, carbonaceous: 0.3, siliceous: 0.2, icy: 0.3 },
    },
  },

  // ── Outer Planets ──────────────────────────────────────────────────
  {
    name: 'Jupiter',
    type: 'planet',
    parentName: 'Sol',
    orbit: {
      semiMajorAxis: 5.203,
      eccentricity: 0.0489,
      inclination: 1.303,
      longitudeOfAscendingNode: 100.46,
      argumentOfPeriapsis: 273.87,
      meanAnomalyAtEpoch: 20.02,
      orbitalPeriod: Math.round(11.862 * EARTH_YEAR_TICKS),
    },
    physical: {
      mass: 1.898e27,
      radius: 69911,
      gravity: 24.79,
      hasAtmosphere: true,
    },
    resources: [
      { resourceType: 'hydrogen', abundance: 0.9, totalDeposit: 10_000_000, remaining: 10_000_000, accessible: false },
      { resourceType: 'helium3', abundance: 0.35, totalDeposit: 10_000_000, remaining: 10_000_000, accessible: true },
    ],
    position: { x: 5.203, y: 0, z: 0 },
    solarEnergyFactor: 0.037,
    surfaceConfig: { maxLandingSites: 3, generatedCount: 0 },
  },
  {
    name: 'Saturn',
    type: 'planet',
    parentName: 'Sol',
    orbit: {
      semiMajorAxis: 9.537,
      eccentricity: 0.0565,
      inclination: 2.485,
      longitudeOfAscendingNode: 113.66,
      argumentOfPeriapsis: 339.39,
      meanAnomalyAtEpoch: 317.02,
      orbitalPeriod: Math.round(29.457 * EARTH_YEAR_TICKS),
    },
    physical: {
      mass: 5.683e26,
      radius: 58232,
      gravity: 10.44,
      hasAtmosphere: true,
    },
    resources: [
      { resourceType: 'hydrogen', abundance: 0.88, totalDeposit: 10_000_000, remaining: 10_000_000, accessible: false },
      { resourceType: 'helium3', abundance: 0.3, totalDeposit: 10_000_000, remaining: 10_000_000, accessible: true },
    ],
    position: { x: 9.537, y: 0, z: 0 },
    solarEnergyFactor: 0.011,
    surfaceConfig: { maxLandingSites: 3, generatedCount: 0 },
  },
  {
    name: 'Uranus',
    type: 'planet',
    parentName: 'Sol',
    orbit: {
      semiMajorAxis: 19.191,
      eccentricity: 0.0472,
      inclination: 0.773,
      longitudeOfAscendingNode: 74.0,
      argumentOfPeriapsis: 96.99,
      meanAnomalyAtEpoch: 142.24,
      orbitalPeriod: Math.round(84.01 * EARTH_YEAR_TICKS),
    },
    physical: {
      mass: 8.681e25,
      radius: 25362,
      gravity: 8.87,
      hasAtmosphere: true,
    },
    resources: [
      { resourceType: 'hydrogen', abundance: 0.83, totalDeposit: 10_000_000, remaining: 10_000_000, accessible: false },
      { resourceType: 'helium3', abundance: 0.25, totalDeposit: 10_000_000, remaining: 10_000_000, accessible: true },
      { resourceType: 'ice', abundance: 0.4, totalDeposit: 10_000_000, remaining: 10_000_000, accessible: false },
    ],
    position: { x: 19.191, y: 0, z: 0 },
    solarEnergyFactor: 0.0027,
    surfaceConfig: { maxLandingSites: 2, generatedCount: 0 },
  },
  {
    name: 'Neptune',
    type: 'planet',
    parentName: 'Sol',
    orbit: {
      semiMajorAxis: 30.069,
      eccentricity: 0.0086,
      inclination: 1.77,
      longitudeOfAscendingNode: 131.78,
      argumentOfPeriapsis: 273.19,
      meanAnomalyAtEpoch: 256.23,
      orbitalPeriod: Math.round(164.8 * EARTH_YEAR_TICKS),
    },
    physical: {
      mass: 1.024e26,
      radius: 24622,
      gravity: 11.15,
      hasAtmosphere: true,
    },
    resources: [
      { resourceType: 'hydrogen', abundance: 0.8, totalDeposit: 10_000_000, remaining: 10_000_000, accessible: false },
      { resourceType: 'helium3', abundance: 0.22, totalDeposit: 10_000_000, remaining: 10_000_000, accessible: true },
      { resourceType: 'ice', abundance: 0.45, totalDeposit: 10_000_000, remaining: 10_000_000, accessible: false },
    ],
    position: { x: 30.069, y: 0, z: 0 },
    solarEnergyFactor: 0.0011,
    surfaceConfig: { maxLandingSites: 2, generatedCount: 0 },
  },

  // ── Jupiter Moons ─────────────────────────────────────────────────
  {
    name: 'Io',
    type: 'moon',
    parentName: 'Jupiter',
    orbit: {
      semiMajorAxis: 0.00282, // ~421,700 km
      eccentricity: 0.0041,
      inclination: 0.036,
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      orbitalPeriod: Math.round(1.769 * 24), // ~42 hours
    },
    physical: {
      mass: 8.932e22,
      radius: 1821.6,
      gravity: 1.796,
      hasAtmosphere: true,
    },
    resources: [
      { resourceType: 'silicates', abundance: 0.7, totalDeposit: 80_000, remaining: 80_000, accessible: true },
      { resourceType: 'metals', abundance: 0.45, totalDeposit: 60_000, remaining: 60_000, accessible: true },
      { resourceType: 'uranium', abundance: 0.12, totalDeposit: 20_000, remaining: 20_000, accessible: true },
    ],
    position: { x: 5.206, y: 0, z: 0 },
    solarEnergyFactor: 0.037,
    surfaceConfig: { maxLandingSites: 4, generatedCount: 0 },
  },
  {
    name: 'Europa',
    type: 'moon',
    parentName: 'Jupiter',
    orbit: {
      semiMajorAxis: 0.00449, // ~671,100 km
      eccentricity: 0.009,
      inclination: 0.466,
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      orbitalPeriod: Math.round(3.551 * 24), // ~85 hours
    },
    physical: {
      mass: 4.8e22,
      radius: 1560.8,
      gravity: 1.314,
      hasAtmosphere: false,
    },
    resources: [
      { resourceType: 'ice', abundance: 0.9, totalDeposit: 500_000, remaining: 500_000, accessible: true },
      { resourceType: 'silicates', abundance: 0.35, totalDeposit: 150_000, remaining: 150_000, accessible: true },
      { resourceType: 'organics', abundance: 0.2, totalDeposit: 100_000, remaining: 100_000, accessible: true },
      { resourceType: 'metals', abundance: 0.15, totalDeposit: 80_000, remaining: 80_000, accessible: true },
    ],
    position: { x: 5.207, y: 0, z: 0 },
    solarEnergyFactor: 0.037,
    surfaceConfig: { maxLandingSites: 5, generatedCount: 0 },
  },
  {
    name: 'Ganymede',
    type: 'moon',
    parentName: 'Jupiter',
    orbit: {
      semiMajorAxis: 0.00716, // ~1,070,400 km
      eccentricity: 0.0013,
      inclination: 0.177,
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      orbitalPeriod: Math.round(7.155 * 24), // ~172 hours
    },
    physical: {
      mass: 1.4819e23,
      radius: 2634.1,
      gravity: 1.428,
      hasAtmosphere: false,
    },
    resources: [
      { resourceType: 'ice', abundance: 0.7, totalDeposit: 400_000, remaining: 400_000, accessible: true },
      { resourceType: 'silicates', abundance: 0.5, totalDeposit: 250_000, remaining: 250_000, accessible: true },
      { resourceType: 'metals', abundance: 0.35, totalDeposit: 200_000, remaining: 200_000, accessible: true },
      { resourceType: 'rareEarths', abundance: 0.05, totalDeposit: 50_000, remaining: 50_000, accessible: true },
    ],
    position: { x: 5.21, y: 0, z: 0 },
    solarEnergyFactor: 0.037,
    surfaceConfig: { maxLandingSites: 6, generatedCount: 0 },
  },
  {
    name: 'Callisto',
    type: 'moon',
    parentName: 'Jupiter',
    orbit: {
      semiMajorAxis: 0.01259, // ~1,882,700 km
      eccentricity: 0.0074,
      inclination: 0.192,
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      orbitalPeriod: Math.round(16.689 * 24), // ~401 hours
    },
    physical: {
      mass: 1.0759e23,
      radius: 2410.3,
      gravity: 1.235,
      hasAtmosphere: false,
    },
    resources: [
      { resourceType: 'ice', abundance: 0.6, totalDeposit: 350_000, remaining: 350_000, accessible: true },
      { resourceType: 'silicates', abundance: 0.45, totalDeposit: 200_000, remaining: 200_000, accessible: true },
      { resourceType: 'metals', abundance: 0.2, totalDeposit: 100_000, remaining: 100_000, accessible: true },
      { resourceType: 'carbon', abundance: 0.15, totalDeposit: 80_000, remaining: 80_000, accessible: true },
    ],
    position: { x: 5.216, y: 0, z: 0 },
    solarEnergyFactor: 0.037,
    surfaceConfig: { maxLandingSites: 4, generatedCount: 0 },
  },

  // ── Saturn Moons ──────────────────────────────────────────────────
  {
    name: 'Titan',
    type: 'moon',
    parentName: 'Saturn',
    orbit: {
      semiMajorAxis: 0.00817, // ~1,221,870 km
      eccentricity: 0.0288,
      inclination: 0.348,
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      orbitalPeriod: Math.round(15.945 * 24), // ~383 hours
    },
    physical: {
      mass: 1.3452e23,
      radius: 2574.7,
      gravity: 1.352,
      hasAtmosphere: true,
    },
    resources: [
      { resourceType: 'organics', abundance: 0.85, totalDeposit: 500_000, remaining: 500_000, accessible: true },
      { resourceType: 'ice', abundance: 0.6, totalDeposit: 350_000, remaining: 350_000, accessible: true },
      { resourceType: 'hydrogen', abundance: 0.4, totalDeposit: 250_000, remaining: 250_000, accessible: true },
      { resourceType: 'carbon', abundance: 0.5, totalDeposit: 300_000, remaining: 300_000, accessible: true },
    ],
    position: { x: 9.545, y: 0, z: 0 },
    solarEnergyFactor: 0.011,
    surfaceConfig: { maxLandingSites: 4, generatedCount: 0 },
  },
  {
    name: 'Enceladus',
    type: 'moon',
    parentName: 'Saturn',
    orbit: {
      semiMajorAxis: 0.00159, // ~238,042 km
      eccentricity: 0.0047,
      inclination: 0.009,
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      orbitalPeriod: Math.round(1.37 * 24), // ~33 hours
    },
    physical: {
      mass: 1.08e20,
      radius: 252.1,
      gravity: 0.113,
      hasAtmosphere: false,
    },
    resources: [
      { resourceType: 'ice', abundance: 0.95, totalDeposit: 100_000, remaining: 100_000, accessible: true },
      { resourceType: 'organics', abundance: 0.3, totalDeposit: 30_000, remaining: 30_000, accessible: true },
      { resourceType: 'silicates', abundance: 0.2, totalDeposit: 20_000, remaining: 20_000, accessible: true },
      { resourceType: 'hydrogen', abundance: 0.15, totalDeposit: 15_000, remaining: 15_000, accessible: true },
    ],
    position: { x: 9.539, y: 0, z: 0 },
    solarEnergyFactor: 0.011,
    surfaceConfig: { maxLandingSites: 3, generatedCount: 0 },
  },

  // ── Kuiper Belt & Neptune's moon ──────────────────────────────────
  {
    name: 'Triton',
    type: 'moon',
    parentName: 'Neptune',
    orbit: {
      semiMajorAxis: 0.00237, // ~354,759 km
      eccentricity: 0.000016,
      inclination: 156.885, // retrograde orbit
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      orbitalPeriod: Math.round(5.877 * 24), // ~141 hours
    },
    physical: {
      mass: 2.14e22,
      radius: 1353.4,
      gravity: 0.779,
      hasAtmosphere: true,
    },
    resources: [
      { resourceType: 'ice', abundance: 0.8, totalDeposit: 300_000, remaining: 300_000, accessible: true },
      { resourceType: 'organics', abundance: 0.35, totalDeposit: 150_000, remaining: 150_000, accessible: true },
      { resourceType: 'metals', abundance: 0.15, totalDeposit: 80_000, remaining: 80_000, accessible: true },
      { resourceType: 'carbon', abundance: 0.25, totalDeposit: 120_000, remaining: 120_000, accessible: true },
    ],
    position: { x: 30.071, y: 0, z: 0 },
    solarEnergyFactor: 0.0011,
    surfaceConfig: { maxLandingSites: 3, generatedCount: 0 },
  },
  {
    name: 'Pluto',
    type: 'dwarf_planet',
    parentName: 'Sol',
    orbit: {
      semiMajorAxis: 39.482,
      eccentricity: 0.2488,
      inclination: 17.16,
      longitudeOfAscendingNode: 110.3,
      argumentOfPeriapsis: 113.76,
      meanAnomalyAtEpoch: 14.53,
      orbitalPeriod: Math.round(247.94 * EARTH_YEAR_TICKS),
    },
    physical: {
      mass: 1.303e22,
      radius: 1188.3,
      gravity: 0.62,
      hasAtmosphere: true,
    },
    resources: [
      { resourceType: 'ice', abundance: 0.75, totalDeposit: 120_000, remaining: 120_000, accessible: true },
      { resourceType: 'organics', abundance: 0.3, totalDeposit: 60_000, remaining: 60_000, accessible: true },
      { resourceType: 'carbon', abundance: 0.2, totalDeposit: 50_000, remaining: 50_000, accessible: true },
      { resourceType: 'metals', abundance: 0.1, totalDeposit: 30_000, remaining: 30_000, accessible: true },
    ],
    position: { x: 39.482, y: 0, z: 0 },
    solarEnergyFactor: 0.00064,
    surfaceConfig: { maxLandingSites: 3, generatedCount: 0 },
  },
  {
    name: 'Kuiper Belt Zone',
    type: 'belt_zone',
    parentName: 'Sol',
    orbit: {
      semiMajorAxis: 42.0,
      eccentricity: 0.1,
      inclination: 10.0,
      longitudeOfAscendingNode: 0,
      argumentOfPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      orbitalPeriod: Math.round(272.0 * EARTH_YEAR_TICKS),
    },
    physical: {
      mass: 0,
      radius: 0,
      gravity: 0,
      hasAtmosphere: false,
    },
    resources: [
      { resourceType: 'ice', abundance: 0.8, totalDeposit: 0, remaining: 0, accessible: true },
      { resourceType: 'organics', abundance: 0.4, totalDeposit: 0, remaining: 0, accessible: true },
      { resourceType: 'carbon', abundance: 0.35, totalDeposit: 0, remaining: 0, accessible: true },
      { resourceType: 'metals', abundance: 0.15, totalDeposit: 0, remaining: 0, accessible: true },
      { resourceType: 'silicates', abundance: 0.2, totalDeposit: 0, remaining: 0, accessible: true },
    ],
    position: { x: 42.0, y: 0, z: 0 },
    solarEnergyFactor: 0.00057,
    beltConfig: {
      maxAsteroids: 200,
      generatedCount: 0,
      density: 3,
      compositionWeights: { metallic: 0.05, carbonaceous: 0.15, siliceous: 0.1, icy: 0.7 },
    },
  },
];

export async function seedSolSystem(): Promise<void> {
  console.log('Seeding Sol system celestial bodies...');

  // Clear existing data
  await CelestialBody.deleteMany({});

  // Pass 1: Insert all bodies without parentId
  const bodyDocs = [];
  for (const body of bodies) {
    const doc = await CelestialBody.create({
      name: body.name,
      type: body.type,
      parentId: null,
      orbit: body.orbit,
      physical: body.physical,
      resources: body.resources,
      position: body.position,
      solarEnergyFactor: body.solarEnergyFactor,
      beltConfig: body.beltConfig ?? null,
      surfaceConfig: body.surfaceConfig ?? null,
    });
    bodyDocs.push(doc);
  }

  // Pass 2: Update parentId references by looking up parent names
  const nameToId = new Map(bodyDocs.map((d) => [d.name, d._id]));

  for (const body of bodies) {
    if (body.parentName) {
      const parentId = nameToId.get(body.parentName);
      if (parentId) {
        await CelestialBody.updateOne(
          { name: body.name },
          { $set: { parentId } },
        );
      } else {
        console.warn(`  Warning: parent "${body.parentName}" not found for "${body.name}"`);
      }
    }
  }

  console.log(`  Inserted ${bodyDocs.length} celestial bodies.`);
}
