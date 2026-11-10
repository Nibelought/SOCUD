# SOCUD (System of Control Unstructured Data)

SOCUD is a collaborative knowledge base and a Confluence alternative. Teams organize documents into spaces and edit them together in real time (Tiptap + Yjs), find content with semantic search backed by vector embeddings, and explore how documents relate in a knowledge graph.

## Architecture

| Component | Stack | Port |
| --- | --- | --- |
| `socud-frontend` | Next.js 16, React 19, Tiptap, Yjs | 3001 |
| `socud-backend` (REST) | NestJS 11, Prisma 7 | 3000 |
| `socud-backend` (WebSocket) | Hocuspocus (collaborative editing) | 3002 |
| `socud-ai-worker` | FastAPI, Qwen3-Embedding-4B (1024-dim): MLX natively on Apple Silicon, or PyTorch/CUDA on another machine (e.g. an RTX 4070 PC) | 8000 |
| PostgreSQL (`docker-compose.yml`) | PostgreSQL 18 + pgvector | 5432 |

REST and WebSocket (Hocuspocus) run in the same NestJS process.

## Prerequisites

- Node.js 22 (see `.nvmrc`; `nvm use` picks it up). The backend needs Node >= 20.19, the frontend >= 20.9.
- Python 3.12 or newer (the AI worker is developed on 3.14) on an Apple Silicon Mac (MLX), or on any machine with an NVIDIA GPU (PyTorch/CUDA, see "Running the worker on another machine"). The worker does not run in Docker on a Mac.
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

# 4. AI worker, natively on the Mac (the ~2.3 GB model downloads on first start; see "AI worker" below)
cd socud-ai-worker && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && python main.py

# 5. Frontend
cd socud-frontend && cp .env.example .env.local && npm ci && npm run dev
```

Then open http://localhost:3001.

### One-command launcher (`dev.sh`)

`./dev.sh` runs the same stack from the repository root: PostgreSQL and Redis in Docker, the AI worker, the backend and the frontend as native processes (logs and PIDs in `.run/`). It never runs `docker compose down` and never removes a volume.

```bash
./dev.sh start --install     # first time: install what is missing, create the .env files (fill in the secrets it lists)
./dev.sh start               # databases, AI worker, backend, frontend
./dev.sh stop                # stop the apps and the databases (data volumes are kept)
./dev.sh restart             # restart the apps (the databases stay up); takes the same flags as start
./dev.sh status              # what is running
./dev.sh logs backend        # follow the logs (worker|backend|frontend, default all)
```

Data commands (`start` flags, or the commands of the same name):

| Flag / command | What it does |
| --- | --- |
| `--clean`, `./dev.sh reset` | **Wipes all data**: drops and re-creates the schema from the migrations, flushes Redis, empties `.run/logs`. Asks you to type `yes` (`-y` / `--yes` skips the question; required without a terminal). Refuses when `NODE_ENV` is `production` (any case), when `DATABASE_URL` is not localhost (the environment wins over `socud-backend/.env`; `SOCUD_ALLOW_REMOTE_WIPE=1` overrides this for a disposable remote database only), when there is no terminal and no `-y`, and when port 3000, 3002 or 8000 is held by a process `dev.sh` did not start. |
| `--seed` | Adds the demo data unless it is already there (idempotent, no duplicates). |
| `--reseed` | Replaces the demo data with a fresh copy (`seed:demo --reset`). |
| `--seed-args "<args>"` | Extra `seed:demo` options, e.g. `--seed-args "--langs en --limit 12"` (implies `--seed`). The string is split on whitespace, so values with spaces are not supported. `--reset`, `--if-missing` and `--embed` are refused there: use `--reseed`, `--seed`, or `./dev.sh seed --embed` once the apps are running. `./dev.sh seed --help` lists the options. |
| `--admin`, `./dev.sh admin` | Creates or promotes the admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, read from `socud-backend/.env` or the environment (not the root `.env`). Skipped with a warning when unset. |
| `--migrate`, `./dev.sh migrate` | Applies the migrations. Seeding and `--admin` apply them automatically. |
| `--db-only` | Only PostgreSQL and Redis (the data flags above still apply). |
| `--no-worker`, `--no-frontend` | Do not start the AI worker / the frontend. |
| `--install` | Installs what is missing (`npm ci`, `prisma generate`, the worker virtualenv) and copies each `.env.example` to its `.env` only when that file does not exist. |

```bash
./dev.sh start --clean --seed -y           # fresh database with the demo data, no prompt
./dev.sh start --db-only --seed --admin    # only the databases, with demo data and the admin
./dev.sh seed --langs en --limit 12        # small English sample (only when no demo data exists)
./dev.sh seed --reseed                     # replace the demo data
```

`./dev.sh --help` lists every option.

`./dev.sh reset` stops the apps that `dev.sh` started and starts nothing. `./dev.sh start --clean` and `./dev.sh restart --clean` start the apps again afterwards.

Prisma refuses `migrate reset` when it runs inside an AI coding agent, so run `reset` and `--clean` from your own terminal. If a wipe fails, the apps are already stopped and the database may be unchanged or half-reset: re-run `./dev.sh reset`, or `./dev.sh migrate`.

## Run everything in Docker

Backend, frontend, PostgreSQL and Redis run as containers. The AI worker does **not**: it needs Apple's MLX (Metal), which is unavailable inside Docker, so it keeps running natively on the Mac (step 4 above) and the backend container reaches it at `http://host.docker.internal:8000`.

