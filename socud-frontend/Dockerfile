# syntax=docker/dockerfile:1
# SOCUD frontend (Next.js standalone server on 3001).
# Keep NODE_VERSION in line with ../.nvmrc (build with --build-arg NODE_VERSION=$(cat .nvmrc)).
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
# .npmrc carries legacy-peer-deps=true, which `npm ci` needs (see README).
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM deps AS build
# NEXT_PUBLIC_* are inlined into the browser bundle and the CSP header at build time, so they
# must be the URLs the *browser* uses to reach the backend.
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ARG NEXT_PUBLIC_WS_URL=ws://127.0.0.1:3002
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
