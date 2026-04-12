import type { Position } from './types.js';
import { LIGHT_SPEED_AU_PER_TICK, LIGHT_SPEED_AU_PER_GAME_HOUR } from './constants.js';
import { gameHoursPerTick } from './gameTime.js';

const TWO_PI = 2 * Math.PI;

/**
 * Compute position of a body from Keplerian orbital elements at a given tick.
 * Uses first-order eccentric anomaly approximation (sufficient for gameplay).
 */
export function computeOrbitalPosition(
  tick: number,
  orbit: {
    semiMajorAxis: number;
    eccentricity: number;
    inclination: number;
    longitudeOfAscendingNode: number;
    argumentOfPeriapsis: number;
    meanAnomalyAtEpoch: number;
    orbitalPeriod: number;
  },
): Position {
  const { semiMajorAxis: a, eccentricity: e, inclination: i,
    longitudeOfAscendingNode: omega, argumentOfPeriapsis: w,
    meanAnomalyAtEpoch: M0, orbitalPeriod: T } = orbit;

  if (T === 0) return { x: 0, y: 0, z: 0 };

  // Mean anomaly at current tick
  const M = (M0 + (TWO_PI / T) * tick) % TWO_PI;

  // Eccentric anomaly (first-order Newton-Raphson, 5 iterations)
  let E = M;
  for (let iter = 0; iter < 5; iter++) {
    E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  }

  // True anomaly
  const sinV = (Math.sqrt(1 - e * e) * Math.sin(E)) / (1 - e * Math.cos(E));
  const cosV = (Math.cos(E) - e) / (1 - e * Math.cos(E));
  const v = Math.atan2(sinV, cosV);

  // Distance from focus
  const r = a * (1 - e * Math.cos(E));

  // Convert inclination and angles to radians
  const iRad = (i * Math.PI) / 180;
  const omegaRad = (omega * Math.PI) / 180;
  const wRad = (w * Math.PI) / 180;

  // Position in orbital plane
  const xOrb = r * Math.cos(v);
  const yOrb = r * Math.sin(v);

  // Rotate to heliocentric ecliptic coordinates
  const cosW = Math.cos(wRad);
  const sinW = Math.sin(wRad);
  const cosO = Math.cos(omegaRad);
  const sinO = Math.sin(omegaRad);
  const cosI = Math.cos(iRad);
  const sinI = Math.sin(iRad);

  const x = (cosW * cosO - sinW * sinO * cosI) * xOrb +
            (-sinW * cosO - cosW * sinO * cosI) * yOrb;
  const y = (cosW * sinO + sinW * cosO * cosI) * xOrb +
            (-sinW * sinO + cosW * cosO * cosI) * yOrb;
  const z = (sinW * sinI) * xOrb + (cosW * sinI) * yOrb;

  return { x, y, z };
}

/**
 * Euclidean distance between two positions in AU.
 */
export function distance(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Light-speed delay in ticks between two positions.
 */
export function lightDelayTicks(a: Position, b: Position): number {
  const d = distance(a, b);
  return Math.ceil(d / LIGHT_SPEED_AU_PER_TICK);
}

/**
 * Travel time in ticks at a given speed (AU/tick).
 */
export function travelTimeTicks(a: Position, b: Position, speed: number): number {
  if (speed <= 0) return Infinity;
  return Math.ceil(distance(a, b) / speed);
}

/**
 * Interpolate position along a straight-line path.
 * progress: 0 = at start, 1 = at end.
 */
export function interpolatePosition(from: Position, to: Position, progress: number): Position {
  const t = Math.max(0, Math.min(1, progress));
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t,
  };
}

/**
 * Solar energy factor based on distance from origin (Sun).
 * Follows inverse-square law: 1.0 at 1 AU.
 */
export function solarEnergyFactor(pos: Position): number {
  const r2 = pos.x * pos.x + pos.y * pos.y + pos.z * pos.z;
  if (r2 < 0.001) return 100; // Very close to Sun
  return 1.0 / r2;
}

/**
 * Light-speed delay in game hours between two positions.
 */
export function lightDelayGameHours(a: Position, b: Position): number {
  const d = distance(a, b);
  return d / LIGHT_SPEED_AU_PER_GAME_HOUR;
}

/**
 * Travel time in game hours at a given speed (AU/tick).
 * Converts AU/tick speed to AU/game-hour internally.
 */
export function travelTimeGameHours(a: Position, b: Position, speedAUPerTick: number): number {
  if (speedAUPerTick <= 0) return Infinity;
  const speedAUPerGameHour = speedAUPerTick / gameHoursPerTick();
  return distance(a, b) / speedAUPerGameHour;
}

/**
 * Fuel cost for a trip (simplified: proportional to distance).
 */
export function fuelCost(dist: number, shipMass: number = 1): number {
  return Math.ceil(dist * shipMass * 10);
}