```bash
cp .env.example .env     # set POSTGRES_PASSWORD and JWT_SECRET (openssl rand -hex 32); see the "Full stack" section
docker compose --profile app up -d --build
```

- Services: `db` (PostgreSQL + pgvector), `redis` (AOF persistence), `migrate` (one-shot `prisma migrate deploy`, runs before the backend), `backend`, `frontend`. The app services are behind the `app` profile, so `docker compose up -d db redis` starts just the two stores for native development.
- Networks: `db`, `redis`, `migrate` and `backend` share an `internal` network without external access; only the backend and frontend are on `edge`. Published ports (all on `127.0.0.1`): frontend 3001, backend REST 3000, backend WebSocket 3002, plus PostgreSQL 5432 and Redis 6379 for native development (backend `REDIS_URL=redis://127.0.0.1:6379`).
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

### API documentation (OpenAPI)

The backend documents its REST API with `@nestjs/swagger`. Swagger UI is served at `/api/docs` and the JSON at `/api/docs-json` when `NODE_ENV` is not `production`; set `SWAGGER_ENABLED=true|false` to override either way (the relaxed Content-Security-Policy that Swagger UI needs applies to those two routes only). The Hocuspocus WebSocket is not part of the document.

The committed `socud-backend/openapi.json` is the contract, and the frontend's typed client (`openapi-typescript` types + `openapi-fetch`) is generated from it. After changing any controller or DTO, regenerate both, in this order, and commit the results (CI fails when they are stale):

```bash
cd socud-backend && npm run openapi:export   # builds in Nest preview mode: needs no database or Redis
cd ../socud-frontend && npm run api:gen      # writes src/lib/api/schema.d.ts
```

Response types are classes in `*-response.dto.ts` files; the Nest CLI plugin (configured in `nest-cli.json`) derives request-DTO schemas from `class-validator` decorators and TypeScript types, which is why the export goes through `nest build`.

### Sessions and route protection

Besides the httpOnly `socud_refresh` cookie (scoped to path `/auth`, so the web app's server never sees it), login and refresh set a readable `socud_session=1` hint cookie (path `/`, SameSite=Lax, same lifetime; cleared on logout and on a rejected refresh). The Next.js proxy (`socud-frontend/src/proxy.ts`; Next 16's name for `middleware`) uses it to redirect signed-out visitors of `/dashboard`, `/space`, `/document` and `/graph` to `/login?next=<path>` and signed-in users away from `/login` and `/register`. `next` is accepted only as a same-origin relative path. This is a UX convenience, not a security boundary: the hint is forgeable and every API call is authenticated by the backend.

