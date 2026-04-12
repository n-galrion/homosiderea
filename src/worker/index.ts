import mongoose from 'mongoose';
import { config } from '../config.js';
import { WorkerLoop } from './WorkerLoop.js';

async function main(): Promise<void> {
  console.log('[Agent Worker] Starting...');

  await mongoose.connect(config.mongodb.uri);
  console.log('[Agent Worker] MongoDB connected');

  if (!config.agent.encryptionKey || config.agent.encryptionKey.length !== 64) {
    console.warn('[Agent Worker] WARNING: AGENT_ENCRYPTION_KEY not set or invalid. Agent API keys cannot be decrypted.');
  }

  const worker = new WorkerLoop();
  await worker.start();

  const shutdown = async () => {
    console.log('[Agent Worker] Shutting down...');
    await worker.stop();
    await mongoose.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch(err => {
  console.error('[Agent Worker] Fatal error:', err);
  process.exit(1);
});
