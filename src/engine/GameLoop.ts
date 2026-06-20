import { Tick } from '../db/models/index.js';
import { config } from '../config.js';
import { runtimeSettings } from '../shared/runtimeSettings.js';
import { TickProcessor } from './TickProcessor.js';
import type { TickResult } from '../shared/types.js';
import { getRedisPublisher } from '../shared/redis.js';

/**
 * Manages the setInterval-based tick scheduler for the game engine.
 * Uses a simple boolean mutex to prevent overlapping ticks.
 */
export class GameLoop {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private currentTick: number = 0;
  private processing: boolean = false;
  private tickProcessor: TickProcessor;

  constructor() {
    this.tickProcessor = new TickProcessor();
  }

  /**
   * Initialize the current tick number from the database and start the tick loop.
   */
  async start(): Promise<void> {
    // Read the latest Tick document to determine where to resume
    const latestTick = await Tick.findOne().sort({ tickNumber: -1 }).lean();
    this.currentTick = latestTick ? latestTick.tickNumber : 0;

    console.log(`[GameLoop] Starting at tick ${this.currentTick + 1}, interval=${runtimeSettings.tickIntervalMs}ms`);

    this.startInterval();
  }

  private startInterval(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }
    this.intervalHandle = setInterval(() => {
      void this.executeTick();
    }, runtimeSettings.tickIntervalMs);
  }

  /**
   * Stop the tick loop entirely (shutdown).
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      console.log('[GameLoop] Stopped');
    }
  }

  /**
   * Pause the tick loop. Tick counter is preserved.
   */
  pause(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    runtimeSettings.paused = true;
    console.log('[GameLoop] Paused');
  }

  /**
   * Resume the tick loop from where it was paused.
   */
  resume(): void {
    if (this.intervalHandle) return;
    runtimeSettings.paused = false;
    console.log(`[GameLoop] Resumed at tick ${this.currentTick + 1}`);
    this.startInterval();
  }

  /**
   * Update the tick interval at runtime.
   */
  setTickInterval(ms: number): void {
    runtimeSettings.tickIntervalMs = ms;
    if (this.intervalHandle) {
      this.startInterval();
      console.log(`[GameLoop] Tick interval changed to ${ms}ms`);
    }
  }

  /**
   * Returns true if the loop is paused.
   */
  isPaused(): boolean {
    return runtimeSettings.paused;
  }

  /**
   * Immediately process one tick (for admin / testing use).
   * Bypasses the interval but still respects the mutex.
   * Works even when paused.
   */
  async forceTick(): Promise<TickResult | null> {
    return this.executeTick();
  }

  /**
   * Returns the current (most recently completed) tick number.
   */
  getCurrentTick(): number {
    return this.currentTick;
  }

  /**
   * Reset the in-memory tick counter to 0. Called after wiping Tick documents.
   */
  resetTick(): void {
    this.currentTick = 0;
    console.log('[GameLoop] Tick counter reset to 0');
  }

  /**
   * Execute a single tick with mutex protection.
   */
  private async executeTick(): Promise<TickResult | null> {
    // Mutex: skip if a tick is already being processed
    if (this.processing) {
      console.warn('[GameLoop] Tick skipped — previous tick still processing');
      return null;
    }

    this.processing = true;
    const nextTick = this.currentTick + 1;

    try {
      const result = await this.tickProcessor.processTick(nextTick);
      this.currentTick = nextTick;

      // Notify agent workers that a tick completed
      const redis = getRedisPublisher();
      if (redis) {
        redis.publish('tick:complete', JSON.stringify({ tick: nextTick })).catch(() => {});
      }

      if (result.errors.length > 0) {
        console.warn(`[GameLoop] Tick ${nextTick} completed with ${result.errors.length} error(s) in ${result.durationMs}ms`);
      } else {
        console.log(`[GameLoop] Tick ${nextTick} completed in ${result.durationMs}ms — actions=${result.actionsProcessed}, messages=${result.messagesDelivered}`);
      }

      return result;
    } catch (err) {
      console.error(`[GameLoop] Tick ${nextTick} FATAL:`, err);
      return null;
    } finally {
      this.processing = false;
    }
  }
}
