#!/usr/bin/env bash
#
# EventCast Media Node - production rollback script.
#
# Restores the previous pinned media-agent image and/or SRS config while
# preserving spool and SQLite data untouched
# (08_OPERATIONS_RUNBOOK.md "Deployment and rollback": "Rollback restores
# the previous pinned images and configuration while preserving spool and
# SQLite data"). Like deploy.sh, this defaults to a dry run.
#
# Usage:
#   ./rollback.sh <previous-media-agent-image>            # dry run
#   ./rollback.sh <previous-media-agent-image> --apply     # perform it
#
# This script never deletes, moves, or truncates SPOOL_HOST_DIR,
# DB_HOST_DIR, or SRS_OUTPUT_HOST_DIR - it only ever changes which image
# docker-compose.yml's media-agent service runs.

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$COMPOSE_DIR"

[[ $# -ge 1 ]] || { echo "usage: $0 <previous-media-agent-image>[:tag[@digest]] [--apply]" >&2; exit 2; }
PREVIOUS_IMAGE="$1"; shift || true
APPLY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

ENV_FILE="${ENV_FILE:-/opt/eventcast/media-node/app/compose/.env}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-eventcast-media-node}"
HEALTH_TIMEOUT_SECS="${HEALTH_TIMEOUT_SECS:-90}"
MEDIA_AGENT_CONTAINER="${MEDIA_AGENT_CONTAINER_NAME:-eventcast-media-agent}"

log()  { printf '[rollback] %s\n' "$*" >&2; }
fail() { printf '[rollback][FAIL] %s\n' "$*" >&2; exit 1; }

SUDO=""
if ! docker info >/dev/null 2>&1; then
  SUDO="sudo"
fi
DOCKER="$SUDO docker"

[[ -f "$ENV_FILE" ]] || fail "env file not found: $ENV_FILE"

log "rolling back media-agent to image: $PREVIOUS_IMAGE"
if [[ "$APPLY" -eq 0 ]]; then
  log "DRY RUN: would set MEDIA_AGENT_IMAGE=$PREVIOUS_IMAGE and run 'docker compose up -d media-agent'"
  log "spool/db/srs-output host directories are never touched by this script"
  exit 0
fi

COMPOSE="$DOCKER compose -p $COMPOSE_PROJECT --env-file $ENV_FILE -f $COMPOSE_DIR/docker-compose.yml"

# MEDIA_AGENT_IMAGE overrides the .env file's value for this invocation
# only; the .env file itself is left as-is so an operator can inspect
# exactly what was running before rollback and what to restore forward to.
MEDIA_AGENT_IMAGE="$PREVIOUS_IMAGE" $COMPOSE up -d media-agent

DEADLINE=$((SECONDS + HEALTH_TIMEOUT_SECS))
while (( SECONDS < DEADLINE )); do
  STATUS="$($DOCKER inspect -f '{{.State.Health.Status}}' "$MEDIA_AGENT_CONTAINER" 2>/dev/null || echo unknown)"
  [[ "$STATUS" == "healthy" ]] && { log "media-agent healthy on rolled-back image"; exit 0; }
  sleep 3
done
fail "media-agent did not become healthy within ${HEALTH_TIMEOUT_SECS}s after rollback to $PREVIOUS_IMAGE"
