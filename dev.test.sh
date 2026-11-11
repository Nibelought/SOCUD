#!/usr/bin/env bash
# Tests of the embedding-profile rules in dev.sh (no Docker, no network, nothing started).
# It sources dev.sh (which then only defines functions) and points ROOT at a temporary fixture directory.
#   bash dev.test.sh
# Compatible with the bash 3.2 that ships with macOS. The same rules for the backend live in
# socud-backend/src/config/embedding-profile.ts (tested by embedding-profile.spec.ts).

set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=dev.sh
. "$HERE/dev.sh"
cd "$HERE" || exit 1

FIX="$(mktemp -d "${TMPDIR:-/tmp}/socud-devtest.XXXXXX")"
trap 'rm -rf "$FIX"' EXIT
ROOT="$FIX"
mkdir -p "$FIX/socud-backend"
ENVFILE="$FIX/socud-backend/.env"

PASS=0 FAIL=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    printf 'FAIL: %s\n  expected: [%s]\n  actual:   [%s]\n' "$1" "$2" "$3"
  fi
}
contains() { # name needle haystack
  case "$3" in
    *"$2"*) PASS=$((PASS + 1)) ;;
    *) FAIL=$((FAIL + 1)); printf 'FAIL: %s\n  expected to contain: [%s]\n  actual: [%s]\n' "$1" "$2" "$3" ;;
  esac
}

# Forget every variable the rules look at, so the caller's environment cannot leak into a case.
clean_env() {
  local v
  for v in $(env | cut -d= -f1 | grep -E '^(EMBEDDING_|EMBED_|AI_WORKER_|SEARCH_MIN_|[A-Z0-9][A-Z0-9_]*__)'); do
    unset "$v"
  done
}

# The three-profile file of socud-backend/.env.example, all blocks present at once.
write_env() { # profile-line
  cat >"$ENVFILE" <<EOT
DATABASE_URL=postgresql://u:p@localhost:5432/db
$1
EMBEDDING_PROVIDER=worker
AI_WORKER_URL=http://127.0.0.1:8000
EMBED_BATCH_SIZE=4

LOCAL__EMBEDDING_PROVIDER=worker
LOCAL__AI_WORKER_URL=http://127.0.0.1:8000

PC__EMBEDDING_PROVIDER=worker
PC__AI_WORKER_URL=http://192.168.1.50:8000
PC__AI_WORKER_TOKEN=secret-token

API__EMBEDDING_PROVIDER=api
API__EMBEDDING_API_KEY=sk-secret
API__EMBEDDING_API_MODEL=qwen/qwen3-embedding-8b
EOT
}

# ---- no profile: today's behaviour
clean_env
rm -f "$ENVFILE"
check "no file: profile empty" "" "$(embedding_profile)"
check "no file: provider defaults to worker" "worker" "$(embedding_provider)"
check "no file: default worker url" "http://127.0.0.1:8000" "$(effective_worker_url)"
local_worker_wanted && check "no file: local worker wanted" 1 1 || check "no file: local worker wanted" 1 0
check "no file: no reason" "" "$(worker_not_needed_reason)"
check "no file: no problem" "" "$(embedding_profile_problem)"

write_env ""
check "plain api, no profile" "api" "$(clean_env; printf 'EMBEDDING_PROVIDER=API \n' >"$ENVFILE"; embedding_provider)"
check "plain api reason has no profile tag" "not needed: embeddings come from a hosted API" "$(clean_env; printf 'EMBEDDING_PROVIDER=api\n' >"$ENVFILE"; worker_not_needed_reason)"
check "plain remote url" "remote worker at http://10.0.0.5:9000" "$(clean_env; printf 'AI_WORKER_URL=http://10.0.0.5:9000/\n' >"$ENVFILE"; worker_not_needed_reason)"

# ---- profile from the file
for p in local pc api; do
  write_env "EMBEDDING_PROFILE=$p"
  clean_env
  check "file profile $p" "$p" "$(embedding_profile)"
  check "file profile $p: no problem" "" "$(embedding_profile_problem)"
done

write_env "EMBEDDING_PROFILE=local"
clean_env
check "local: provider" "worker" "$(embedding_provider)"
check "local: reason empty (a local worker is started)" "" "$(worker_not_needed_reason)"
local_worker_wanted && check "local: wanted" 1 1 || check "local: wanted" 1 0

write_env "EMBEDDING_PROFILE=pc"
clean_env
check "pc: worker url" "http://192.168.1.50:8000" "$(effective_worker_url)"
check "pc: reason" "remote worker at http://192.168.1.50:8000 (profile pc)" "$(worker_not_needed_reason)"
local_worker_wanted && check "pc: not wanted" 0 1 || check "pc: not wanted" 0 0
contains "pc: status line names the origin, not the token" "remote worker at http://192.168.1.50:8000 (profile pc)" "$(curl() { return 1; }; status_worker_line)"
contains "pc: unreachable is reported, not fatal" "/health NOT reachable (not fatal)" "$(curl() { return 1; }; status_worker_line)"
contains "pc: reachable" "/health reachable" "$(curl() { return 0; }; status_worker_line)"
case "$(curl() { return 1; }; status_worker_line)" in *secret-token*) check "pc: token not printed" ok leaked ;; *) check "pc: token not printed" ok ok ;; esac

