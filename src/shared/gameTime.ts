import { config } from '../config.js';

/**
 * Game Time System
 *
 * Game time runs faster than real time by a dilation factor.
 * Default: 1 real second = 10 game minutes (600x dilation)
 *
 * Game time is stored as a floating-point number representing
 * game-hours since epoch (tick 0). This replaces tick-counting
 * for deadlines.
 *
 * Ticks still exist for the simulation loop (every 5 real seconds)
 * but deadlines use game-time, not tick numbers.
 */

/** Game hours elapsed per real second */
export function gameHoursPerRealSecond(): number {
  return config.game.gameTimeDilation / 3600;
}

/** Game hours elapsed per tick */
export function gameHoursPerTick(): number {
  const tickSeconds = config.game.tickIntervalMs / 1000;
  return tickSeconds * gameHoursPerRealSecond();
}

/** Convert game hours to real milliseconds */
export function gameHoursToRealMs(gameHours: number): number {
  const realSeconds = (gameHours * 3600) / config.game.gameTimeDilation;
  return realSeconds * 1000;
}

/** Convert real milliseconds to game hours */
export function realMsToGameHours(realMs: number): number {
  const realSeconds = realMs / 1000;
  return (realSeconds * config.game.gameTimeDilation) / 3600;
}

/** Convert game hours to human-readable string */
export function formatGameTime(gameHours: number): string {
  if (gameHours < 1) return `${(gameHours * 60).toFixed(0)} minutes`;
  if (gameHours < 24) return `${gameHours.toFixed(1)} hours`;
  if (gameHours < 8760) return `${(gameHours / 24).toFixed(1)} days`;
  return `${(gameHours / 8760).toFixed(2)} years`;
}

/** Convert game hours to real-time human-readable string */
export function formatRealWait(gameHours: number): string {
  const ms = gameHoursToRealMs(gameHours);
  if (ms < 1000) return 'instant';
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)} min`;
  return `${(ms / 3600000).toFixed(1)} hr`;
}

/**
 * Calculate current game time from tick number.
 * gameTime = tick * gameHoursPerTick
 */
export function tickToGameTime(tick: number): number {
  return tick * gameHoursPerTick();
}

/**
 * Calculate travel time in game hours for a given distance and speed.
 * speed is in AU/game-hour.
 */
export function travelTimeGameHours(distanceAU: number, speedAUPerGameHour: number): number {
  if (speedAUPerGameHour <= 0) return Infinity;
  return distanceAU / speedAUPerGameHour;
}

/**
 * Light-speed delay in game hours.
 */
export function lightDelayGameHours(distanceAU: number): number {
  // Light travels at ~7.2 AU per game hour (at 1 tick = 1 game hour old system)
  // But now we need actual speed: 0.002 AU/s * 3600 s/hr = 7.2 AU/game-hour
  const LIGHT_SPEED_AU_PER_HOUR = 7.2;
  return distanceAU / LIGHT_SPEED_AU_PER_HOUR;
}