Cookies are not scoped by port, so `localhost:3001` (web) and `localhost:3000` (API) share them. If web and API live on different subdomains in production, set `SESSION_COOKIE_DOMAIN` (for example `.example.com`) in the backend; on unrelated domains the hint can never reach the web app, so set `SESSION_REDIRECTS=off` for the frontend to disable the redirects. Sessions created before this feature have no hint cookie and need one fresh login.

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
| `AI_WORKER_URL` | no | `http://127.0.0.1:8000` | Base URL of the AI worker; may point to another machine (see "Running the worker on another machine") |
| `AI_WORKER_TOKEN` | no | none | Sent to the worker as `X-Worker-Token`; must equal the worker's `WORKER_TOKEN` |
| `ACCESS_RECHECK_MS` | no | `15000` | Minimum interval between access re-checks of an open Hocuspocus connection (positive integer, ms) |
| `WS_STORE_DEBOUNCE_MS` | no | `2000` | Debounce before Hocuspocus saves a changed document (positive integer, ms) |
| `CORS_ORIGIN` | no | `http://localhost:3001` | Allowed origin(s); comma-separated list allowed |
| `NODE_ENV` | no | `development` | `development`, `production`, or `test` |
| `LOG_LEVEL` | no | `info` (production), `debug` (development) | pino level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `SWAGGER_ENABLED` | no | on unless `NODE_ENV=production` | Serve Swagger UI at `/api/docs` and JSON at `/api/docs-json` |
| `SESSION_COOKIE_DOMAIN` | no | none (host-only) | `Domain` of the `socud_session` hint cookie; only for web and API on different subdomains |
| `SENTRY_DSN` | no | none | Enables Sentry error reporting when set |
| `SENTRY_TRACES_SAMPLE_RATE` | no | `0` | Fraction (0..1) of requests traced |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | seed only | none | Read by `npm run db:seed` only |

### Frontend (`socud-frontend/.env.local`)

Both variables are inlined at build time, so rebuild after changing them.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | no | `http://localhost:3000` | Backend REST URL |
| `NEXT_PUBLIC_WS_URL` | no | `ws://127.0.0.1:3002` | Backend WebSocket URL |

Runtime-only (read by the proxy, not inlined): `SESSION_REDIRECTS=off` disables the session redirects (see "Sessions and route protection").

### AI worker (`socud-ai-worker/.env`, optional)