write_env "EMBEDDING_PROFILE=api"
clean_env
check "api: provider" "api" "$(embedding_provider)"
check "api: reason" "not needed (profile api): embeddings come from a hosted API" "$(worker_not_needed_reason)"
local_worker_wanted && check "api: not wanted" 0 1 || check "api: not wanted" 0 0

# ---- the environment wins over the file (one-off override)
write_env "EMBEDDING_PROFILE=api"
check "env profile beats file profile" "local" "$(clean_env; EMBEDDING_PROFILE=local; export EMBEDDING_PROFILE; embedding_profile)"
check "env override: provider follows" "worker" "$(clean_env; EMBEDDING_PROFILE=local; export EMBEDDING_PROFILE; embedding_provider)"
check "env profile is normalised" "my-pc" "$(clean_env; EMBEDDING_PROFILE=" My-PC "; export EMBEDDING_PROFILE; embedding_profile)"
check "empty env profile falls back to the file" "api" "$(clean_env; EMBEDDING_PROFILE=; export EMBEDDING_PROFILE; embedding_profile)"
check "env profile var beats file profile var" "http://10.9.9.9:8000" "$(clean_env; write_env 'EMBEDDING_PROFILE=pc'; PC__AI_WORKER_URL=http://10.9.9.9:8000; export PC__AI_WORKER_URL; effective_worker_url)"

# ---- the profile var beats the plain var, also an empty plain one
write_env "EMBEDDING_PROFILE=pc"
check "profile url beats plain url" "http://192.168.1.50:8000" "$(clean_env; effective_worker_url)"
check "profile beats an empty plain env value" "api" "$(clean_env; write_env 'EMBEDDING_PROFILE=api'; EMBEDDING_PROVIDER=; export EMBEDDING_PROVIDER; embedding_provider)"
check "profile beats a plain env value" "api" "$(clean_env; write_env 'EMBEDDING_PROFILE=api'; EMBEDDING_PROVIDER=worker; export EMBEDDING_PROVIDER; embedding_provider)"
check "empty profile var blanks the plain value (-> default)" "worker" "$(clean_env; printf 'EMBEDDING_PROFILE=x\nEMBEDDING_PROVIDER=api\nX__EMBEDDING_PROVIDER=\n' >"$ENVFILE"; embedding_provider)"
check "a profile that does not mention a var falls back to the plain one" "api" "$(clean_env; printf 'EMBEDDING_PROFILE=x\nEMBEDDING_PROVIDER=api\nX__EMBED_BATCH_SIZE=1\n' >"$ENVFILE"; embedding_provider)"
check "inactive profile is ignored" "worker" "$(clean_env; write_env 'EMBEDDING_PROFILE=local'; embedding_provider)"

# ---- name normalisation: "my-pc" -> MY_PC__
printf 'EMBEDDING_PROFILE=my-pc\nMY_PC__AI_WORKER_URL=http://10.0.0.2:8000\n' >"$ENVFILE"
clean_env
check "dash in name" "http://10.0.0.2:8000" "$(effective_worker_url)"
check "dash in name: no problem" "" "$(embedding_profile_problem)"
check "profile_prefix" "MY_PC" "$(profile_prefix my-pc)"

# ---- problems
write_env "EMBEDDING_PROFILE=nas"
clean_env
msg="$(embedding_profile_problem)"; rc=$?
check "unknown profile: fails" 1 "$([ -n "$msg" ] && echo 1 || echo 0)"
contains "unknown profile: names the missing prefix" 'has no NAS__* variables' "$msg"
contains "unknown profile: lists the profiles found" 'profiles with variables: api, local, pc' "$msg"
case "$msg" in *sk-secret*|*secret-token*) check "problem leaks no secret" ok leaked ;; *) check "problem leaks no secret" ok ok ;; esac
printf 'EMBEDDING_PROFILE=nas\n' >"$ENVFILE"
contains "unknown profile, nothing defined" 'no profile variables are set at all' "$(embedding_profile_problem)"
printf 'EMBEDDING_PROFILE=my pc\n' >"$ENVFILE"
contains "invalid name" 'not a valid profile name' "$(embedding_profile_problem)"
printf 'EMBEDDING_PROFILE=$(touch %s/pwned)\n' "$FIX" >"$ENVFILE"
embedding_setting AI_WORKER_URL >/dev/null; embedding_profile_problem >/dev/null
check "a hostile name executes nothing" "no" "$([ -e "$FIX/pwned" ] && echo yes || echo no)"
# a profile defined only in the process environment counts
printf 'EMBEDDING_PROFILE=envonly\n' >"$ENVFILE"
check "profile defined only in the environment is found" "" "$(clean_env; ENVONLY__EMBEDDING_PROVIDER=api; export ENVONLY__EMBEDDING_PROVIDER; embedding_profile_problem)"
check "profile defined only in the environment is used" "api" "$(clean_env; ENVONLY__EMBEDDING_PROVIDER=api; export ENVONLY__EMBEDDING_PROVIDER; embedding_provider)"

