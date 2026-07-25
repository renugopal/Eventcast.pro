#!/usr/bin/env bash
#
# EventCast Media Node - production deployment script.
#
# Deploys (or updates) the persistent single-node Compose stack at the
# real deployment paths (defaults matching docker-compose.yml: images,
# /opt/eventcast/media-node/{data,config}, the real container names).
# This is deliberately the OPPOSITE of the isolated integration-test
# scripts in this directory: it is meant to run against the real
# deployment, so it defaults to a safe, read-only dry run and requires an
# explicit flag before it mutates anything
# (09_CLAUDE_CODE_EXECUTION_RULES.md; this milestone's requirement:
# "Prepare a deployment command or script that defaults to dry-run or
# explicit confirmation for production mutation").
#
# Usage:
#   ./deploy.sh                      # dry run: prints every check and
#                                     # action it would take, changes nothing
#   ./deploy.sh --apply              # perform the deployment
#   ./deploy.sh --apply --force      # also proceed even if an ingest
#                                     # session is currently active (only
#                                     # use this for an emergency fix; the
#                                     # normal procedure per
#                                     # 08_OPERATIONS_RUNBOOK.md
#                                     # "Deployment and rollback" is to
#                                     # deploy when the node has no
#                                     # assigned critical event)
#
# Environment:
#   MEDIA_AGENT_IMAGE (required in ENV_FILE; immutable registry digest only),
#   ENV_FILE, COMPOSE_PROJECT, HEALTH_TIMEOUT_SECS

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$COMPOSE_DIR"

# shellcheck source=lib/validate-image-reference.sh
source "$COMPOSE_DIR/lib/validate-image-reference.sh"

APPLY=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --force) FORCE=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

ENV_FILE="${ENV_FILE:-/opt/eventcast/media-node/app/compose/.env}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-eventcast-media-node}"
HEALTH_TIMEOUT_SECS="${HEALTH_TIMEOUT_SECS:-90}"
MEDIA_AGENT_CONTAINER="${MEDIA_AGENT_CONTAINER_NAME:-eventcast-media-agent}"
SRS_CONTAINER="${SRS_CONTAINER_NAME:-eventcast-srs}"

log()  { printf '[deploy] %s\n' "$*" >&2; }
fail() { printf '[deploy][FAIL] %s\n' "$*" >&2; exit 1; }
step() { printf '\n[deploy] === %s ===\n' "$*" >&2; }

SUDO=""
if ! docker info >/dev/null 2>&1; then
  SUDO="sudo"
fi
DOCKER="$SUDO docker"

if [[ "$APPLY" -eq 0 ]]; then
  log "DRY RUN (no changes will be made). Pass --apply to actually deploy."
fi

# ---- 1. environment validation -------------------------------------------

step "1) environment validation"
[[ -f "$ENV_FILE" ]] || fail "env file not found: $ENV_FILE (copy .env.example to it first)"
log "env file: $ENV_FILE"

# Required, non-defaulted variables (docker-compose.yml has no fallback
# for these; an empty EVENTCAST_NODE_ID would make config.Validate()
# reject startup instead of failing here with a clear pre-flight message).
for required in EVENTCAST_NODE_ID; do
  if ! grep -qE "^${required}=.+" "$ENV_FILE"; then
    fail "required variable ${required} is missing or empty in $ENV_FILE"
  fi
done

# The persistent deployment must name exactly one immutable registry digest.
# A tag (including :latest) is mutable; Compose itself deliberately has no
# Media Agent default. Isolated integration tests build/use local tags but do
# not invoke this production deployment script.
MEDIA_AGENT_IMAGE_LINE_COUNT="$(grep -c '^MEDIA_AGENT_IMAGE=' "$ENV_FILE" || true)"
[[ "$MEDIA_AGENT_IMAGE_LINE_COUNT" -eq 1 ]] || fail "ENV_FILE must contain exactly one MEDIA_AGENT_IMAGE entry"
MEDIA_AGENT_IMAGE_VALUE="$(sed -n 's/^MEDIA_AGENT_IMAGE=//p' "$ENV_FILE")"
if ! validate_immutable_media_agent_image_reference "$MEDIA_AGENT_IMAGE_VALUE"; then
  fail "MEDIA_AGENT_IMAGE must be an immutable registry digest reference"
