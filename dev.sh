#!/usr/bin/env bash
# SOCUD local launcher: PostgreSQL and Redis (Docker), the AI worker, the backend and the frontend, run natively.
# Run it from anywhere; it always works from the repository root.
#
#   ./dev.sh start [options]                   start PostgreSQL + Redis, then the apps
#       --install             first: install what is missing (npm ci, prisma generate, worker venv) and
#                             create the .env files from their .env.example (existing files are never touched)
#       --clean               WIPE ALL DATA first: drop and re-create the schema, flush Redis, empty the logs
#                             (asks you to type yes; the same as ./dev.sh reset, then the apps start again)
#       -y, --yes             do not ask for the --clean confirmation (required when there is no terminal)
#       --migrate             apply database migrations (prisma migrate deploy)
#       --seed                add the demo data, unless it is already there (idempotent)
#       --reseed              replace the demo data with a fresh copy (seed:demo --reset)
#       --seed-args "<args>"  more seed:demo arguments, e.g. "--langs en --limit 12" (implies --seed).
#                             Split on whitespace: values with spaces are not supported. --reset,
#                             --if-missing and --embed are refused here (use --reseed; ./dev.sh seed --embed)
#       --admin               create or promote the admin from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
#                             (read from socud-backend/.env or the environment, not the root .env)
#       --db-only             only PostgreSQL and Redis; the data steps above still run
#       --no-worker           do not start the AI worker. It is skipped by itself unless the effective
#                             EMBEDDING_PROVIDER is worker AND AI_WORKER_URL is loopback (a worker on another
#                             machine, or a hosted API, needs no local worker; see "Embedding profile" below)
#       --no-frontend         do not start the frontend
#   ./dev.sh restart [start options]           stop the apps and start them again (databases stay up)
#   ./dev.sh stop [--keep-db]                  stop the apps and the databases (volumes are kept)
#   ./dev.sh status                            what is running, the embedding profile, and for a remote worker
#                                              whether its /health answers (2 s timeout, never fatal)
#   ./dev.sh logs [worker|backend|frontend]    follow the logs (default: all)
#   ./dev.sh reset [-y|--yes]                  wipe all data like start --clean; stops the dev.sh apps, starts nothing
#   ./dev.sh seed [--reseed] [seed args...]    demo data only (added if missing; --reseed replaces it);
#                                              ./dev.sh seed --help lists the seed:demo options
#   ./dev.sh migrate                           apply database migrations
#   ./dev.sh admin                             create or promote the admin user
#
# Embedding profile (how the embedding method is chosen; the backend resolves it the same way):
#   EMBEDDING_PROFILE=<name> selects the settings named <NAME>__<VAR> (upper case, "-" becomes "_"), e.g.
#   API__EMBEDDING_PROVIDER or PC__AI_WORKER_URL, in place of the plain <VAR>. The environment wins over
#   socud-backend/.env, for the profile name and for every variable, so a one-off override works:
#       EMBEDDING_PROFILE=local ./dev.sh start      (use ./dev.sh restart when the apps are already up)
#   Effective provider worker + loopback AI_WORKER_URL -> the local MLX worker is started;
#   provider worker + another host (a PC)               -> no local worker, `status` shows "remote worker at <origin>";
#   provider api                                        -> no worker ("not needed").
#   An unknown profile name (no <NAME>__ variables) stops start/restart with the list of profiles found.
#
# Examples:
#   ./dev.sh start --install                   first time on this machine (then fill in the secrets it lists)
#   ./dev.sh start                             every day: databases, worker, backend, frontend
#   ./dev.sh start --clean --seed -y           fresh database with the demo data, no prompt
#   ./dev.sh start --db-only --seed --admin    only the databases, with demo data and the admin user
#   ./dev.sh seed --langs en --limit 12        small English sample (only when no demo data exists yet)
#   ./dev.sh seed --reseed                     replace the demo data
#   ./dev.sh reset                             wipe everything (asks you to type yes)
#
# Safety: never runs `docker compose down`, never removes a volume (--clean drops the schema, the Docker
# volume stays). A wipe (reset, start --clean, restart --clean) refuses when: DATABASE_URL is not localhost
# (the environment wins over socud-backend/.env, as for Prisma; SOCUD_ALLOW_REMOTE_WIPE=1 overrides this for a
# disposable remote database only); NODE_ENV is production (any case); there is no terminal and no -y; or port
# 3000, 3002 or 8000 is held by a process dev.sh did not start. It stops only processes it started (PIDs in .run/).
# Prisma refuses `migrate reset` when it runs inside an AI coding agent: run reset / --clean from your own terminal.
# Native processes run in their own process group; logs are in .run/logs/.
# Compatible with the bash 3.2 that ships with macOS.

set -u
# BASH_SOURCE (not $0) so that dev.test.sh can source this file and call the functions (main runs only when executed).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 1

RUN_DIR="$ROOT/.run"
LOG_DIR="$RUN_DIR/logs"
SERVICES="worker backend frontend"

# Options of `start` (set by parse_start_args; safe defaults for the other commands).
WITH_WORKER=1 START_FRONTEND=1 DB_ONLY=0 DO_INSTALL=0 DO_CLEAN=0 DO_MIGRATE=0
DO_SEED=0 DO_RESEED=0 DO_ADMIN=0 SEED_ARGS="" SEED_ARGS_GIVEN=0 YES=0 CONFIRMED=0

