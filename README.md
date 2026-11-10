# SOCUD (System of Control Unstructured Data)

SOCUD is a collaborative knowledge base and a Confluence alternative. Teams organize documents into spaces and edit them together in real time (Tiptap + Yjs), find content with semantic search backed by vector embeddings, and explore how documents relate in a knowledge graph.

## Architecture

| Component | Stack | Port |
| --- | --- | --- |
| `socud-frontend` | Next.js 16, React 19, Tiptap, Yjs | 3001 |
| `socud-backend` (REST) | NestJS 11, Prisma 7 | 3000 |
| `socud-backend` (WebSocket) | Hocuspocus (collaborative editing) | 3002 |
| `socud-ai-worker` | FastAPI, sentence-transformers (`intfloat/multilingual-e5-base`, 768-dim) | 8000 |
| PostgreSQL (`docker-compose.yml`) | PostgreSQL 18 + pgvector | 5432 |

REST and WebSocket (Hocuspocus) run in the same NestJS process.

## Prerequisites

- Node.js 22 (see `.nvmrc`; `nvm use` picks it up). The backend needs Node >= 20.19, the frontend >= 20.9.
- Python 3.12
- Docker (for PostgreSQL with pgvector)

## Quick start

Run every command from the repository root. Steps 3, 4, and 5 keep running, so use a separate terminal for each.

```bash
# 1. Database (PostgreSQL + pgvector, published on 127.0.0.1:5432 only)
cp .env.example .env   # then set POSTGRES_PASSWORD in .env (compose refuses to start without it)
docker compose up -d

# 2. Backend: configure, install, generate the Prisma client, apply migrations
(cd socud-backend && cp .env.example .env && npm ci && npx prisma generate && npx prisma migrate deploy)

# 3. Backend: start (REST on 3000, WebSocket on 3002)
cd socud-backend && npm run start:dev

# 4. AI worker (the ~1 GB model downloads on first start)
cd socud-ai-worker && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && python main.py

# 5. Frontend
cd socud-frontend && cp .env.example .env.local && npm ci && npm run dev
```

Then open http://localhost:3001.

## Run everything in Docker

Backend, frontend, PostgreSQL and Redis run as containers. The AI worker does **not**: it needs Apple's MLX (Metal), which is unavailable inside Docker, so it keeps running natively on the Mac (step 4 above) and the backend container reaches it at `http://host.docker.internal:8000`.

```bash
cp .env.example .env     # set POSTGRES_PASSWORD and JWT_SECRET (openssl rand -hex 32); see the "Full stack" section
docker compose --profile app up -d --build
```

- Services: `db` (PostgreSQL + pgvector), `redis` (AOF persistence), `migrate` (one-shot `prisma migrate deploy`, runs before the backend), `backend`, `frontend`. The app services are behind the `app` profile, so plain `docker compose up -d db` still starts only the database for native development.
- Networks: `db`, `redis`, `migrate` and `backend` share an `internal` network without external access; only the backend and frontend are on `edge`. Published ports (all on `127.0.0.1`): frontend 3001, backend REST 3000, backend WebSocket 3002, plus PostgreSQL 5432 for native development. Redis is not published; for native development install Redis locally (`brew install redis && redis-server`).
- Health checks: the backend exposes unauthenticated `GET /health` (`{"status":"ok","db":"up"}`, or 503 when the database ping fails); `depends_on` waits for `service_healthy`.
- Why a `migrate` service and not an entrypoint: the runtime image stays free of the Prisma CLI and dev dependencies, and migrations run exactly once even if the backend is scaled.
- `NEXT_PUBLIC_*` are baked into the frontend image; after changing them run `docker compose --profile app build frontend`.
- Stop with `docker compose --profile app down` (never add `-v` unless you want to delete the `pgdata` volume).
- Several stacks side by side: use `-p <name>` plus `POSTGRES_CONTAINER_NAME` and the `*_HOST_PORT` variables from `.env.example`.

### AI worker and `host.docker.internal`

Verified with OrbStack: a process on the host bound to `127.0.0.1` **is** reachable from a container (including the backend container, with `extra_hosts: host.docker.internal:host-gateway`, which `docker-compose.yml` sets for Linux compatibility). The worker therefore keeps `HOST=127.0.0.1`. On Docker Desktop for Mac, loopback-bound hosts are also reachable; on a Linux engine `host-gateway` points at the bridge IP and the worker would need `HOST=0.0.0.0` together with `WORKER_TOKEN` and a firewall rule. Set `AI_WORKER_TOKEN` (backend) equal to `WORKER_TOKEN` (worker).

### First admin

