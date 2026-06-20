import { config } from '../config.js';

export const runtimeSettings = {
  paused: false,
  tickIntervalMs: config.game.tickIntervalMs,
  gameTimeDilation: config.game.gameTimeDilation,
};