The worker computes embeddings with Qwen3-Embedding-4B. Two backends share one pipeline (text cleaning, query prefix, last-token pooling, Matryoshka truncation) and the same HTTP API: `mlx-community/Qwen3-Embedding-4B-4bit-DWQ` on [MLX](https://github.com/ml-explore/mlx) (the default on an Apple Silicon Mac), and `Qwen/Qwen3-Embedding-4B` on PyTorch (CUDA, or MPS/CPU), which lets the worker run on another machine. MLX has no Metal access inside Docker, so it is not containerized; containers reach it at `http://host.docker.internal:8000`. This works with the default loopback bind on OrbStack (verified); other Docker runtimes may need `HOST=0.0.0.0` (unverified), in which case also set `WORKER_TOKEN` and keep the port off the network. Embeddings are 1024-dimensional (Matryoshka-truncated, L2-normalised), last-token pooled; queries get the `Instruct: ...\nQuery:` prefix, documents do not.

```bash
cd socud-ai-worker
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python main.py        # http://127.0.0.1:8000
```

The first start downloads the model (about 2.3 GB) into `~/.cache/huggingface`. The port opens immediately; `GET /health` returns 503 `{"status":"loading"}` until the model is ready, then 200 `{"status":"ok","model":...,"dim":1024,"device":"mlx"}`. With the model loaded the worker needs roughly 3 to 5 GB of memory. To verify a running worker end to end (dimension, norm, Russian/English retrieval), run `python scripts/smoke_test.py`.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `BACKEND` | no | `auto` | `mlx`, `torch`, `openai` (remote OpenAI-compatible server), or `auto` (mlx on an Apple Silicon Mac, torch elsewhere) |
| `REMOTE_URL` | with `openai` | none | Base URL of the OpenAI-compatible server including `/v1` |
| `REMOTE_API_KEY` | no | none | Bearer key for that server |
| `REMOTE_TIMEOUT` | no | `120` | Per-request timeout towards that server, seconds |
| `REMOTE_CONCURRENCY` | no | `2` | `/embed` requests forwarded to that server at once (1-16). 2 is the measured optimum for a single GPU; local backends always handle one at a time |
| `DEVICE` | no | `auto` | Torch backend only: `cuda`, `mps`, `cpu`, or `auto` (cuda, then mps, then cpu). An explicit device that is not available is an error, never a silent CPU fallback |
| `MODEL_NAME` | no | per backend | Hugging Face id. Default `mlx-community/Qwen3-Embedding-4B-4bit-DWQ` (mlx), `Qwen/Qwen3-Embedding-4B` (torch), `text-embedding-qwen3-embedding-4b` (openai: the model id sent to the server) |
| `EMBEDDING_DIM` | no | `1024` | Output dimension (first N components, renormalised); must match the backend's `vector(1024)` column |
| `MAX_TOKENS` | no | `8192` | Longer texts are truncated to this many tokens, not rejected |
| `QUERY_INSTRUCTION` | no | `Given a search query, retrieve relevant passages from a knowledge base that answer the query` | Task text placed in the query prefix; documents get none |
| `MAX_BATCH_SIZE` | no | `32` | Maximum texts per `/embed` request |
| `MAX_TEXT_LENGTH` | no | `32000` | Maximum characters per text (longer: HTTP 422) |
| `DTYPE` | no | per backend | `float16`, `bfloat16`, or `float32`. Default: float16 on mlx (faster on M1; embeddings differ by cosine >= 0.9998), bfloat16 on CUDA, float16 on MPS, float32 on CPU |
| `INFERENCE_BATCH_SIZE` | no | `8` | Maximum texts per forward pass |
| `INFERENCE_TOKEN_BUDGET` | no | `16384` (mlx), `8192` (torch) | Maximum padded tokens (batch size x longest text) per forward pass. On CUDA an out-of-memory batch is split in two automatically |
| `HOST` | no | `127.0.0.1` | Bind address. A non-loopback address (`0.0.0.0`, a LAN IP) makes the worker refuse to start unless `WORKER_TOKEN` is set |
| `PORT` | no | `8000` | Bind port |
| `WORKER_TOKEN` | no | none | If set, `POST /embed` requires the header `X-Worker-Token: <value>` (`/health` stays open); set the same value as `AI_WORKER_TOKEN` in the backend |

### Offloading to an OpenAI-compatible server (LM Studio, vLLM, Ollama, ...)

If the other computer already serves Qwen3-Embedding-4B through an OpenAI-style API (for example LM Studio with the model `text-embedding-qwen3-embedding-4b`), no software is needed there. The worker on your Mac then acts as a thin adapter: it still does the text cleaning, the query instruction and the Matryoshka truncation to 1024 dimensions (so the vector space is defined in one place), and sends only the model call to the server's `POST /v1/embeddings`. The backend stays unchanged (`AI_WORKER_URL` keeps pointing at the local worker).

```ini
# socud-ai-worker/.env
BACKEND=openai
REMOTE_URL=http://<pc-ip>:1234/v1        # base URL including /v1
MODEL_NAME=text-embedding-qwen3-embedding-4b   # model id exactly as the server lists it (GET /v1/models)
# REMOTE_API_KEY=...                      # only if the server requires a key
```

Then `pip install -r requirements.txt` (no model dependencies are used) and `python main.py`. In LM Studio the server must listen on the network ("Serve on Local Network"); an address of `127.0.0.1` is only reachable from the PC itself (from the Mac use the PC's LAN IP or an SSH tunnel, `ssh -L 1234:127.0.0.1:1234 user@pc`, and `REMOTE_URL=http://127.0.0.1:1234/v1`). The server speaks plain HTTP without a token by default, so keep it on a trusted LAN. If the PC is off when the worker starts, the worker still starts and `/embed` fails (the backend retries) until the PC is back. Check the result with `python scripts/smoke_test.py`: the server must pool the last token and append the end-of-text token like Qwen3-Embedding does, which the smoke test's retrieval checks would reveal if it does not.

**Recommended settings for an RTX 4070 + LM Studio** (measured with `scripts/stress_test.py`, below): worker `REMOTE_CONCURRENCY=2` (the default) and backend `EMBED_BATCH_SIZE=1` (default) with `EMBED_CONCURRENCY=2`. The GPU saturates at about 11 texts/s; one request at a time reaches only ~7.5-8 because the GPU idles between requests, two overlapping requests close that gap, and anything more (bigger batches, more parallel requests) only queues on the GPU and adds latency.

| Setup (end to end through the worker, ~1800-char chunks) | Indexing | Request latency p95 | Search-query latency while indexing, p95 |
| --- | --- | --- | --- |
| `REMOTE_CONCURRENCY=1` (requests serialised in the worker) | 8.1 texts/s | 0.26 s | 0.85 s |
| `REMOTE_CONCURRENCY=2`, batch 1, 2 parallel (recommended) | 11.1 texts/s | 0.19 s | 0.21 s |
| LM Studio directly, batch 32 x 4 parallel (oversubscribed) | 11.2 texts/s | 11.6 s | 11.2 s (would miss the 4 s search budget) |

Reproduce or re-tune (it loads the GPU, so run it when the PC is idle): `python scripts/stress_test.py --url http://127.0.0.1:8000` tests the worker, `--url http://<pc-ip>:1234/v1 --openai` tests the server directly. It sweeps batch size x parallel requests, recommends the lowest-latency cell within 3% of peak throughput, then measures query latency under that indexing load. Exit code 1 if any request failed.

Verified (2026-11-10) with LM Studio on a Windows/NVIDIA PC over the LAN, model `text-embedding-qwen3-embedding-4b`: `smoke_test.py` passes (1024 dimensions, unit norm, correct Russian/English and cross-language ranking; the Qwen3 README example scores 0.747/0.146/0.048/0.644 against the reference 0.753/0.115/0.032/0.626), at about 7.5 texts/s for single chunks and about 10 texts/s with batches of 8 or more. The M1 MLX worker manages roughly 0.4 texts/s, so the default `EMBED_BATCH_SIZE=1` is already fine here (one chunk takes ~0.13 s) and larger batches add little.

### Running the worker on another machine (GPU offload)

> **Status:** the PyTorch backend is covered by unit tests on a tiny random Qwen3 (padding/order invariance, out-of-memory splitting) and its tokenizer/checkpoint assumptions were checked against the real `Qwen/Qwen3-Embedding-4B` files, but it has **not yet been run with the real model or on CUDA hardware**. The steps below are untested on a real GPU machine; run `scripts/compare_workers.py` (below) first.

Embedding is the only heavy computation, and the backend already reaches the worker over HTTP, so the worker can run on any computer in the network, for example a PC with an RTX 4070 (12 GB; the bf16 model takes about 8 GB of VRAM). The backend only needs two variables changed.

1. **Generate a token** once, on the Mac: `openssl rand -hex 32`. The same value goes to both machines.

2. **On the GPU machine** (Linux or Windows, current NVIDIA driver, Python 3.12 or newer), copy the `socud-ai-worker` folder and run:

   ```bash
   cd socud-ai-worker
   python -m venv .venv
   source .venv/bin/activate                                  # Windows: .venv\Scripts\activate
   pip install torch --index-url https://download.pytorch.org/whl/cu130   # CUDA index matching your driver: pytorch.org/get-started/locally
   pip install -r requirements-cuda.txt
   ```

   Create `socud-ai-worker/.env` (same on Linux and Windows):

   ```ini
   BACKEND=torch
   DEVICE=cuda
   HOST=0.0.0.0
   WORKER_TOKEN=<the token from step 1>
   ```

   then `python main.py`. The first start downloads about 8 GB. `GET http://<gpu-ip>:8000/health` must report `"status":"ok"` and `"device":"cuda"`. Open port 8000 for the backend's IP only (Windows: an inbound rule in Windows Defender Firewall; Linux: `ufw allow from <backend-ip> to any port 8000`).

3. **On the machine running the backend** set `AI_WORKER_URL=http://<gpu-ip>:8000` and `AI_WORKER_TOKEN=<the token>` (in `socud-backend/.env`, or in the root `.env` for Docker Compose; the backend container's `edge` network allows outbound connections, but reaching a LAN address from the container has not been verified). The MLX worker on the Mac is then not needed.

4. **Verify** from the Mac: `python scripts/smoke_test.py --url http://<gpu-ip>:8000 --token <token>` checks dimension, norm and retrieval. To compare the GPU worker with the MLX worker (start it too, `python main.py`), run `python scripts/compare_workers.py --a http://127.0.0.1:8000 --b http://<gpu-ip>:8000 --token-b <token>`: it prints the per-text cosine between the two and whether both rank passages identically. Expect cosines around 0.98 to 0.999; values below 0.9 point to a preprocessing or pooling bug, not precision.

If the GPU machine is switched off, nothing is lost: publishing keeps working, embedding jobs are retried and the periodic reconcile (`EMBED_RECONCILE_INTERVAL_MS`) catches up, and search falls back to keyword results meanwhile.

Things to know:

- **Security.** The traffic is plain HTTP and the token is the only protection. Use a trusted LAN or VPN, restrict the port in the firewall as above, and put a TLS reverse proxy in front (then use an `https://` URL) if the network is not trusted. The worker refuses to listen on a non-loopback address without `WORKER_TOKEN`.
- **Throughput.** The backend default `EMBED_BATCH_SIZE=1` is tuned for the MLX worker (one chunk blocks it for ~2.5 s). A GPU gains from batching: try `EMBED_BATCH_SIZE=8` to `16` (the worker accepts up to 32 texts per call). Network latency counts against the search query timeout, so keep `EMBED_QUERY_TIMEOUT_MS` above the round trip.
- **Vectors from different backends.** Both backends run the same model, but the MLX checkpoint is 4-bit quantised and the CUDA one is bf16, so vectors of the same text are expected to be very close but not identical (check with `compare_workers.py`; this has not been measured on the real models). Mixing them in one index should be fine for search, but `SEARCH_MIN_SIMILARITY` (0.35) was calibrated on the 4-bit model; if you switch for good, re-embed the corpus so everything comes from one model. There is no force flag, so clear the vectors and let the backfill refill them. Semantic search returns nothing until the backfill has finished (keyword search keeps working), so do it when that is acceptable:

  ```sql
  UPDATE "DocumentChunk" SET "embedding" = NULL;
  UPDATE "Document" SET "embeddedVersion" = NULL;
  ```

  then run `npm run backfill:embeddings` in `socud-backend` (or restart the API: it reconciles about 10 s after start).
- **Out of memory.** Other applications on the GPU machine share the 12 GB. A batch that does not fit is split in two automatically; if `/embed` still fails with out-of-memory errors, lower `INFERENCE_TOKEN_BUDGET` (e.g. `4096`) or `INFERENCE_BATCH_SIZE`.

## Common scripts

| Service | Command | Purpose |
| --- | --- | --- |
| `socud-backend` | `npm run lint:ci` | ESLint without auto-fix |
| `socud-backend` | `npm run typecheck` | TypeScript check |
| `socud-backend` | `npm test` | Unit tests (no database needed) |
| `socud-backend` | `npm run test:e2e` | End-to-end tests (requires running PostgreSQL) |
| `socud-backend` | `npm run build` | Production build |
| `socud-backend` | `npm run openapi:export` | Rebuild and write `openapi.json` (no database or Redis needed) |
| `socud-backend` | `npm run db:seed` | Create the first admin (see "First admin") |
| `socud-frontend` | `npm run api:gen` | Regenerate `src/lib/api/schema.d.ts` from `../socud-backend/openapi.json` |
| `socud-frontend` | `npm run lint` | ESLint |
| `socud-frontend` | `npm run typecheck` | TypeScript check |
| `socud-frontend` | `npm test` | Unit tests (Vitest) |
| `socud-frontend` | `npm run build` | Production build |
| `socud-ai-worker` | `pip install -r requirements-dev.txt && ruff check . && pytest` | Lint and unit tests (no model, no MLX needed) |

GitHub Actions (`.github/workflows/ci.yml`) runs these checks for the backend, frontend, and AI worker (plus a build-only job for the Docker images) on every push and pull request to `main`. The worker job installs only `requirements-dev.txt` (no MLX, which is macOS-only) and runs `ruff` and `pytest`; tests that need MLX skip themselves, and the model is never loaded in CI.

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