# ---------------------------------------------------------------- helpers

say()  { printf '%s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

svc_dir() {
  case "$1" in
    worker) echo "$ROOT/socud-ai-worker" ;;
    backend) echo "$ROOT/socud-backend" ;;
    frontend) echo "$ROOT/socud-frontend" ;;
  esac
}
svc_port() {
  case "$1" in
    worker) echo 8000 ;;
    backend) echo 3000 ;;
    frontend) echo 3001 ;;
  esac
}
# Extra ports a service listens on (only checked, never killed by port).
svc_extra_ports() { [ "$1" = backend ] && echo 3002; return 0; }

port_listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
port_owner()     { lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1" (pid "$2")"}'; }

pidfile() { echo "$RUN_DIR/$1.pgid"; }

# A service is "alive" when its recorded process-group leader still exists and still leads its group.
svc_alive() {
  local f pid
  f="$(pidfile "$1")"
  [ -f "$f" ] || return 1
  pid="$(cat "$f" 2>/dev/null)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  [ "$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')" = "$pid" ]
}

# Pick Node 22 (the default node on this machine may be 18, where `npm ci` and the build fail).
use_node() {
  local dir
  dir="$(ls -d "$HOME"/.nvm/versions/node/v22.* 2>/dev/null | sort -V | tail -n 1)"
  if [ -n "$dir" ] && [ -x "$dir/bin/node" ]; then
    export PATH="$dir/bin:$PATH"
  fi
  command -v node >/dev/null 2>&1 || die "node not found. Install Node 22 (nvm install 22)."
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 20 ] || die "Node $major found, need >= 20.19 (use Node 22: nvm install 22)."
}

docker_up() { docker info >/dev/null 2>&1; }

ensure_docker() {
  docker_up && return 0
  command -v docker >/dev/null 2>&1 || die "docker not found. Install OrbStack or Docker Desktop."
  if [ "$(uname)" = Darwin ] && [ -d /Applications/OrbStack.app ]; then
    say "Docker is not running, starting OrbStack..."
    open -ga OrbStack
  else
    die "The Docker daemon is not running. Start it and retry."
  fi
  local i=0
  while ! docker_up; do
    i=$((i + 1))
    [ "$i" -le 45 ] || die "Docker did not come up within 90 s."
    sleep 2
  done
}

# Value of KEY from an env file: last assignment wins; an optional leading `export ` and whitespace,
# a trailing \r, trailing spaces and surrounding quotes are ignored. Empty when absent.
env_value() {
  [ -f "$2" ] || return 0
  grep -E "^[[:space:]]*(export[[:space:]]+)?$1=" "$2" | tail -n 1 | tr -d '\r' \
    | sed -E -e 's/^[[:space:]]*(export[[:space:]]+)?[^=]*=//' -e 's/[[:space:]]+$//' \
             -e 's/^"(.*)"$/\1/' -e "s/^'(.*)'\$/\1/"
}

# ---------------------------------------------------------------- embedding profile
# The same rules as socud-backend/src/config/embedding-profile.ts (keep them in step; dev.test.sh covers this side).
# Variables come from the environment first, then from socud-backend/.env, as for the backend itself.

# True when KEY is assigned in the env file (even to an empty value).
env_has() { # KEY FILE
  [ -f "$2" ] && grep -qE "^[[:space:]]*(export[[:space:]]+)?$1=" "$2"
}

# True when KEY is set in the environment (even empty) or assigned in socud-backend/.env.
# KEY must be a plain variable name; anything else counts as not set.
cfg_has() {
  [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || return 1
  [ -n "${!1+x}" ] || env_has "$1" "$ROOT/socud-backend/.env"
}

# Value of KEY: the environment if it is set, else socud-backend/.env, else empty.
cfg_get() {
  [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || return 0
  if [ -n "${!1+x}" ]; then
    printf '%s\n' "${!1}"
  else
    env_value "$1" "$ROOT/socud-backend/.env"
  fi
}

lower_trim() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]'; }
# Lower case with only the ends trimmed (a space inside a profile name is an error, not something to hide).
lower_ends() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E -e 's/^[[:space:]]+//' -e 's/[[:space:]]+$//'; }

# Active profile name, lower case; empty when none. A non-empty environment value wins over the file.
embedding_profile() {
  local v="${EMBEDDING_PROFILE:-}"
  [ -n "$(lower_trim "$v")" ] || v="$(env_value EMBEDDING_PROFILE "$ROOT/socud-backend/.env")"
  lower_ends "$v"
}

# `my-pc` -> MY_PC
profile_prefix() { printf '%s' "$1" | tr '[:lower:]-' '[:upper:]_'; }

# Profile names that have at least one <NAME>__<VAR> variable, comma separated.
embedding_profiles_found() {
  { env | cut -d= -f1; [ -f "$ROOT/socud-backend/.env" ] && sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z0-9_]+)=.*/\2/p' "$ROOT/socud-backend/.env"; } 2>/dev/null \
    | grep -E '^[A-Z0-9][A-Z0-9_]*__[A-Z0-9_]+$' | sed -E 's/__.*//' | sort -u \
    | tr '[:upper:]_' '[:lower:]-' | paste -sd, - | sed 's/,/, /g'
}

