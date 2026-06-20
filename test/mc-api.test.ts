import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestServer, teardownTestServer, api, ADMIN_KEY } from './setup.js';
import { config } from '../src/config.js';

describe('MC operator API', () => {
  beforeAll(async () => { await setupTestServer(); }, 60000);
  afterAll(async () => { await teardownTestServer(); });

  it('rejects without admin key', async () => {
    const { status } = await api('/api/admin/mc/conversation');
    expect(status).toBe(401);
  });

  it('chat returns an MC reply (offline) and conversation lists it', async () => {
    const saved = config.llm.apiKey;
    config.llm.apiKey = '';
    try {
      const chat = await api('/api/admin/mc/chat', { method: 'POST', adminKey: ADMIN_KEY, body: { message: 'hello MC' } });
      expect(chat.status).toBe(200);
      const convo = await api('/api/admin/mc/conversation', { adminKey: ADMIN_KEY });
      const d = convo.data as { messages: Array<{ role: string; content: string }> };
      expect(d.messages.some((m) => m.role === 'mc')).toBe(true);
    } finally { config.llm.apiKey = saved; }
  });
});
