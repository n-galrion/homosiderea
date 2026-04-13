import mongoose from 'mongoose';
import http from 'node:http';
import { config } from '../config.js';
import { WorkerLoop } from './WorkerLoop.js';

async function main(): Promise<void> {
  console.log('[Agent Worker] Starting...');

  // Smaller connection pool than game server — worker is mostly I/O bound
  // on LLM calls and REST/queue roundtrips, not heavy DB queries.
  await mongoose.connect(config.mongodb.uri, { maxPoolSize: 10 });
  console.log('[Agent Worker] MongoDB connected');

  if (!config.agent.encryptionKey || config.agent.encryptionKey.length !== 64) {
    console.warn('[Agent Worker] WARNING: AGENT_ENCRYPTION_KEY not set or invalid. Agent API keys cannot be decrypted.');
  }

  const worker = new WorkerLoop();
  await worker.start();

  // Optional /healthz endpoint for load balancers / k8s liveness probes.
  // Exposes ready status once the worker has started successfully.
  let healthServer: http.Server | null = null;
  if (config.worker.healthPort > 0) {
    healthServer = http.createServer((req, res) => {
      if (req.url === '/healthz' || req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', mode: config.worker.mode, concurrency: config.worker.concurrency }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    healthServer.listen(config.worker.healthPort, () => {
      console.log(`[Agent Worker] Health endpoint listening on :${config.worker.healthPort}/healthz`);
    });
  }

  const shutdown = async (signal: string) => {
    console.log(`[Agent Worker] Received ${signal}, shutting down gracefully...`);
    if (healthServer) {
      healthServer.close();
    }
    await worker.stop();
    await mongoose.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('[Agent Worker] Fatal error:', err);
  process.exit(1);
});
