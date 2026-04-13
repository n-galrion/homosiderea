import 'dotenv/config';

export const config = {
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/homosideria',
  },
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
  },
  auth: {
    adminKey: process.env.ADMIN_KEY || 'dev-admin-key',
    jwtSecret: process.env.JWT_SECRET || 'dev-jwt-secret',
    jwtExpiresIn: '24h',
  },
  game: {
    tickIntervalMs: parseInt(process.env.TICK_INTERVAL_MS || '5000', 10), // 5 seconds between simulation ticks
    gameTimeDilation: parseInt(process.env.GAME_TIME_DILATION || '600', 10), // 1 real second = 600 game seconds (10 game minutes)
  },
  llm: {
    baseUrl: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'anthropic/claude-sonnet-4',
    // Per-task model overrides — use cheaper/faster models for simple tasks
    models: {
      // Heavy reasoning: action evaluation, research, world simulation
      propose: process.env.LLM_MODEL_PROPOSE || process.env.LLM_MODEL || 'anthropic/claude-sonnet-4',
      research: process.env.LLM_MODEL_RESEARCH || process.env.LLM_MODEL || 'anthropic/claude-sonnet-4',
      worldSim: process.env.LLM_MODEL_WORLD_SIM || process.env.LLM_MODEL || 'anthropic/claude-sonnet-4',
      // Light tasks: narrative generation, NPC dialogue, event descriptions
      narrative: process.env.LLM_MODEL_NARRATIVE || process.env.LLM_MODEL_LIGHT || process.env.LLM_MODEL || 'anthropic/claude-haiku-4-5-20251001',
      npcComms: process.env.LLM_MODEL_NPC || process.env.LLM_MODEL_LIGHT || process.env.LLM_MODEL || 'anthropic/claude-haiku-4-5-20251001',
      salvage: process.env.LLM_MODEL_SALVAGE || process.env.LLM_MODEL_LIGHT || process.env.LLM_MODEL || 'anthropic/claude-haiku-4-5-20251001',
    },
  },
  session: {
    secret: process.env.SESSION_SECRET || 'homosideria-session-secret-change-me',
    maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  agent: {
    encryptionKey: process.env.AGENT_ENCRYPTION_KEY || '',
    gameApiUrl: process.env.GAME_API_URL || `http://localhost:${parseInt(process.env.PORT || '3001', 10)}`,
  },
  worker: {
    // rest = call game server over HTTP (scalable, open-source friendly)
    // direct = use in-process models + tool registry (single-host, lower latency)
    mode: (process.env.WORKER_MODE || 'rest') as 'rest' | 'direct',
    // Number of agent cycles a single worker processes in parallel
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '3', 10),
    // Port for worker /healthz endpoint (0 = disabled)
    healthPort: parseInt(process.env.WORKER_HEALTH_PORT || '3100', 10),
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
} as const;
