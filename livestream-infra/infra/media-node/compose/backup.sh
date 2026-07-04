#!/usr/bin/env bash
#
# EventCast Media Node - local durable-state backup.
#
# Backs up exactly what BACKUP_AND_RECOVERY.md documents as
# locally-authoritative and not recoverable from R2: the SQLite database
# (assignment cache, sessions, segment queue, manifest generations, VOD
# finalizations and their gap-resolution/audit state, YouTube relay
# records, control-plane sync state). None of this contains a raw secret
# - internal/store.Assignment.YouTubeStreamKey is deliberately never
# persisted to SQLite - so the database copy this script produces is
# always safe to retain.
#
# It deliberately does NOT back up the optional assignment seed JSON
# file (EVENTCAST_ASSIGNMENT_SEED_PATH): that file MAY legitimately
# contain a raw youtube_stream_key (the documented seed-file secret
# source - see services/media-agent/README.md "YouTube relay
# authorization"), so copying it would risk exactly the "do not copy or
# expose real secrets in backup artifacts" outcome this milestone
# forbids. That file's own durability is the operator's approved secret
# mechanism's responsibility, not this script's - and production is
# expected to move to continuous control-plane sync
# (EVENTCAST_CONTROLPLANE_BASE_URL) rather than a local secret-bearing
# seed file at all.
#
# It also does NOT back up the spool (media bytes already durably
# uploaded to R2 are recoverable there; unconfirmed in-flight segments
# are protected by the durable queue and startup reconciliation, not by
# this backup) - see BACKUP_AND_RECOVERY.md.
#
# The Media Agent is briefly stopped for a consistent SQLite file-level
# copy (its WAL/SHM files must be copied together with the main database
# file). This is a short, deliberate maintenance pause, not a crash:
# startup reconciliation recovers any HLS segments SRS continued writing
# to its own staging directory while the agent was stopped, exactly as it
# already does after any other agent restart
# (02_V1_ARCHITECTURE_SPEC.md "A reconciliation process MUST scan both
# staging and durable-spool paths at startup").
#
# Usage:
#   ./backup.sh <destination-dir>                 # dry run
#   ./backup.sh <destination-dir> --apply          # perform the backup
#
# See restore-test.sh for a fully isolated, non-production restore
# verification exercise proving a backup produced by this script is
# actually restorable.

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$COMPOSE_DIR"

[[ $# -ge 1 ]] || { echo "usage: $0 <destination-dir> [--apply]" >&2; exit 2; }
DEST_BASE="$1"; shift || true
APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

ENV_FILE="${ENV_FILE:-/opt/eventcast/media-node/app/compose/.env}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-eventcast-media-node}"
MEDIA_AGENT_CONTAINER="${MEDIA_AGENT_CONTAINER_NAME:-eventcast-media-agent}"

log()  { printf '[backup] %s\n' "$*" >&2; }
fail() { printf '[backup][FAIL] %s\n' "$*" >&2; exit 1; }

SUDO=""
if ! docker info >/dev/null 2>&1; then
  SUDO="sudo"
fi
DOCKER="$SUDO docker"

[[ -f "$ENV_FILE" ]] || fail "env file not found: $ENV_FILE"

DB_DIR="$(grep -E '^DB_HOST_DIR=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-)"
DB_DIR="${DB_DIR:-/opt/eventcast/media-node/data/db}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${DEST_BASE%/}/eventcast-backup-${TIMESTAMP}"

log "database directory: $DB_DIR"
log "backup destination: $DEST"

if [[ "$APPLY" -eq 0 ]]; then
  log "DRY RUN: would stop $MEDIA_AGENT_CONTAINER, copy $DB_DIR to $DEST, then restart it"
  exit 0
fi

$SUDO mkdir -p "$DEST/db"

COMPOSE="$DOCKER compose -p $COMPOSE_PROJECT --env-file $ENV_FILE -f $COMPOSE_DIR/docker-compose.yml"

WAS_RUNNING=0
if $DOCKER ps --format '{{.Names}}' | grep -qx "$MEDIA_AGENT_CONTAINER"; then
  WAS_RUNNING=1
  log "stopping $MEDIA_AGENT_CONTAINER for a consistent database copy"
  $COMPOSE stop media-agent
fi

log "copying database files"
$SUDO cp -a "$DB_DIR/." "$DEST/db/"

if [[ "$WAS_RUNNING" -eq 1 ]]; then
  log "restarting $MEDIA_AGENT_CONTAINER"
  $COMPOSE start media-agent
fi

log "backup complete: $DEST"
