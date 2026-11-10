# syntax=docker/dockerfile:1
# SOCUD backend (NestJS REST on 3000 + Hocuspocus WebSocket on 3002).
# Targets: `runtime` (default, the API) and `migrate` (one-shot: prisma migrate deploy / db seed).
# Keep NODE_VERSION in line with ../.nvmrc (build with --build-arg NODE_VERSION=$(cat .nvmrc)).
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim AS base
WORKDIR /app
# Prisma needs OpenSSL at runtime; the slim image does not ship it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# All dependencies (dev included): used to build and by the migrate target.
FROM base AS deps
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# `prisma generate` only reads the schema; DATABASE_URL is a placeholder required by prisma.config.ts.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate \
 && npm run build

# Production dependencies only.
FROM base AS prod-deps
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force

# One-shot job image: full node_modules (prisma CLI, ts-node) + migrations + seed sources.
FROM build AS migrate
ENV NODE_ENV=production
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    WS_PORT=3002
COPY --from=prod-deps /app/node_modules ./node_modules
# The generated Prisma client lives in node_modules/.prisma.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000 3002
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/main"]
