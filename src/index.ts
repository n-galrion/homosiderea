import { config } from './config.js';
import { connectDB } from './db/connection.js';
import { createApp } from './api/server.js';
import { handleMcpPost, handleMcpGet, handleMcpDelete, handleSSEGet, handleSSEPost } from './mcp/server.js';
import { GameLoop } from './engine/GameLoop.js';
import { setGameLoopRef } from './api/routes/admin.routes.js';
import { seedSolSystem } from './db/seeds/solSystem.js';
import { seedBlueprints } from './db/seeds/blueprints.js';
import { seedLandingSites } from './db/seeds/landingSites.js';
import { seedSettlements } from './db/seeds/settlements.js';
import { CelestialBody, Blueprint, Settlement, User } from './db/models/index.js';
import bcrypt from 'bcrypt';

async function main() {
  console.log('=== Homosideria: To the Stars ===');
  console.log(`Starting server on port ${config.server.port}...`);

  // 1. Connect to MongoDB
  console.log('Connecting to MongoDB...');
  await connectDB();
  console.log('MongoDB connected.');

  // 2. Seed data if empty
  const bodyCount = await CelestialBody.countDocuments();
  if (bodyCount === 0) {
    console.log('Seeding Sol system...');
    await seedSolSystem();
    console.log('Sol system seeded.');
  }

  const bpCount = await Blueprint.countDocuments();
  if (bpCount === 0) {
    console.log('Seeding blueprints...');
    await seedBlueprints();
    await seedLandingSites();
    console.log('Blueprints and landing sites seeded.');
  }

  const settCount = await Settlement.countDocuments();
  if (settCount === 0) {
    console.log('Seeding human civilization...');
    await seedSettlements();
    console.log('Settlements and markets seeded.');
  }

  // 2b. Create first operator user if none exist
  const userCount = await User.countDocuments();
  if (userCount === 0) {
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin';
    const hash = await bcrypt.hash(adminPass, 12);
    await User.create({
      username: adminUser,
      email: `${adminUser}@homosideria.local`,
      passwordHash: hash,
      role: 'operator',
    });
    console.log(`Operator account created: ${adminUser} / ${adminPass}`);
  }

  // 3. Create Express app
  const app = createApp();

  // 4. Mount MCP endpoints
  app.post('/mcp', handleMcpPost);
  app.get('/mcp', handleMcpGet);
  app.delete('/mcp', handleMcpDelete);

  // Legacy SSE transport (for Claude Code and older MCP clients)
  app.get('/sse', handleSSEGet);
  app.post('/sse/message', handleSSEPost);

  // 5. Initialize game loop
  const gameLoop = new GameLoop();
  setGameLoopRef(gameLoop);

  // 6. Start listening
  app.listen(config.server.port, () => {
    console.log(`\nServer running on http://localhost:${config.server.port}`);
    console.log(`REST API:  http://localhost:${config.server.port}/api`);
    console.log(`MCP:       http://localhost:${config.server.port}/mcp`);
    console.log(`Health:    http://localhost:${config.server.port}/health`);
    console.log(`\nGame tick interval: ${config.game.tickIntervalMs}ms`);
    console.log('Starting game loop...\n');

    gameLoop.start();
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    gameLoop.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
