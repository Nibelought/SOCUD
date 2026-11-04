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
# 1. Database (PostgreSQL + pgvector on port 5432)
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

Before step 3, edit `socud-backend/.env` and set `JWT_SECRET` and `JWT_REFRESH_SECRET` to two different random strings of at least 32 characters. The database credentials in `.env.example` should match `docker-compose.yml`. The backend refuses to start if a required variable is missing or invalid.

`socud-frontend/.npmrc` sets `legacy-peer-deps=true` because `@aarkue/tiptap-math-extension` declares a peer dependency on Tiptap 3 while the app uses Tiptap 2. Remove it once that dependency is aligned.

## Environment variables

Each service ships an example file: `socud-backend/.env.example`, `socud-frontend/.env.example`, `socud-ai-worker/.env.example`.

### Backend (`socud-backend/.env`)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | none | PostgreSQL connection string |
| `JWT_SECRET` | yes | none | Access token secret, at least 32 characters |
| `JWT_REFRESH_SECRET` | yes | none | Refresh token secret, at least 32 characters, different from `JWT_SECRET` |
| `PORT` | no | `3000` | REST API port |
| `WS_PORT` | no | `3002` | Hocuspocus WebSocket port |
| `AI_WORKER_URL` | no | `http://127.0.0.1:8000` | Base URL of the AI worker |
| `CORS_ORIGIN` | no | `http://localhost:3001` | Allowed origin(s); comma-separated list allowed |
| `NODE_ENV` | no | `development` | `development`, `production`, or `test` |

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
| `HOST` | no | `0.0.0.0` | Bind address |
| `PORT` | no | `8000` | Bind port |

## Common scripts

| Service | Command | Purpose |
| --- | --- | --- |
| `socud-backend` | `npm run lint:ci` | ESLint without auto-fix |
| `socud-backend` | `npm run typecheck` | TypeScript check |
| `socud-backend` | `npm test` | Unit tests (no database needed) |
| `socud-backend` | `npm run test:e2e` | End-to-end tests (requires running PostgreSQL) |
| `socud-backend` | `npm run build` | Production build |
| `socud-frontend` | `npm run lint` | ESLint |
| `socud-frontend` | `npm run typecheck` | TypeScript check |
| `socud-frontend` | `npm run build` | Production build |
| `socud-ai-worker` | `python -m py_compile main.py` | Syntax check |

GitHub Actions (`.github/workflows/ci.yml`) runs these checks for the backend, frontend, and AI worker on every push and pull request to `main`. The worker job runs only a syntax check and a minimal `ruff` lint, because installing its dependencies (PyTorch, model download) is too heavy for CI.

## Project layout

```
.
├── .github/workflows/   CI workflow
├── docker-compose.yml   PostgreSQL + pgvector
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
- A security hardening phase is planned and must be completed before any public deployment.
- End-to-end tests require a running PostgreSQL instance (`docker compose up -d`).
