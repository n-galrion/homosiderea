import { connectDB, disconnectDB } from '../connection.js';
import { seedSolSystem } from './solSystem.js';
import { seedBlueprints } from './blueprints.js';
import { seedLandingSites } from './landingSites.js';
import { seedSettlements, seedFactions } from './settlements.js';

async function run(): Promise<void> {
  try {
    console.log('Connecting to MongoDB...');
    await connectDB();
    console.log('Connected.\n');

    await seedSolSystem();
    console.log();
    await seedLandingSites();
    console.log();
    await seedBlueprints();
    console.log();
    await seedSettlements();
    console.log();
    await seedFactions();

    console.log('\nSeeding complete.');
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exitCode = 1;
  } finally {
    await disconnectDB();
    console.log('Disconnected from MongoDB.');
  }
}

run();