fi
log "MEDIA_AGENT_IMAGE is immutable digest-pinned"

# ---- 2. preflight: directory ownership and disk space --------------------

step "2) preflight checks"
# The tracked Media Agent Dockerfile declares its distroless runtime user as
# 65532:65532. Its spool and SQLite mounts therefore use owner-only access;
# deploy.sh never creates or chmods persistent data directories.
MEDIA_AGENT_RUNTIME_UID=65532
MEDIA_AGENT_RUNTIME_GID=65532

env_path_or_default() {
  local variable="$1"
  local default_path="$2"
  local value

  value="$(grep -E "^${variable}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-)"
  printf '%s\n' "${value:-$default_path}"
}

require_media_agent_writable_directory() {
  local variable="$1"
  local default_path="$2"
  local path owner mode

  path="$(env_path_or_default "$variable" "$default_path")"
  [[ -d "$path" ]] || fail "${variable} must be pre-provisioned; deploy.sh never creates persistent writable directories"
  owner="$(stat -c '%u:%g' "$path")"
  mode="$(stat -c '%a' "$path")"
  [[ "$owner" == "${MEDIA_AGENT_RUNTIME_UID}:${MEDIA_AGENT_RUNTIME_GID}" ]] || fail "${variable} must be owned by ${MEDIA_AGENT_RUNTIME_UID}:${MEDIA_AGENT_RUNTIME_GID}"
  [[ "$mode" == "750" ]] || fail "${variable} must have mode 0750"
  log "ok: ${variable} has the verified Media Agent ownership contract"
}

require_media_agent_writable_directory "SPOOL_HOST_DIR" "/opt/eventcast/media-node/data/spool"
require_media_agent_writable_directory "DB_HOST_DIR" "/opt/eventcast/media-node/data/db"

# The exact pinned SRS image was separately inspected: its default runtime
# identity is root (0:0). The Media Agent is 65532:65532 and has this mount
# read-only. The provisional host contract permits SRS to write and gives the
# Media Agent group read/traverse access; deploy.sh only validates it.
#
# This directory-level gate does not prove the mode/ownership of HLS files SRS
# creates beneath it. Deployment remains blocked by the separate real-HLS
# readability gate documented in DEPLOYMENT.md and README.md.
SRS_RUNTIME_UID=0
MEDIA_AGENT_SHARED_GID=65532

require_srs_output_directory() {
  local path owner mode

  path="$(env_path_or_default "SRS_OUTPUT_HOST_DIR" "/opt/eventcast/media-node/data/srs")"
  [[ -d "$path" ]] || fail "SRS_OUTPUT_HOST_DIR must be pre-provisioned; deploy.sh never creates persistent writable directories"
  owner="$(stat -c '%u:%g' "$path")"
  mode="$(stat -c '%a' "$path")"
  [[ "$owner" == "${SRS_RUNTIME_UID}:${MEDIA_AGENT_SHARED_GID}" ]] || fail "SRS_OUTPUT_HOST_DIR must be owned by ${SRS_RUNTIME_UID}:${MEDIA_AGENT_SHARED_GID}"
  [[ "$mode" == "2750" ]] || fail "SRS_OUTPUT_HOST_DIR must have mode 2750"
  log "ok: SRS_OUTPUT_HOST_DIR has the provisional SRS/Media Agent ownership contract"
}

require_srs_output_directory

