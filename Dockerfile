# ─── Shared builder stage ────────────────────────────────────────────
# Compiles TypeScript once. Both server and worker images use this output.
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src/ src/
RUN npx tsc

# ─── Shared runtime base ────────────────────────────────────────────
# Production dependencies only, no build tools.
FROM node:22-slim AS base

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/ dist/

# ─── Game Server ─────────────────────────────────────────────────────
# The main game server: Express API + MCP + Web UI + game loop.
FROM base AS server

COPY public/ public/
COPY data/ data/
COPY src/web/views/ dist/web/views/
COPY src/web/public/ dist/web/public/

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3001/health').then(r=>{if(!r.ok)throw 1})"

CMD ["node", "dist/index.js"]

# ─── Agent Worker ────────────────────────────────────────────────────
# Separate process: subscribes to Redis tick events, runs managed agents.
# Does NOT serve HTTP (except optional /healthz). No web UI files needed.
FROM base AS worker

ENV NODE_ENV=production
ENV WORKER_HEALTH_PORT=3100
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3100/healthz').then(r=>{if(!r.ok)throw 1})"

CMD ["node", "dist/worker/index.js"]