# ---- file syntax: export, quotes, CRLF, spaces
printf 'export EMBEDDING_PROFILE="pc"\r\nPC__AI_WORKER_URL='"'"'http://192.168.1.50:8000'"'"'  \r\nPC__EMBEDDING_PROVIDER = worker\r\n' >"$ENVFILE"
clean_env
check "export/quotes/CRLF: profile" "pc" "$(embedding_profile)"
check "export/quotes/CRLF: url" "http://192.168.1.50:8000" "$(effective_worker_url)"

# ---- urls
check "origin drops path" "http://h:8000" "$(url_origin http://h:8000/embed?x=1)"
check "origin drops credentials" "http://192.168.1.50:8000" "$(url_origin http://user:pw@192.168.1.50:8000/x)"
check "origin without port" "https://pc.lan" "$(url_origin https://pc.lan/)"
for h in http://localhost:8000 http://LOCALHOST http://127.0.0.1:8000 http://127.0.1.1:8000 'http://[::1]:8000' http://a.localhost:1; do
  check "loopback: $h" yes "$(clean_env; printf 'AI_WORKER_URL=%s\n' "$h" >"$ENVFILE"; worker_url_is_loopback && echo yes || echo no)"
done
for h in http://192.168.1.50:8000 http://pc.lan:8000 http://host.docker.internal:8000 http://10.0.0.1 http://127example.com; do
  check "not loopback: $h" no "$(clean_env; printf 'AI_WORKER_URL=%s\n' "$h" >"$ENVFILE"; worker_url_is_loopback && echo yes || echo no)"
done

# ---- start / restart / status wiring (docker, curl and every side effect stubbed or never reached)
docker() { return 1; }
curl() { return 1; }
# The fixture has no root .env, so start stops in preflight, after the embedding decisions and before any side effect.
start_out() { clean_env; write_env "EMBEDDING_PROFILE=$1"; ( cmd_start 2>&1 ); }
contains "start local: profile line" "Embedding profile: local (provider worker)" "$(start_out local)"
case "$(start_out local)" in *"not starting a local worker"*) check "start local: worker is started" ok skipped ;; *) check "start local: worker is started" ok ok ;; esac
contains "start pc: remote worker, none started" "AI worker: remote worker at http://192.168.1.50:8000 (profile pc); not starting a local worker." "$(start_out pc)"
contains "start api: not needed" "AI worker: not needed (profile api): embeddings come from a hosted API; not starting a local worker." "$(start_out api)"
contains "start --no-worker keeps quiet about the worker" "Embedding profile: local" "$(clean_env; write_env 'EMBEDDING_PROFILE=local'; ( cmd_start --no-worker 2>&1 ))"
out="$(clean_env; write_env 'EMBEDDING_PROFILE=nas'; ( cmd_start 2>&1 ))"
contains "start with an unknown profile dies with the list" "ERROR: EMBEDDING_PROFILE=\"nas\" has no NAS__* variables (profiles with variables: api, local, pc)" "$out"
case "$out" in *"Missing setup"*) check "unknown profile stops before preflight" ok later ;; *) check "unknown profile stops before preflight" ok ok ;; esac
out="$(clean_env; write_env 'EMBEDDING_PROFILE=nas'; ( cmd_restart 2>&1 ))"
contains "restart with an unknown profile dies" "has no NAS__* variables" "$out"
case "$out" in *"Stopping apps"*) check "restart refuses before stopping the apps" ok stopped ;; *) check "restart refuses before stopping the apps" ok ok ;; esac
st() { clean_env; write_env "EMBEDDING_PROFILE=$1"; cmd_status 2>&1; }
contains "status pc: embedding line" "embedding profile pc, provider worker" "$(st pc)"
contains "status pc: worker line" "worker    remote worker at http://192.168.1.50:8000 (profile pc), /health NOT reachable (not fatal)" "$(st pc)"
contains "status api: worker line" "worker    not needed (profile api): embeddings come from a hosted API" "$(st api)"
contains "status local: embedding line" "embedding profile local, provider worker" "$(st local)"
out="$(clean_env; write_env 'EMBEDDING_PROFILE=nas'; cmd_status 2>&1)"
contains "status with a bad profile reports it and still works" "embedding INVALID: EMBEDDING_PROFILE=\"nas\" has no NAS__* variables" "$out"
contains "status with a bad profile still lists the services" "backend" "$out"
out="$(clean_env; rm -f "$ENVFILE"; cmd_status 2>&1)"
contains "status without profile" "embedding profile none, provider worker" "$out"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" = 0 ]
