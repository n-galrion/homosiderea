import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant } from './setup.js';
import { Message, Ship, Settlement, Salvage, CelestialBody } from '../src/db/models/index.js';
import { executeMCTool } from '../src/engine/systems/mc/tools.js';

describe('executeMCTool — existing tools', () => {
  beforeAll(async () => { await setupTestServer(); await registerReplicant('MCToolTester'); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('broadcast_event sends a world_event message to every active replicant', async () => {
    const before = await Message.countDocuments({ 'metadata.type': 'world_event' });
    const out = await executeMCTool('broadcast_event', { title: 'Solar Flare', description: 'A flare disrupts comms.' }, 100);
    expect(out).toContain('Solar Flare');
    const after = await Message.countDocuments({ 'metadata.type': 'world_event' });
    expect(after).toBeGreaterThan(before);
  });

  it('returns a message for an unknown tool', async () => {
    const out = await executeMCTool('does_not_exist', {}, 100);
    expect(out.toLowerCase()).toContain('unknown');
  });
});

describe('executeMCTool — new event tools', () => {
  beforeAll(async () => { await setupTestServer(); await registerReplicant('MCEventToolTester'); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('spawn_pirates creates pirate-owned warships', async () => {
    const before = await Ship.countDocuments({ ownerId: '000000000000000000000001' });
    const out = await executeMCTool('spawn_pirates', { nearBodyName: 'Mars', count: 2, threatLevel: 'high', narrative: 'Raiders close on Mars.' }, 100);
    expect(out).toContain('2');
    const after = await Ship.countDocuments({ ownerId: '000000000000000000000001' });
    expect(after - before).toBe(2);
  });

  it('trigger_disaster damages the settlement and broadcasts', async () => {
    const out = await executeMCTool('trigger_disaster', { settlementName: 'Shanghai', severity: 'major', narrative: 'A reactor breach rocks the district.' }, 100);
    expect(out).toContain('Shanghai');
    const s = await Settlement.findOne({ name: 'Shanghai' });
    expect(s!.status).toBe('damaged');
    const broadcasts = await Message.countDocuments({ 'metadata.type': 'world_event' });
    expect(broadcasts).toBeGreaterThan(0);
  });

  it('spawn_salvage creates salvage near a body', async () => {
    const before = await Salvage.countDocuments();
    const out = await executeMCTool('spawn_salvage', { nearBodyName: 'Mars', richness: 'rich', narrative: 'A derelict hauler drifts.' }, 100);
    expect(out.toLowerCase()).toContain('salvage');
    expect(await Salvage.countDocuments()).toBeGreaterThan(before);
  });
});