# Checks the active profile. Prints nothing and returns 0 when there is none or it is usable; otherwise
# prints the reason (same wording as the backend's) and returns 1.
embedding_profile_problem() {
  local p prefix found
  p="$(embedding_profile)"
  [ -n "$p" ] || return 0
  if ! [[ "$p" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
    echo "EMBEDDING_PROFILE=\"$p\" is not a valid profile name: use lower-case letters, digits, \"_\" and \"-\" (e.g. local, pc, api)."
    return 1
  fi
  prefix="$(profile_prefix "$p")__"
  if [ -n "$({ env | cut -d= -f1; sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z0-9_]+)=.*/\2/p' "$ROOT/socud-backend/.env" 2>/dev/null; } | grep -E "^${prefix}[A-Z0-9_]+\$" | head -n 1)" ]; then
    return 0
  fi
  found="$(embedding_profiles_found)"
  if [ -n "$found" ]; then found="profiles with variables: $found"; else found="no profile variables are set at all"; fi
  echo "EMBEDDING_PROFILE=\"$p\" has no ${prefix}* variables ($found). Define the profile in socud-backend/.env (${prefix}EMBEDDING_PROVIDER=...) or unset EMBEDDING_PROFILE."
  return 1
}

# Effective value of an embedding setting: the active profile's <NAME>__VAR when it is set (even empty),
# otherwise the plain VAR.
embedding_setting() { # VAR
  local p
  p="$(embedding_profile)"
  if [[ "$p" =~ ^[a-z0-9][a-z0-9_-]*$ ]] && cfg_has "$(profile_prefix "$p")__$1"; then
    cfg_get "$(profile_prefix "$p")__$1"
  else
    cfg_get "$1"
  fi
}

# Effective provider: worker (default) or api.
embedding_provider() {
  local v
  v="$(lower_trim "$(embedding_setting EMBEDDING_PROVIDER)")"
  echo "${v:-worker}"
}

effective_worker_url() {
  local v
  v="$(embedding_setting AI_WORKER_URL | tr -d '[:space:]')"
  echo "${v:-http://127.0.0.1:8000}"
}

# scheme://host:port of a URL (no path, no credentials).
url_origin() {
  local scheme rest hostport
  scheme="${1%%://*}"
  rest="${1#*://}"
  rest="${rest##*@}"
  hostport="${rest%%/*}"
  hostport="${hostport%%\?*}"
  echo "$scheme://$hostport"
}

is_loopback_host() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    localhost|*.localhost|::1|127.*) return 0 ;;
    *) return 1 ;;
  esac
}

# True when the effective AI_WORKER_URL points at this machine (loopback host).
worker_url_is_loopback() { is_loopback_host "$(db_host "$(effective_worker_url)")"; }

embedding_provider_is_api() { [ "$(embedding_provider)" = api ]; }

# True when the AI worker is wanted on this machine: provider worker and a loopback AI_WORKER_URL.
local_worker_wanted() { [ "$(embedding_provider)" = worker ] && worker_url_is_loopback; }

# Why no local worker is wanted ("" when one is): used in start and status.
worker_not_needed_reason() {
  local p tag=""
  p="$(embedding_profile)"
  [ -n "$p" ] && tag=" (profile $p)"
  if embedding_provider_is_api; then
    echo "not needed$tag: embeddings come from a hosted API"
  elif ! worker_url_is_loopback; then
    echo "remote worker at $(url_origin "$(effective_worker_url)")$tag"
  fi
}

# Short, non-fatal reachability probe of a worker's /health (never prints a secret).
remote_worker_reachable() { curl -fsS -o /dev/null --max-time 2 "$(url_origin "$(effective_worker_url)")/health" 2>/dev/null; }

wait_http() { # url seconds
  local i=0
  while ! curl -fsS -o /dev/null --max-time 2 "$1" 2>/dev/null; do
    i=$((i + 2))
    [ "$i" -le "$2" ] || return 1
    sleep 2
  done
}

# ---------------------------------------------------------------- database URL and wipe guards

# DATABASE_URL as Prisma and dotenv see it: the environment wins over socud-backend/.env (dotenv never
# overrides a variable that is already set). Empty when neither has it.
effective_database_url() {
  if [ -n "${DATABASE_URL:-}" ]; then
    printf '%s\n' "$DATABASE_URL"
  else
    env_value DATABASE_URL "$ROOT/socud-backend/.env"
  fi
}

db_source() {
  if [ -n "${DATABASE_URL:-}" ]; then echo "the environment"; else echo "socud-backend/.env"; fi
}

# host:port/dbname of the effective URL (credentials and query string dropped: the password is never shown).
db_target() {
  local url rest
  url="$(effective_database_url)"
  if [ -z "$url" ]; then
    echo "(no DATABASE_URL)"
    return 0
  fi
  rest="${url#*://}"   # drop the scheme
  rest="${rest##*@}"   # drop the credentials (everything up to the last @)
  rest="${rest%%\?*}"  # drop ?query
  echo "$rest"
}