The seed creates the first system admin (`User.isSystemAdmin`, which bypasses membership checks). Put `SEED_ADMIN_EMAIL` and a password of at least 12 characters in `SEED_ADMIN_PASSWORD` into the root `.env` (Docker) or `socud-backend/.env` (native), then:

```bash
docker compose --profile app run --rm migrate npx prisma db seed   # Docker
(cd socud-backend && npm run db:seed)                              # native
```

It is idempotent: an existing admin is left untouched; an existing non-admin user with that email is promoted (password unchanged). Weak or missing passwords are refused, and the password is never printed. Remove the two variables afterwards.

### Logging and Sentry

The backend logs JSON through pino (`nestjs-pino`): one line per request with a request id (`X-Request-Id` is reused when well-formed, otherwise generated, and echoed in the response), `Authorization`, cookies, `X-Worker-Token`, and password/token fields are redacted. Set `LOG_LEVEL` (default `info` in production, `debug` in development). Output is pretty-printed only with `NODE_ENV=development`. Sentry (`@sentry/nestjs`) is enabled only when `SENTRY_DSN` is set and sends no cookies, headers, bodies, or user data. Frontend Sentry is not set up yet.

Before step 1, set `POSTGRES_PASSWORD` in the root `.env` (for example `openssl rand -hex 24`). Before step 3, edit `socud-backend/.env`: set `JWT_SECRET` to a random string of at least 32 characters (`openssl rand -hex 32`) and make `DATABASE_URL` match the root `.env` (`postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:5432/<POSTGRES_DB>`). The `DATABASE_URL` in `socud-backend/.env.example` still contains the old default password `check-socud`, so it must be changed. The backend refuses to start if a required variable is missing or invalid.

An existing database volume keeps the password it was created with: `POSTGRES_PASSWORD` is applied only when the volume is first initialised. If you already have data from an earlier version, set `POSTGRES_PASSWORD=check-socud` (the old default) in the root `.env`, or change the password inside the database with `ALTER USER` and use the new one in both files.

`socud-frontend/.npmrc` sets `legacy-peer-deps=true` because `@aarkue/tiptap-math-extension` declares a peer dependency on Tiptap 3 while the app uses Tiptap 2. Remove it once that dependency is aligned.

## Environment variables

Each service ships an example file: `.env.example` (root, for Docker Compose), `socud-backend/.env.example`, `socud-frontend/.env.example`, `socud-ai-worker/.env.example`.

### Root (`.env`, used by `docker-compose.yml`)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `POSTGRES_USER` | no | `dbsocud` | Database user |
| `POSTGRES_PASSWORD` | yes | none | Database password; `docker compose` refuses to start without it |
| `POSTGRES_DB` | no | `socud_db` | Database name |
| `JWT_SECRET` | `--profile app` | none | Backend access token secret (32+ characters) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | seed only | none | First admin, see "First admin" |
| `AI_WORKER_URL`, `AI_WORKER_TOKEN`, `LOG_LEVEL`, `SENTRY_DSN`, `CORS_ORIGIN` | no | see `.env.example` | Passed through to the backend container |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL` | no | `http://localhost:3000`, `ws://127.0.0.1:3002` | Frontend build args (browser-facing URLs) |
| `*_HOST_PORT`, `POSTGRES_CONTAINER_NAME`, `NODE_VERSION` | no | see `.env.example` | Port / name / Node overrides |

### Backend (`socud-backend/.env`)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | none | PostgreSQL connection string |
| `JWT_SECRET` | yes | none | Access token secret, at least 32 characters |
| `PORT` | no | `3000` | REST API port |
| `WS_PORT` | no | `3002` | Hocuspocus WebSocket port |
| `AI_WORKER_URL` | no | `http://127.0.0.1:8000` | Base URL of the AI worker |
| `AI_WORKER_TOKEN` | no | none | Sent to the worker as `X-Worker-Token`; must equal the worker's `WORKER_TOKEN` |
| `ACCESS_RECHECK_MS` | no | `15000` | Minimum interval between access re-checks of an open Hocuspocus connection (positive integer, ms) |
| `WS_STORE_DEBOUNCE_MS` | no | `2000` | Debounce before Hocuspocus saves a changed document (positive integer, ms) |
| `CORS_ORIGIN` | no | `http://localhost:3001` | Allowed origin(s); comma-separated list allowed |
| `NODE_ENV` | no | `development` | `development`, `production`, or `test` |
| `LOG_LEVEL` | no | `info` (production), `debug` (development) | pino level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `SENTRY_DSN` | no | none | Enables Sentry error reporting when set |
| `SENTRY_TRACES_SAMPLE_RATE` | no | `0` | Fraction (0..1) of requests traced |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | seed only | none | Read by `npm run db:seed` only |

