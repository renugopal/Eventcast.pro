#!/usr/bin/env bash
#
# EventCast Media Node - Phase 0 Task 4 automated smoke test.
#
# Repeatable, non-interactive validation of the SRS + Media Agent Compose
# stack (docker-compose.yml in this directory). Brings the stack up,
# verifies health and port exposure, drives a bounded synthetic RTMP
# publish through SRS, verifies all three SRS callbacks succeeded
# against the real Media Agent and that HLS output was produced,
# restarts the stack and confirms recovery, then always tears down and
# cleans only this run's temporary state via a trap.
#
# Must run on the GCP media-node validation VM only - it requires
# Docker, Docker Compose, and FFmpeg, none of which belong on the local
# Git/SSH control workstation. See README.md "Automated smoke test" for
# the exact invocation and expected output.
#
# Exit code is 0 only if every check below passed; any failure exits
# non-zero with a "[smoke-test][FAIL]" line identifying the failed
# check. No secret values exist in this Phase 0 flow (no publish
# tokens are used yet), and this script never echoes full command
# environments, so there is nothing secret to leak - but the same
# truncate-on-failure discipline applies to any future secret-bearing
# fields.

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$COMPOSE_DIR"

# ---- configuration ---------------------------------------------------

MEDIA_AGENT_CONTAINER="eventcast-media-agent"
SRS_CONTAINER="eventcast-srs"
MEDIA_AGENT_URL="http://127.0.0.1:8085"

# Host paths bind-mounted by docker-compose.yml. These are the fixed
# Phase 0 single-VM deployment paths (see README.md "Volumes"); if
# docker-compose.yml's bind sources ever change, update these too.
SRS_DATA_DIR="/opt/eventcast/media-node/data/srs"

HEALTH_TIMEOUT_SECS=60
HEALTH_POLL_INTERVAL_SECS=2
RESTART_HEALTH_TIMEOUT_SECS=60

STREAM_APP="live"
STREAM_NAME="smoketest-$(date +%s)"
RTMP_URL="rtmp://127.0.0.1:1935/${STREAM_APP}/${STREAM_NAME}"

# The synthetic publish is bounded twice over: -t caps the encoded
# output duration (the clean, expected stop), and the outer `timeout`
# is a hard backstop that force-kills ffmpeg if it does not exit on its
# own shortly after. A prior run placed -t *after* the output URL,
# where ffmpeg does not apply it as an output option and the publish
# ran indefinitely; here -t is placed immediately before the final
# "-f flv <url>" output group, which is the correct position for an
# output option.
PUBLISH_DURATION_SECS=15
PUBLISH_HARD_TIMEOUT_SECS=25
PUBLISH_KILL_AFTER_SECS=5

# ---- helpers -----------------------------------------------------------

log() { printf '[smoke-test] %s\n' "$*" >&2; }
fail() { printf '[smoke-test][FAIL] %s\n' "$*" >&2; exit 1; }

# SUDO is empty when the invoking user already has Docker socket access;
# otherwise it prefixes both Docker and the /opt/eventcast filesystem
# checks below, since on the GCP VM both require the same elevated
# access.
SUDO=""
if ! docker info >/dev/null 2>&1; then
  SUDO="sudo"
fi
DOCKER="$SUDO docker"
COMPOSE="$DOCKER compose"

# wait_for_healthy TIMEOUT_SECS - polls both containers' Docker
# healthcheck status until both report "healthy" or TIMEOUT_SECS
# elapses.
wait_for_healthy() {
  local timeout="$1" waited=0 ma_health="unknown" srs_health="unknown"
  while (( waited < timeout )); do
    ma_health="$($DOCKER inspect -f '{{.State.Health.Status}}' "$MEDIA_AGENT_CONTAINER" 2>/dev/null || echo "unknown")"
    srs_health="$($DOCKER inspect -f '{{.State.Health.Status}}' "$SRS_CONTAINER" 2>/dev/null || echo "unknown")"
    if [[ "$ma_health" == "healthy" && "$srs_health" == "healthy" ]]; then
      return 0
    fi
    sleep "$HEALTH_POLL_INTERVAL_SECS"
    waited=$(( waited + HEALTH_POLL_INTERVAL_SECS ))
  done
  log "timed out waiting for healthy: ${MEDIA_AGENT_CONTAINER}=${ma_health}, ${SRS_CONTAINER}=${srs_health}"
  return 1
}

# ---- cleanup (always runs) ---------------------------------------------