# Host name of a database URL: no scheme, credentials, port or path; IPv6 brackets removed.
db_host() {
  local rest hostport
  rest="${1#*://}"
  rest="${rest##*@}"
  rest="${rest%%\?*}"
  hostport="${rest%%/*}"
  case "$hostport" in
    \[*)   hostport="${hostport#\[}"; echo "${hostport%%]*}" ;;
    *:*:*) echo "$hostport" ;;          # unbracketed IPv6 without a port
    *)     echo "${hostport%%:*}" ;;
  esac
}

is_production() {
  local v
  v="$(env_value NODE_ENV "$ROOT/socud-backend/.env" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  [ "$v" = production ] && return 0
  v="$(printf '%s' "${NODE_ENV:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  [ "$v" = production ]
}

# Refuses a wipe while a process dev.sh did not start holds a port the apps use: such a process keeps
# database connections open (DROP DATABASE would fail) or writes to the data being wiped.
check_foreign_listeners() {
  local name p
  for name in backend worker; do
    svc_alive "$name" && continue
    # Without a local worker (hosted API, or a worker on another machine) whatever holds port 8000 is none of our business.
    [ "$name" = worker ] && ! local_worker_wanted && continue
    for p in $(svc_port "$name") $(svc_extra_ports "$name"); do
      if port_listening "$p"; then
        die "port $p is held by $(port_owner "$p"), which dev.sh did not start. Stop it first, then retry."
      fi
    done
  done
  if ! svc_alive frontend && port_listening 3001; then
    warn "port 3001 (frontend) is held by $(port_owner 3001), not by dev.sh; it holds no database connections, so the wipe continues."
  fi
}

# Everything that must hold before a wipe is even offered. Runs before anything is started or stopped.
check_wipe_allowed() {
  local url host
  url="$(effective_database_url)"
  [ -n "$url" ] || die "refusing to wipe: no DATABASE_URL (set it in socud-backend/.env or the environment)."
  host="$(db_host "$url")"
  case "$host" in
    localhost|127.0.0.1|::1) ;;
    *)
      [ "${SOCUD_ALLOW_REMOTE_WIPE:-}" = 1 ] \
        || die "refusing to wipe: DATABASE_URL points at host \"$host\", not localhost. Set SOCUD_ALLOW_REMOTE_WIPE=1 only if that database is disposable."
      warn "wiping a non-local database (host \"$host\"): SOCUD_ALLOW_REMOTE_WIPE=1 is set."
      ;;
  esac
  if is_production; then
    die "refusing to wipe data: NODE_ENV is production (socud-backend/.env or the environment)."
  fi
  if [ "$YES" != 1 ] && [ ! -t 0 ]; then
    die "refusing to wipe data without a terminal to confirm on. Pass -y / --yes to confirm in advance."
  fi
  check_foreign_listeners
}

# Asks for the wipe; the target database is printed, the password never.
confirm_wipe() {
  say ""
  say "This DELETES ALL DATA:"
  say "  database   $(db_target)   (from $(db_source))"
  say "  also       Redis (FLUSHALL) and the logs in .run/logs"
  say "  kept       the Docker volume (the schema is dropped and re-created from the migrations)"
  if [ "$YES" = 1 ]; then
    say "  (-y given, not asking)"
    say ""
    CONFIRMED=1
    return 0
  fi
  local reply=""
  printf 'Type yes to continue: '
  read -r reply || reply=""
  [ "$reply" = yes ] || die "aborted, nothing was changed."
  CONFIRMED=1
}

# ---------------------------------------------------------------- setup

# Copies EXAMPLE to TARGET unless TARGET exists. Returns 0 when it created the file.
copy_example() { # example target
  [ -f "$2" ] && return 1
  cp "$1" "$2" || die "could not copy ${1#"$ROOT"/} to ${2#"$ROOT"/}"
  say "  created ${2#"$ROOT"/} from ${1#"$ROOT"/}"
  return 0
}

# Installs what is missing. Never overwrites an existing .env file; secrets are left for you to fill in.
do_install() {
  use_node
  local created=""
  say "Checking what is installed..."
  copy_example "$ROOT/.env.example" "$ROOT/.env" && created="$created root"
  copy_example "$ROOT/socud-backend/.env.example" "$ROOT/socud-backend/.env" && created="$created backend"
  copy_example "$ROOT/socud-frontend/.env.example" "$ROOT/socud-frontend/.env.local" && created="$created frontend"

  if [ ! -d "$ROOT/socud-backend/node_modules" ]; then
    say "Installing backend dependencies (npm ci, prisma generate)..."
    (cd "$ROOT/socud-backend" && npm ci && npx prisma generate) || die "backend install failed"
  fi
  if [ "$START_FRONTEND" = 1 ] && [ ! -d "$ROOT/socud-frontend/node_modules" ]; then
    say "Installing frontend dependencies (npm ci)..."
    (cd "$ROOT/socud-frontend" && npm ci) || die "frontend install failed"
  fi
  if [ "$WITH_WORKER" = 1 ] && [ ! -x "$ROOT/socud-ai-worker/.venv/bin/python" ]; then
    say "Creating the AI worker virtualenv (pip install -r requirements.txt)..."
    (cd "$ROOT/socud-ai-worker" && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt) \
      || die "AI worker install failed"
  fi

  case "$created" in
    *root*)
      say ""
      say "Still to fill in, root .env:"
      say "  POSTGRES_PASSWORD     the database password (openssl rand -hex 24)"
      ;;
  esac
  case "$created" in
    *backend*)
      say "Still to fill in, socud-backend/.env:"
      say "  JWT_SECRET            replace the placeholder (openssl rand -hex 32)"
      say "  DATABASE_URL          use the same password as POSTGRES_PASSWORD (the example has an old one)"
      ;;
  esac
  case "$created" in
    *frontend*) say "socud-frontend/.env.local was created; nothing in it needs a secret." ;;
  esac
  return 0
}