# Require at least 10% free space on the spool filesystem before
# deploying new work onto this node (matches the disk-pressure warning
# threshold's spirit - 02_V1_ARCHITECTURE_SPEC.md "Observability
# requirements" warns below 25% free; this is deploy-time-only, more
# permissive than the runtime alert, since an operator may be deploying
# specifically to relieve a disk-pressure incident).
SPOOL_DIR="$(grep -E '^SPOOL_HOST_DIR=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-)"
SPOOL_DIR="${SPOOL_DIR:-/opt/eventcast/media-node/data/spool}"
if [[ -d "$SPOOL_DIR" ]]; then
  AVAIL_PCT="$(df -P "$SPOOL_DIR" | awk 'NR==2 { printf "%d", 100 - $5 }' | tr -d '%')"
  log "spool filesystem free space: ${AVAIL_PCT}%"
  if [[ "${AVAIL_PCT:-100}" -lt 10 ]]; then
    fail "spool filesystem has less than 10% free space; resolve disk pressure before deploying (08_OPERATIONS_RUNBOOK.md 'Disk pressure')"
  fi
fi

# ---- 3. refuse to deploy over an active ingest session, unless --force ---

step "3) active-session safety check"
MA_HTTP_ADDR="$(grep -E '^MEDIA_AGENT_HTTP_HOST_BIND=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-)"
MA_HTTP_ADDR="${MA_HTTP_ADDR:-127.0.0.1:8085}"
if $DOCKER ps --format '{{.Names}}' | grep -qx "$MEDIA_AGENT_CONTAINER"; then
  ACTIVE="$(curl -s "http://${MA_HTTP_ADDR}/metrics" 2>/dev/null | awk -F'[{} ]+' '/^media_agent_sessions\{/ && /status="active"/ { sum += $NF } END { print sum+0 }')"
  log "currently active ingest sessions: ${ACTIVE:-0}"
  if [[ "${ACTIVE:-0}" -gt 0 && "$FORCE" -ne 1 ]]; then
    fail "refusing to deploy: ${ACTIVE} active ingest session(s) on this node (08_OPERATIONS_RUNBOOK.md: deploy only when the node has no assigned critical event). Re-run with --force to override."
  fi
else
  log "no existing media-agent container running; nothing active to protect"
fi

# ---- 4. render and validate compose config -------------------------------

step "4) docker compose config validation"
COMPOSE="$DOCKER compose -p $COMPOSE_PROJECT --env-file $ENV_FILE -f $COMPOSE_DIR/docker-compose.yml"
$COMPOSE config >/dev/null || fail "docker compose config failed to render"
log "compose config renders cleanly"

if [[ "$APPLY" -eq 0 ]]; then
  log "dry run complete; no changes made. Re-run with --apply to deploy."
  exit 0
fi

# ---- 5. deploy: pull/build, start in dependency order, health-gate -------

step "5) pulling/building images"
$COMPOSE pull --ignore-pull-failures srs || true
[[ -n "${MEDIA_AGENT_IMAGE:-}" ]] && log "using MEDIA_AGENT_IMAGE=${MEDIA_AGENT_IMAGE} (not built here; build it first if this is a new version)"

step "6) starting services (docker-compose.yml's own depends_on: condition: service_healthy already orders srs after media-agent)"
$COMPOSE up -d

step "7) health gate"
DEADLINE=$((SECONDS + HEALTH_TIMEOUT_SECS))
while (( SECONDS < DEADLINE )); do
  MA_STATUS="$($DOCKER inspect -f '{{.State.Health.Status}}' "$MEDIA_AGENT_CONTAINER" 2>/dev/null || echo unknown)"
  SRS_STATUS="$($DOCKER inspect -f '{{.State.Health.Status}}' "$SRS_CONTAINER" 2>/dev/null || echo unknown)"
  if [[ "$MA_STATUS" == "healthy" && "$SRS_STATUS" == "healthy" ]]; then
    log "both services healthy"
    break
  fi
  sleep 3
done
[[ "$MA_STATUS" == "healthy" && "$SRS_STATUS" == "healthy" ]] || fail "services did not become healthy within ${HEALTH_TIMEOUT_SECS}s (media-agent=$MA_STATUS srs=$SRS_STATUS); consider ./rollback.sh"

# ---- 8. post-deployment verification -------------------------------------

step "8) post-deployment verification"
READY_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://${MA_HTTP_ADDR}/readyz")"
[[ "$READY_CODE" == "200" ]] || fail "GET /readyz = ${READY_CODE}, want 200 after deployment"
log "GET /readyz = 200"
log "deployment complete"
