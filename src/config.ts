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
    tickIntervalMs: parseInt(process.env.TICK_INTERVAL_MS || '30000', 10),
    gameTimePerTick: 3600, // seconds of game time per tick (1 hour)
  },
  llm: {
    baseUrl: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'anthropic/claude-sonnet-4',
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
} as const;