### Frontend (`socud-frontend/.env.local`)

Both variables are inlined at build time, so rebuild after changing them.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | no | `http://localhost:3000` | Backend REST URL |
| `NEXT_PUBLIC_WS_URL` | no | `ws://127.0.0.1:3002` | Backend WebSocket URL |

### AI worker (`socud-ai-worker/.env`, optional)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MODEL_NAME` | no | `intfloat/multilingual-e5-base` | Sentence-transformers model |
| `MAX_BATCH_SIZE` | no | `32` | Maximum texts per `/embed` request |
| `MAX_TEXT_LENGTH` | no | `15000` | Maximum characters per text |
| `INFERENCE_BATCH_SIZE` | no | `16` | Internal inference batch size |
| `HOST` | no | `127.0.0.1` | Bind address (loopback; change only together with `WORKER_TOKEN` and a firewall or internal network) |
| `PORT` | no | `8000` | Bind port |
| `WORKER_TOKEN` | no | none | If set, `POST /embed` requires the header `X-Worker-Token: <value>` (`/health` stays open); set the same value as `AI_WORKER_TOKEN` in the backend |

## Common scripts

| Service | Command | Purpose |
| --- | --- | --- |
| `socud-backend` | `npm run lint:ci` | ESLint without auto-fix |
| `socud-backend` | `npm run typecheck` | TypeScript check |
| `socud-backend` | `npm test` | Unit tests (no database needed) |
| `socud-backend` | `npm run test:e2e` | End-to-end tests (requires running PostgreSQL) |
| `socud-backend` | `npm run build` | Production build |
| `socud-backend` | `npm run db:seed` | Create the first admin (see "First admin") |
| `socud-frontend` | `npm run lint` | ESLint |
| `socud-frontend` | `npm run typecheck` | TypeScript check |
| `socud-frontend` | `npm test` | Unit tests (Vitest) |
| `socud-frontend` | `npm run build` | Production build |
| `socud-ai-worker` | `python -m py_compile main.py` | Syntax check |

GitHub Actions (`.github/workflows/ci.yml`) runs these checks for the backend, frontend, and AI worker (plus a build-only job for the Docker images) on every push and pull request to `main`. The worker job runs only a syntax check and a minimal `ruff` lint, because installing its dependencies (PyTorch, model download) is too heavy for CI.

## Security model

- Access is role based: OWNER, EDITOR, or VIEWER per space, optional per-document overrides, and a system admin flag that bypasses membership checks. Only OWNERs (and admins) change members; the last OWNER of a space cannot be removed or demoted.
- Archived documents return 404 for everyone. There is no restore endpoint yet (the UI's Restore button calls a route that does not exist), so an archived document can only be hard-deleted by an OWNER.
- The refresh token is an opaque random value stored hashed in the database and sent in an httpOnly, SameSite=Strict cookie scoped to `/auth`. It rotates on every use, reuse of an old token revokes the whole session family, and a session lasts at most 30 days.
- The access token (JWT, 15 minutes) is kept in `localStorage`.
- Hocuspocus authenticates with the access token and re-checks access periodically (`ACCESS_RECHECK_MS`): revoked or archived documents are closed, role changes toggle read-only.
- Document HTML is sanitized on the server when it is published and again in the browser (DOMPurify) when it is rendered; links are limited to http(s), mailto, relative, and `#`.
- Rate limits per client IP: 100 requests per minute globally, 5 per minute for login and register.
- The frontend sends a Content-Security-Policy and other security headers; the backend uses helmet and credentialed CORS limited to `CORS_ORIGIN`.

## Project layout

```
.
├── .github/workflows/   CI workflow
├── docker-compose.yml   PostgreSQL + pgvector, Redis, backend, frontend (app profile)
├── socud-ai-worker/     FastAPI embedding service (main.py, requirements.txt)
├── socud-backend/       NestJS API + Hocuspocus
│   ├── prisma/          schema and migrations
│   ├── src/             auth, document, space, hocuspocus, prisma modules
│   └── test/            e2e tests
└── socud-frontend/      Next.js app
    ├── public/
    └── src/             app (routes), components, lib
```

## Known limitations

- SOCUD is a prototype and is not production-ready.
- The access token is still stored in `localStorage`, so an XSS bug would expose it.
- Rate limiting is in-memory per process and keyed by client IP. Behind a reverse proxy every request appears to come from the proxy until `trust proxy` is configured, which is not done yet.
- There is no email verification and no account lockout.
- Hocuspocus listens on all interfaces without an Origin check. End-to-end tests (`npm run test:e2e`) need a running PostgreSQL instance.