# $1 = db: PostgreSQL, Redis and the backend tooling are enough (migrate, seed, admin, reset).
# $1 = apps: also the frontend and the AI worker, when they are going to be started.
preflight() {
  local scope="$1" missing=""
  if [ ! -f "$ROOT/.env" ]; then
    missing="$missing
  - .env (root, for Docker):      cp .env.example .env   # then set POSTGRES_PASSWORD (the one your DB volume was created with)"
  elif [ -z "$(env_value POSTGRES_PASSWORD "$ROOT/.env")" ]; then
    missing="$missing
  - POSTGRES_PASSWORD in .env:    empty; set it (the one your existing DB volume was created with)"
  fi
  [ -f "$ROOT/socud-backend/.env" ] || missing="$missing
  - socud-backend/.env:           cp socud-backend/.env.example socud-backend/.env   # DATABASE_URL must match POSTGRES_* in the root .env"
  [ -d "$ROOT/socud-backend/node_modules" ] || missing="$missing
  - backend dependencies:         npm ci && npx prisma generate   (in socud-backend)"
  if [ "$scope" = apps ] && [ "$START_FRONTEND" = 1 ]; then
    [ -f "$ROOT/socud-frontend/.env.local" ] || missing="$missing
  - socud-frontend/.env.local:    cp socud-frontend/.env.example socud-frontend/.env.local"
    [ -d "$ROOT/socud-frontend/node_modules" ] || missing="$missing
  - frontend dependencies:        npm ci   (in socud-frontend)"
  fi
  if [ "$scope" = apps ] && [ "$WITH_WORKER" = 1 ] && [ ! -x "$ROOT/socud-ai-worker/.venv/bin/python" ]; then
    missing="$missing
  - AI worker virtualenv:         python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   (in socud-ai-worker)
                                  (or start with --no-worker)"
  fi
  if [ -n "$missing" ]; then
    printf 'Missing setup:%s\n\nRun ./dev.sh start --install to install what can be installed automatically,\nor see README.md "Quick start".\n' "$missing" >&2
    exit 1
  fi
}

# ---------------------------------------------------------------- data

# Starts (or confirms) PostgreSQL and Redis. Never removes containers or volumes.
ensure_db() {
  ensure_docker
  say "Starting PostgreSQL and Redis..."
  docker compose up -d --wait db redis || die "docker compose failed (is POSTGRES_PASSWORD in .env correct?)"
}

migrate_deploy() {
  say "Applying database migrations..."
  (cd "$ROOT/socud-backend" && npx prisma migrate deploy) || die "prisma migrate deploy failed"
}

# The apps started by dev.sh (their own process groups only).
stop_apps() {
  local name
  for name in frontend backend worker; do stop_service "$name"; done
}

