import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer } from './setup.js';
import { MCConversation } from '../src/db/models/index.js';

describe('MCConversation model', () => {
  beforeAll(async () => { await setupTestServer(); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('persists messages with proposed actions', async () => {
    const convo = await MCConversation.create({
      messages: [{
        role: 'mc', content: 'Proposing a raid.', tick: 1,
        proposedActions: [{ tool: 'spawn_pirates', args: { count: 2, narrative: 'x' }, status: 'pending', result: null }],
      }],
    });
    const found = await MCConversation.findById(convo._id).lean();
    expect(found!.messages[0].proposedActions![0].tool).toBe('spawn_pirates');
    expect(found!.messages[0].proposedActions![0].status).toBe('pending');
  });
});
