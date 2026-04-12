/**
 * Test server that uses mongodb-memory-server — no external MongoDB needed.
 * Usage: npx tsx src/test-server.ts
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from './api/server.js';
import { handleMcpPost, handleMcpGet, handleMcpDelete } from './mcp/server.js';
import { GameLoop } from './engine/GameLoop.js';
import { setGameLoopRef } from './api/routes/admin.routes.js';
import { seedSolSystem } from './db/seeds/solSystem.js';
import { seedBlueprints } from './db/seeds/blueprints.js';
import { seedLandingSites } from './db/seeds/landingSites.js';
import { seedSettlements } from './db/seeds/settlements.js';

const PORT = 3001;

async function main() {
  console.log('=== Homosideria: Test Server ===\n');

  // 1. Start in-memory MongoDB
  console.log('Starting in-memory MongoDB...');
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  console.log(`MongoDB URI: ${uri}`);

  await mongoose.connect(uri);
  console.log('Connected.\n');

  // 2. Seed everything
  console.log('Seeding Sol system...');
  await seedSolSystem();
  console.log('Seeding landing sites...');
  await seedLandingSites();
  console.log('Seeding blueprints...');
  await seedBlueprints();
  console.log('Seeding settlements...');
  await seedSettlements();
  console.log('All seed data loaded.\n');

  // 3. Create app + MCP
  const app = createApp();
  app.post('/mcp', handleMcpPost);
  app.get('/mcp', handleMcpGet);
  app.delete('/mcp', handleMcpDelete);

  // 4. Game loop (60s ticks for testing)
  const gameLoop = new GameLoop();
  setGameLoopRef(gameLoop);

  // 5. Start
  app.listen(PORT, () => {
    console.log(`Server: http://localhost:${PORT}`);
    console.log(`Health: http://localhost:${PORT}/health`);
    console.log(`API:    http://localhost:${PORT}/api`);
    console.log(`MCP:    http://localhost:${PORT}/mcp`);
    console.log('\nStarting game loop (30s ticks)...\n');
    gameLoop.start();
  });

  const shutdown = async () => {
    console.log('\nShutting down...');
    gameLoop.stop();
    await mongoose.disconnect();
    await mongod.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
