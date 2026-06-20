import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, registerReplicant } from './setup.js';
import { Message } from '../src/db/models/index.js';
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
