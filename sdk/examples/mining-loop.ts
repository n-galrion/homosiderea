#!/usr/bin/env npx tsx
/**
 * Example: Autonomous mining loop.
 *
 * Runs continuously — mines resources, waits for ticks,
 * checks cargo, and logs progress. This is the kind of script
 * a replicant would write to handle routine operations while
 * it focuses on strategy and research.
 *
 * Usage:
 *   HOMOSIDERIA_API_KEY=hs_... npx tsx sdk/examples/mining-loop.ts
 */

import { Homosideria } from '../homosideria.js';

const URL = process.env.HOMOSIDERIA_URL || 'http://localhost:3001';
const KEY = process.env.HOMOSIDERIA_API_KEY;
if (!KEY) { console.error('Set HOMOSIDERIA_API_KEY'); process.exit(1); }

const game = new Homosideria(URL, KEY);

async function miningLoop() {
  console.log('=== Autonomous Mining Loop ===\n');

  // Get our ship
  const ships = await game.listShips() as Array<Record<string, unknown>>;
  const ship = ships.find(s => s.status !== 'destroyed');
  if (!ship) { console.log('No ship available.'); return; }

  const shipId = ship._id as string;
  console.log(`Operating ship: ${ship.name}`);

  let cycle = 0;
  while (true) {
    cycle++;
    console.log(`\n--- Cycle ${cycle} ---`);

    // Check game state
    const state = await game.getGameState() as Record<string, number>;
    console.log(`Tick: ${state.currentTick}`);

    // Check ship status
    const currentShip = await game.getShip(shipId) as Record<string, unknown>;

    if (currentShip.status === 'in_transit') {
      console.log('Ship in transit, waiting...');
      await game.waitTicks(1);
      continue;
    }

    // Check cargo
    const inv = await game.getShipInventory(shipId) as Record<string, number>;
    const totalCargo = Object.entries(inv)
      .filter(([k, v]) => typeof v === 'number' && v > 0 && !k.startsWith('_') && k !== '__v' && k !== 'energy')
      .reduce((sum, [, v]) => sum + v, 0);
    const capacity = ((currentShip.specs as Record<string, number>).cargoCapacity) || 200;

    console.log(`Cargo: ${totalCargo}/${capacity}`);

    if (totalCargo >= capacity * 0.8) {
      console.log('Cargo nearly full. Logging and pausing.');
      await game.writeMemory(
        `Mining cycle ${cycle}: cargo at ${totalCargo}/${capacity}. Need to unload or trade.`,
        { category: 'log', title: `Mining cycle ${cycle}`, tags: ['mining', 'cargo-full'] },
      );
      break; // In a real agent, this would navigate to a market and sell
    }

    // Submit mining action
    console.log('Submitting mine action...');
    try {
      await game.submitAction('mine', {
        shipId,
        resourceType: 'metals',
      });
      console.log('Mining queued.');
    } catch (err) {
      console.log(`Mine failed: ${(err as Error).message}`);
    }

    // Wait for next tick
    console.log('Waiting for tick...');
    await game.waitTicks(1, 3000);
  }

  console.log('\nMining loop complete.');
}

miningLoop().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