cleanup() {
  local exit_code=$?
  log "cleanup: tearing down compose stack (containers + network only)"
  $COMPOSE down --remove-orphans >/dev/null 2>&1 || true

  log "cleanup: removing this run's temporary stream output only"
  $SUDO rm -rf "${SRS_DATA_DIR:?}/${STREAM_APP}/${STREAM_NAME:?}" >/dev/null 2>&1 || true

  [[ -n "${FFMPEG_LOG:-}" ]] && rm -f "$FFMPEG_LOG" 2>/dev/null || true

  if [[ "$exit_code" -eq 0 ]]; then
    log "cleanup complete; smoke test PASSED"
  else
    log "cleanup complete; smoke test FAILED (exit ${exit_code})"
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# ---- 0. ensure a non-secret .env exists (first run on a fresh checkout) --

if [[ ! -f .env && -f .env.example ]]; then
  log "0) no .env found; copying .env.example (non-secret defaults) to .env"
  cp .env.example .env
fi

# ---- 1. validate docker compose config ----------------------------------

log "1) validating docker compose config"
$COMPOSE config >/dev/null || fail "docker compose config failed"

# ---- 2. start the stack --------------------------------------------------

log "2) starting compose stack"
$COMPOSE up -d || fail "docker compose up failed"

# ---- 3. wait (bounded) for both services healthy -------------------------

log "3) waiting up to ${HEALTH_TIMEOUT_SECS}s for both services to report healthy"
wait_for_healthy "$HEALTH_TIMEOUT_SECS" || fail "services did not become healthy within ${HEALTH_TIMEOUT_SECS}s"

# ---- 4. verify Media Agent health over 127.0.0.1 --------------------------

log "4) verifying GET ${MEDIA_AGENT_URL}/healthz"
# curl already writes "000" for %{http_code} when no response was
# received (e.g. connection refused), so no separate fallback is
# needed here - one would double up on top of curl's own "000".
http_code="$(curl -s -o /dev/null -w '%{http_code}' "${MEDIA_AGENT_URL}/healthz" || true)"
[[ "$http_code" == "200" ]] || fail "healthz returned HTTP ${http_code}, want 200"

# ---- 5. verify port exposure -----------------------------------------------

log "5) verifying port exposure (1935 public, 8085 loopback-only, 1985/9972 absent)"
listening="$(ss -ltn)"

echo "$listening" | grep -qE ':1935[[:space:]]' \
  || fail "port 1935 (RTMP ingest) is not listening"

echo "$listening" | grep -qE '0\.0\.0\.0:8085[[:space:]]|\[::\]:8085[[:space:]]' \
  && fail "media agent port 8085 is published on a non-loopback address (must be 127.0.0.1 only)"

echo "$listening" | grep -qE '127\.0\.0\.1:8085[[:space:]]' \
  || fail "media agent port 8085 is not listening on 127.0.0.1"

echo "$listening" | grep -qE ':1985[[:space:]]' \
  && fail "SRS HTTP API port 1985 must not be published to the host"

echo "$listening" | grep -qE ':9972[[:space:]]' \
  && fail "SRS exporter port 9972 must not be published to the host"

# ---- 6. synthetic bounded RTMP publish ------------------------------------

log "6) publishing synthetic RTMP stream for ${PUBLISH_DURATION_SECS}s (hard timeout ${PUBLISH_HARD_TIMEOUT_SECS}s)"
FFMPEG_LOG="$(mktemp -t smoke-test-ffmpeg.XXXXXX.log)"
ffmpeg_rc=0
timeout --kill-after="${PUBLISH_KILL_AFTER_SECS}s" "${PUBLISH_HARD_TIMEOUT_SECS}s" \
  ffmpeg -nostdin -nostats -loglevel warning \
    -re -f lavfi -i "testsrc=size=640x360:rate=30" \
    -f lavfi -i "sine=frequency=1000:sample_rate=48000" \
    -pix_fmt yuv420p \
    -c:v libx264 -profile:v main -g 60 -keyint_min 60 -sc_threshold 0 -b:v 1500k \
    -c:a aac -b:a 128k -ar 48000 \
    -t "${PUBLISH_DURATION_SECS}" \
    -f flv "${RTMP_URL}" >"${FFMPEG_LOG}" 2>&1 || ffmpeg_rc=$?

if [[ "$ffmpeg_rc" -eq 124 || "$ffmpeg_rc" -eq 137 ]]; then
  fail "ffmpeg publish exceeded the ${PUBLISH_HARD_TIMEOUT_SECS}s hard timeout and was force-killed"
elif [[ "$ffmpeg_rc" -ne 0 ]]; then
  log "ffmpeg exited with code ${ffmpeg_rc}; last output lines:"
  tail -n 20 "$FFMPEG_LOG" >&2
  fail "ffmpeg publish failed"
fi
rm -f "$FFMPEG_LOG"
FFMPEG_LOG=""

# Give on_unpublish a brief moment to land after ffmpeg exits.
sleep 2

# ---- 7. verify SRS callbacks succeeded -------------------------------------

log "7) verifying on-publish, on-hls, on-unpublish callbacks for stream ${STREAM_NAME}"
agent_logs="$($DOCKER logs "$MEDIA_AGENT_CONTAINER" 2>&1)"

for action in on_publish on_hls on_unpublish; do
  echo "$agent_logs" | grep -qE "\"callback\":\"${action}\".*\"stream\":\"${STREAM_NAME}\"" \
    || fail "no successful ${action} callback found in media-agent logs for stream ${STREAM_NAME}"
done

# ---- 8. verify HLS playlist and segments -----------------------------------

log "8) verifying HLS playlist and segments"
STREAM_OUTPUT_DIR="${SRS_DATA_DIR}/${STREAM_APP}/${STREAM_NAME}"
PLAYLIST_PATH="${STREAM_OUTPUT_DIR}/local.m3u8"

$SUDO test -f "$PLAYLIST_PATH" || fail "HLS playlist not found at ${PLAYLIST_PATH}"

segment_count="$($SUDO find "$STREAM_OUTPUT_DIR" -name '*.ts' -type f | wc -l)"
(( segment_count >= 1 )) || fail "no HLS segments found for stream ${STREAM_NAME}, want at least 1"
log "found ${segment_count} HLS segment(s)"

# ---- 9. restart and verify recovery ----------------------------------------

log "9) restarting compose stack"
$COMPOSE restart || fail "docker compose restart failed"

log "10) waiting up to ${RESTART_HEALTH_TIMEOUT_SECS}s for both services to recover healthy"
wait_for_healthy "$RESTART_HEALTH_TIMEOUT_SECS" || fail "services did not recover healthy within ${RESTART_HEALTH_TIMEOUT_SECS}s after restart"

log "all checks passed"