# Drops and re-creates the schema (prisma migrate reset re-applies every migration), flushes Redis and
# empties the logs. Never `docker compose down`, never a volume: the Docker volume is kept.
# Prisma 7 has no --skip-seed, and its migrate reset runs no seed (only `prisma db seed` does), so the
# admin is created only by --admin / ./dev.sh admin.
wipe_data() {
  [ "$CONFIRMED" = 1 ] || die "internal error: wipe without confirmation"
  say "Stopping the apps started by dev.sh..."
  stop_apps
  say "Resetting the database (prisma migrate reset: schema dropped, migrations re-applied)..."
  if ! (cd "$ROOT/socud-backend" && npx prisma migrate reset --force); then
    die "prisma migrate reset failed (see Prisma's message above). The apps started by dev.sh were stopped. The database may be unchanged or half-reset: re-run ./dev.sh reset, or ./dev.sh migrate."
  fi
  say "Flushing Redis..."
  docker compose exec -T redis redis-cli FLUSHALL || die "could not flush Redis"
  say "Emptying the logs in .run/logs..."
  local f
  for f in "$LOG_DIR"/*.log; do
    [ -f "$f" ] && : >"$f"
  done
  return 0
}

# Demo data, idempotent by default (--if-missing). Extra seed:demo arguments come from SEED_ARGS and are
# word-split on purpose (no globbing).
seed_demo_step() { # if-missing | reset
  if [ "$1" = reset ]; then set -- --reset; else set -- --if-missing; fi
  set -f
  # shellcheck disable=SC2086
  set -- "$@" $SEED_ARGS
  set +f
  say "Seeding demo data..."
  run_seed "$@"
}

# Runs npm run seed:demo in socud-backend with the given arguments.
run_seed() {
  (cd "$ROOT/socud-backend" && npm run seed:demo -- "$@") || die "demo seed failed (see the messages above)"
}

# Names of the admin variables that are set neither in the environment nor in socud-backend/.env.
admin_missing() {
  local m=""
  [ -n "${SEED_ADMIN_EMAIL:-}" ] || [ -n "$(env_value SEED_ADMIN_EMAIL "$ROOT/socud-backend/.env")" ] \
    || m="$m SEED_ADMIN_EMAIL"
  [ -n "${SEED_ADMIN_PASSWORD:-}" ] || [ -n "$(env_value SEED_ADMIN_PASSWORD "$ROOT/socud-backend/.env")" ] \
    || m="$m SEED_ADMIN_PASSWORD"
  echo "${m# }"
}

run_admin() {
  say "Creating or promoting the admin user (db:seed)..."
  (cd "$ROOT/socud-backend" && npm run db:seed) || die "admin seed failed"
}

# ---------------------------------------------------------------- start

# --seed-args is split on whitespace. These options must not come through it: they contradict the flags
# (--reset/--if-missing), and --embed needs a running AI worker (or EMBEDDING_PROVIDER=api and the apps up), which start has not started yet.
check_seed_args() {
  local w
  set -f
  # shellcheck disable=SC2086
  for w in $SEED_ARGS; do
    case "$w" in
      --reset)      set +f; die "--reset is not allowed in --seed-args: use --reseed (replaces the demo data)" ;;
      --if-missing) set +f; die "--if-missing is not allowed in --seed-args: use --seed (it is the default)" ;;
      --embed|--embed=inline)
        set +f; die "--embed needs a running AI worker; start first, then ./dev.sh seed --embed" ;;
    esac
  done
  set +f
}

# Parses the start options into the globals above. Used by start and restart.
parse_start_args() {
  WITH_WORKER=1 START_FRONTEND=1 DB_ONLY=0 DO_INSTALL=0 DO_CLEAN=0 DO_MIGRATE=0
  DO_SEED=0 DO_RESEED=0 DO_ADMIN=0 SEED_ARGS="" SEED_ARGS_GIVEN=0 YES=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --no-worker)   WITH_WORKER=0 ;;
      --no-frontend) START_FRONTEND=0 ;;
      --db-only)     DB_ONLY=1 ;;
      --install)     DO_INSTALL=1 ;;
      --clean)       DO_CLEAN=1 ;;
      --migrate)     DO_MIGRATE=1 ;;
      --seed)        DO_SEED=1 ;;
      --reseed)      DO_RESEED=1 ;;
      --seed-args)
        [ $# -ge 2 ] || die '--seed-args needs a value, e.g. --seed-args "--langs en --limit 12"'
        SEED_ARGS="$2"
        SEED_ARGS_GIVEN=1
        shift
        ;;
      --seed-args=*) SEED_ARGS="${1#--seed-args=}"; SEED_ARGS_GIVEN=1 ;;
      --admin)       DO_ADMIN=1 ;;
      -y|--yes)      YES=1 ;;
      *) die "unknown option for start: $1 (see ./dev.sh --help)" ;;
    esac
    shift
  done
  if [ "$DO_SEED" = 1 ] && [ "$DO_RESEED" = 1 ]; then
    die "--seed and --reseed cannot be combined (--reseed already seeds, replacing the demo data)"
  fi
  if [ "$SEED_ARGS_GIVEN" = 1 ]; then
    check_seed_args
    if [ "$DO_SEED" = 0 ] && [ "$DO_RESEED" = 0 ]; then DO_SEED=1; fi
  fi
}

launch() { # NAME DIR CMD...  -> runs CMD in DIR in its own process group, logging to .run/logs/NAME.log
  local name="$1" dir="$2" pid
  shift 2
  set -m # job control: every background job leads its own process group (pgid == pid)
  ( cd "$dir" && exec nohup "$@" ) </dev/null >>"$LOG_DIR/$name.log" 2>&1 &
  pid=$!
  set +m
  echo "$pid" >"$(pidfile "$name")"
  sleep 1
  if ! svc_alive "$name"; then
    rm -f "$(pidfile "$name")"
    die "$name exited immediately, see $LOG_DIR/$name.log"
  fi
}

start_service() {
  local name="$1" port extra
  port="$(svc_port "$name")"
  if svc_alive "$name"; then
    say "  $name: already running (pgid $(cat "$(pidfile "$name")"))"
    return 0
  fi
  for extra in $port $(svc_extra_ports "$name"); do
    if port_listening "$extra"; then
      warn "$name: port $extra is already in use by $(port_owner "$extra"), not started by dev.sh. Skipping."
      return 0
    fi
  done
  : >>"$LOG_DIR/$name.log"
  case "$name" in
    worker)   launch worker   "$(svc_dir worker)"   .venv/bin/python main.py ;;
    backend)  launch backend  "$(svc_dir backend)"  npm run start:dev ;;
    frontend) launch frontend "$(svc_dir frontend)" npm run dev ;;
  esac
  say "  $name: started (pgid $(cat "$(pidfile "$name")"), log .run/logs/$name.log)"
}

cmd_start() {
  parse_start_args "$@"
  if [ "$DO_CLEAN" = 1 ]; then check_wipe_allowed; fi
  if [ "$DB_ONLY" = 1 ]; then
    WITH_WORKER=0
    START_FRONTEND=0
  fi
  local problem profile reason
  problem="$(embedding_profile_problem)" || die "$problem"
  profile="$(embedding_profile)"
  if [ -n "$profile" ]; then
    say "Embedding profile: $profile (provider $(embedding_provider))"
  fi
  if [ "$WITH_WORKER" = 1 ]; then
    reason="$(worker_not_needed_reason)"
    if [ -n "$reason" ]; then
      say "AI worker: $reason; not starting a local worker."
      WITH_WORKER=0
    fi
  fi

  if [ "$DO_INSTALL" = 1 ]; then do_install; fi
  if [ "$DB_ONLY" = 1 ]; then preflight db; else preflight apps; fi
  use_node
  mkdir -p "$LOG_DIR"

  if [ "$DO_CLEAN" = 1 ] && [ "$CONFIRMED" = 0 ]; then confirm_wipe; fi
  ensure_db
  if [ "$DO_CLEAN" = 1 ]; then
    wipe_data # includes the migrations
  elif [ "$DO_MIGRATE" = 1 ] || [ "$DO_SEED" = 1 ] || [ "$DO_RESEED" = 1 ] || [ "$DO_ADMIN" = 1 ]; then
    migrate_deploy
  fi

  if [ "$DO_RESEED" = 1 ]; then
    seed_demo_step reset
  elif [ "$DO_SEED" = 1 ]; then
    seed_demo_step if-missing
  fi

  if [ "$DO_ADMIN" = 1 ]; then
    local missing
    missing="$(admin_missing)"
    if [ -n "$missing" ]; then
      warn "admin skipped: $missing not set. db:seed reads socud-backend/.env (not the root .env) or the environment. Set them, then ./dev.sh admin."
    else
      run_admin
    fi
  fi

  if [ "$DB_ONLY" = 1 ]; then
    say ""
    say "PostgreSQL and Redis are up. No apps were started (./dev.sh start starts them)."
    return 0
  fi

  say "Starting apps..."
  if [ "$WITH_WORKER" = 1 ]; then start_service worker; fi
  start_service backend
  if [ "$START_FRONTEND" = 1 ]; then start_service frontend; fi

  say "Waiting for backend..."
  if wait_http "http://127.0.0.1:3000/health" 90; then
    say "  backend: ready"
  else
    warn "backend not healthy after 90 s, check ./dev.sh logs backend"
  fi
  if [ "$START_FRONTEND" = 1 ]; then
    say "Waiting for frontend..."
    if wait_http "http://127.0.0.1:3001" 90; then
      say "  frontend: ready"
    else
      warn "frontend not responding after 90 s, check ./dev.sh logs frontend"
    fi
  fi
  if [ "$WITH_WORKER" = 1 ]; then
    if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:8000/health" 2>/dev/null; then
      say "  worker: ready"
    else
      say "  worker: still loading the model (first run downloads ~2.3 GB); follow with ./dev.sh logs worker"
    fi
  fi
  say ""
  if [ "$START_FRONTEND" = 1 ]; then
    say "SOCUD is up: http://localhost:3001   (stop with ./dev.sh stop)"
  else
    say "Backend is up: http://localhost:3000   (stop with ./dev.sh stop)"
  fi
}

# ---------------------------------------------------------------- stop

stop_service() {
  local name="$1" pid i=0
  if ! svc_alive "$name"; then
    rm -f "$(pidfile "$name")"
    say "  $name: not running"
    return 0
  fi
  pid="$(cat "$(pidfile "$name")")"
  kill -TERM -- "-$pid" 2>/dev/null
  while kill -0 -- "-$pid" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -gt 20 ]; then
      warn "$name did not stop within 10 s, sending SIGKILL"
      kill -KILL -- "-$pid" 2>/dev/null
      break
    fi
    sleep 0.5
  done
  rm -f "$(pidfile "$name")"
  say "  $name: stopped"
}

cmd_stop() {
  local keep_db=0 a name p
  for a in "$@"; do
    case "$a" in
      --keep-db) keep_db=1 ;;
      *) die "unknown option for stop: $a" ;;
    esac
  done
  say "Stopping apps..."
  stop_apps

  if [ "$keep_db" = 1 ]; then
    say "Leaving PostgreSQL and Redis running (--keep-db)."
  elif docker_up; then
    say "Stopping PostgreSQL and Redis (data volumes are kept)..."
    docker compose stop db redis
  else
    say "Docker is not running, nothing to stop there."
  fi

  # Report (never kill) anything still holding our ports, e.g. a server started by hand.
  for name in $SERVICES; do
    for p in $(svc_port "$name") $(svc_extra_ports "$name"); do
      port_listening "$p" && warn "port $p is still in use by $(port_owner "$p"); not started by dev.sh, left alone."
    done
  done
  return 0
}

cmd_restart() {
  local problem
  parse_start_args "$@"
  # Refuse a bad EMBEDDING_PROFILE before the apps are stopped.
  problem="$(embedding_profile_problem)" || die "$problem"
  if [ "$DO_CLEAN" = 1 ]; then
    # Ask before the apps are stopped, so a refused wipe leaves them running.
    check_wipe_allowed
    confirm_wipe
  fi
  cmd_stop --keep-db
  cmd_start "$@"
}

# ---------------------------------------------------------------- reset / seed / migrate / admin

cmd_reset() {
  local a
  for a in "$@"; do
    case "$a" in
      -y|--yes) YES=1 ;;
      *) die "unknown option for reset: $a (only -y / --yes)" ;;
    esac
  done
  check_wipe_allowed
  preflight db
  use_node
  confirm_wipe
  ensure_db
  wipe_data
  say ""
  say "Wiped. The apps started by dev.sh were stopped; reset starts nothing."
  say "Run ./dev.sh start (or ./dev.sh start --clean to wipe and start) to bring the apps up."
}

cmd_seed() {
  local reseed=0 help=0 n i a
  for a in "$@"; do
    case "$a" in
      --help|-h) help=1 ;;
      --if-missing) die "--if-missing is already the default of ./dev.sh seed (use --reseed to replace the demo data)" ;;
    esac
  done
  # Take --reseed (and seed:demo's own --reset) out of the pass-through arguments.
  n=$#
  i=0
  while [ "$i" -lt "$n" ]; do
    a="$1"
    shift
    i=$((i + 1))
    case "$a" in
      --reseed|--reset) reseed=1 ;;
      *) set -- "$@" "$a" ;;
    esac
  done

  use_node
  if [ "$help" = 1 ]; then
    run_seed "$@"
    return 0
  fi
  preflight db
  ensure_db
  migrate_deploy
  if [ "$reseed" = 1 ]; then set -- --reset "$@"; else set -- --if-missing "$@"; fi
  run_seed "$@"
}

cmd_migrate() {
  [ $# -eq 0 ] || die "migrate takes no options"
  preflight db
  use_node
  ensure_db
  migrate_deploy
  say "Database migrations are up to date."
}

cmd_admin() {
  [ $# -eq 0 ] || die "admin takes no options"
  preflight db
  use_node
  local missing
  missing="$(admin_missing)"
  if [ -n "$missing" ]; then
    die "$missing not set. db:seed reads socud-backend/.env (not the root .env) or the environment: nothing to do."
  fi
  ensure_db
  migrate_deploy
  run_admin
}

# ---------------------------------------------------------------- status / logs

# Status line of the AI worker when no local one is wanted: "not needed" (api) or the remote worker + reachability.
status_worker_line() {
  local reason
  reason="$(worker_not_needed_reason)"
  case "$reason" in
    remote*)
      if remote_worker_reachable; then
        printf '%-9s %s, /health reachable\n' worker "$reason"
      else
        printf '%-9s %s, /health NOT reachable (not fatal)\n' worker "$reason"
      fi
      ;;
    *) printf '%-9s %s\n' worker "$reason" ;;
  esac
}

cmd_status() {
  local name port profile problem
  profile="$(embedding_profile)"
  if problem="$(embedding_profile_problem)"; then
    printf '%-9s profile %s, provider %s\n' embedding "${profile:-none}" "$(embedding_provider)"
  else
    printf '%-9s %s\n' embedding "INVALID: $problem"
  fi
  for name in $SERVICES; do
    port="$(svc_port "$name")"
    if svc_alive "$name"; then
      printf '%-9s running   (pgid %s, port %s)\n' "$name" "$(cat "$(pidfile "$name")")" "$port"
    elif [ "$name" = worker ] && [ -n "$(worker_not_needed_reason)" ]; then
      status_worker_line
    elif port_listening "$port"; then
      printf '%-9s external  (port %s used by %s, not started by dev.sh)\n' "$name" "$port" "$(port_owner "$port")"
    else
      printf '%-9s stopped\n' "$name"
    fi
  done
  if docker_up; then
    docker compose ps db redis --format 'table {{.Service}}\t{{.State}}\t{{.Health}}' 2>/dev/null || true
  else
    say "docker    not running"
  fi
}

cmd_logs() {
  local files="" name
  if [ $# -eq 0 ]; then
    for name in $SERVICES; do [ -f "$LOG_DIR/$name.log" ] && files="$files $LOG_DIR/$name.log"; done
  else
    for name in "$@"; do
      case "$name" in
        worker|backend|frontend) [ -f "$LOG_DIR/$name.log" ] && files="$files $LOG_DIR/$name.log" ;;
        *) die "unknown service: $name (worker|backend|frontend)" ;;
      esac
    done
  fi
  [ -n "$files" ] || die "no logs yet in $LOG_DIR"
  # shellcheck disable=SC2086
  exec tail -n 30 -F $files
}

# ---------------------------------------------------------------- main

# The usage text is the comment header at the top of this file (everything up to the first non-comment line).
usage() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; }

cmd="${1:-}"
[ $# -gt 0 ] && shift
# Sourcing the file (dev.test.sh) defines the functions only.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "$cmd" in
    start)   cmd_start "$@" ;;
    stop)    cmd_stop "$@" ;;
    restart) cmd_restart "$@" ;;
    status)  cmd_status ;;
    logs)    cmd_logs "$@" ;;
    reset)   cmd_reset "$@" ;;
    seed)    cmd_seed "$@" ;;
    migrate) cmd_migrate "$@" ;;
    admin)   cmd_admin "$@" ;;
    ""|-h|--help|help) usage ;;
    *) usage; exit 1 ;;
  esac
fi
