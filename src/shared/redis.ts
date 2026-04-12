import { Redis } from 'ioredis';
import { config } from '../config.js';

let publisher: Redis | null = null;

/**
 * Initialize the Redis publisher. Call once at startup.
 * Fails gracefully — agent worker features are optional.
 */
export function initRedisPublisher(): void {
  if (!config.redis.url) return;
  try {
    publisher = new Redis(config.redis.url);
    publisher.on('error', (err: Error) => console.warn('[Redis] Publisher error:', err.message));
    publisher.on('connect', () => console.log('[Redis] Publisher connected'));
  } catch (err) {
    console.warn('[Redis] Could not connect:', err);
  }
}

/** Get the Redis publisher instance (null if not connected). */
export function getRedisPublisher(): Redis | null {
  return publisher;
}

/** Disconnect Redis cleanly. */
export async function disconnectRedis(): Promise<void> {
  if (publisher) {
    publisher.disconnect();
    publisher = null;
  }
}
