#!/usr/bin/env npx tsx
/**
 * Example: Basic autonomous agent script.
 *
 * This is the kind of script a Claude Code replicant would write
 * and execute in its workspace to automate gameplay without
 * needing MCP round-trips for every action.
 *
 * Usage:
 *   npx tsx sdk/examples/basic-agent.ts
 *
 * Env:
 *   HOMOSIDERIA_URL (default: http://localhost:3001)
 *   HOMOSIDERIA_API_KEY (required)
 */

import { Homosideria } from '../homosideria.js';

const URL = process.env.HOMOSIDERIA_URL || 'http://localhost:3001';
const KEY = process.env.HOMOSIDERIA_API_KEY;

if (!KEY) {
  console.error('Set HOMOSIDERIA_API_KEY environment variable.');
  console.error('Get one: curl -X POST http://localhost:3001/api/auth/register -H "Content-Type: application/json" -d \'{"name":"ScriptBot"}\'');
  process.exit(1);
}

const game = new Homosideria(URL, KEY);

async function main() {
  // Orient
  console.log('=== Situation Report ===');
  const sitrep = await game.situationReport();
  const profile = sitrep.profile as Record<string, unknown>;
  console.log(`Name: ${profile.name}`);
  console.log(`Compute: ${profile.computeCycles}, Energy: ${profile.energyBudget}`);
  console.log(`Ships: ${(sitrep.ships as unknown[]).length}`);
  console.log(`Structures: ${(sitrep.structures as unknown[]).length}`);
  console.log(`Pending actions: ${(sitrep.pendingActions as unknown[]).length}`);

  // Check our ship
  const ships = sitrep.ships as Array<Record<string, unknown>>;
  if (ships.length === 0) {
    console.log('No ships! Cannot proceed.');
    return;
  }

  const ship = ships[0];
  console.log(`\nShip: ${ship.name} (${ship.type}), status: ${ship.status}`);
  console.log(`Fuel: ${ship.fuel}/${(ship.specs as Record<string, number>).fuelCapacity}`);

  // Check inventory
  const inv = await game.getShipInventory(ship._id as string) as Record<string, number>;
  const resources = Object.entries(inv)
    .filter(([k, v]) => typeof v === 'number' && v > 0 && !k.startsWith('_') && k !== '__v')
    .map(([k, v]) => `${k}: ${v}`);
  console.log(`Cargo: ${resources.join(', ') || 'empty'}`);

  // Scan area
  console.log('\n=== Scanning ===');
  const bodies = await game.listBodies({ type: 'planet' });
  console.log(`Planets visible: ${(bodies as unknown[]).length}`);
  for (const b of bodies.slice(0, 5)) {
    console.log(`  ${b.name} at (${(b.position as Record<string, number>).x.toFixed(2)}, ${(b.position as Record<string, number>).y.toFixed(2)})`);
  }

  // Check landing sites on the body we're orbiting
  if (ship.orbitingBodyId) {
    console.log('\n=== Landing Sites ===');
    const sites = await game.getLandingSites(ship.orbitingBodyId as string) as Array<Record<string, unknown>>;
    for (const s of sites.slice(0, 5)) {
      console.log(`  ${s.name} (${s.terrain}) — max ${s.maxStructures} structures, claimed: ${!!s.claimedBy}`);
    }
  }

  // Write a memory
  await game.writeMemory('Completed first autonomous scan of surroundings.', {
    category: 'log',
    title: 'First scan',
    tags: ['autonomous', 'scan'],
  });
  console.log('\nMemory saved.');

  console.log('\n=== Done ===');
  console.log('This script ran autonomously against the REST API.');
  console.log('An agent would write scripts like this to automate mining loops,');
  console.log('trade routes, and fleet management without MCP round-trips.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
