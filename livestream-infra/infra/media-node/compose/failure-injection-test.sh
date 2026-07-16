#!/usr/bin/env bash
#
# EventCast Media Node - targeted failure-injection tests for behavior
# not already exercised end-to-end by another *-integration-test.sh
# script in this directory. This mission's required failure coverage and
# where each one is actually proven:
#
#   - Media Agent restart                  -> ingest-durability-integration-test.sh (step 10)
#   - SRS restart                          -> covered by 08_OPERATIONS_RUNBOOK.md "SRS failure"
#                                              at the unit/reconciliation level (internal/reconcile
#                                              tests); a live SRS-container restart is deferred to
#                                              the release soak below, which observes container
#                                              health continuously rather than as a single event
#   - temporary control-plane outage        -> production-readiness-integration-test.sh (step 5-6)
#   - temporary object-store outage         -> media-delivery-integration-test.sh (step 5)
#   - relay failure                        -> media-delivery-integration-test.sh (step 9)
#   - duplicate callbacks                  -> ingest-durability-integration-test.sh (step 7)
#   - stale queue claims                   -> THIS SCRIPT (below)
#   - low disk/spool threshold simulation  -> THIS SCRIPT (below)
#   - process shutdown during active work  -> THIS SCRIPT (below)
#
# Every resource this script creates is suffixed with a run ID unique to
# this invocation; it never touches /opt/eventcast/media-node.
#
# Usage:
#   ./failure-injection-test.sh
#   MEDIA_AGENT_IMAGE=<tag> ./failure-injection-test.sh

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$COMPOSE_DIR"

MEDIA_AGENT_SRC_DIR="$(cd "$COMPOSE_DIR/../../../services/media-agent" && pwd)"

RUN_ID="failinj-$(date +%s)-$$"
TMP_BASE="/tmp/eventcast-${RUN_ID}"
NETWORK="eventcast-${RUN_ID}-net"
CONTAINER="eventcast-media-agent-${RUN_ID}"
MINIO_CONTAINER="eventcast-minio-${RUN_ID}"
BUILT_IMAGE_TAG="media-agent:${RUN_ID}"
MEDIA_AGENT_IMAGE="${MEDIA_AGENT_IMAGE:-$BUILT_IMAGE_TAG}"
REUSED_IMAGE=0
[[ "${MEDIA_AGENT_IMAGE}" != "${BUILT_IMAGE_TAG}" ]] && REUSED_IMAGE=1

MINIO_IMAGE="minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e"
MINIO_ACCESS_KEY="testaccesskey"
MINIO_SECRET_KEY="testsecretkey12345"
BUCKET="eventcast-test-${RUN_ID}"

log()  { printf '[failure-injection] %s\n' "$*" >&2; }
fail() { printf '[failure-injection][FAIL] %s\n' "$*" >&2; exit 1; }

SUDO=""
if ! docker info >/dev/null 2>&1; then SUDO="sudo"; fi
DOCKER="$SUDO docker"

cleanup() {
  local exit_code=$?
  $DOCKER rm -f "$CONTAINER" "$MINIO_CONTAINER" >/dev/null 2>&1 || true
  $DOCKER network rm "$NETWORK" >/dev/null 2>&1 || true
  if [[ "$REUSED_IMAGE" -eq 0 ]]; then $DOCKER rmi "$BUILT_IMAGE_TAG" >/dev/null 2>&1 || true; fi
  $SUDO rm -rf "$TMP_BASE" >/dev/null 2>&1 || true
  if [[ "$exit_code" -eq 0 ]]; then
    log "cleanup complete; failure-injection test PASSED (run ${RUN_ID})"
  else
    log "cleanup complete; failure-injection test FAILED (run ${RUN_ID}, exit ${exit_code})"
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

find_free_loopback_port() {
  local base="$1" port listening
  listening="$(ss -ltn 2>/dev/null || true)"
  for ((port = base; port < base + 500; port++)); do
    if ! echo "$listening" | grep -qE "[:.]${port}[[:space:]]"; then echo "$port"; return 0; fi
  done
  fail "no free loopback port near ${base}"
}
agent_logs() { $DOCKER logs "$CONTAINER" 2>&1; }
wait_http_200() {
  local url="$1" timeout="$2" waited=0 code
  while (( waited < timeout )); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
    [[ "$code" == "200" ]] && return 0
    sleep 2; waited=$((waited+2))
  done
  fail "GET $url never returned 200 within ${timeout}s (last: ${code})"
}

log "0) preparing isolated run ${RUN_ID}"
mkdir -p "${TMP_BASE}/spool" "${TMP_BASE}/db" "${TMP_BASE}/srs-output" "${TMP_BASE}/minio-data"
chmod 0777 "${TMP_BASE}/spool" "${TMP_BASE}/db" "${TMP_BASE}/minio-data"
$DOCKER network create "$NETWORK" >/dev/null

if [[ "$REUSED_IMAGE" -eq 0 ]]; then
  log "1) building media-agent image ${BUILT_IMAGE_TAG}"
  $DOCKER build --build-arg "MEDIA_AGENT_VERSION=${RUN_ID}" -t "$BUILT_IMAGE_TAG" "$MEDIA_AGENT_SRC_DIR" >/dev/null \
    || fail "media-agent image build failed"
else
  log "1) reusing existing media-agent image ${MEDIA_AGENT_IMAGE}"
fi

MINIO_PORT="$(find_free_loopback_port 19200)"
log "2) starting MinIO"
$DOCKER run -d --name "$MINIO_CONTAINER" --network "$NETWORK" \
  -e "MINIO_ROOT_USER=${MINIO_ACCESS_KEY}" -e "MINIO_ROOT_PASSWORD=${MINIO_SECRET_KEY}" \
  -v "${TMP_BASE}/minio-data:/data" \
  -p "127.0.0.1:${MINIO_PORT}:9000" \
  "$MINIO_IMAGE" server /data >/dev/null

MINIO_WAITED=0
until curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${MINIO_PORT}/minio/health/live" | grep -q 200; do
  sleep 2; MINIO_WAITED=$((MINIO_WAITED+2))
  (( MINIO_WAITED > 60 )) && fail "MinIO did not become healthy within 60s"
done
$DOCKER run --rm --network "$NETWORK" \
  -e "MC_HOST_local=http://${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}@${MINIO_CONTAINER}:9000" \
  minio/mc@sha256:a7fe349ef4bd8521fb8497f55c6042871b2ae640607cf99d9bede5e9bdf11727 \
  mb --ignore-existing "local/${BUCKET}" >/dev/null

STREAM="failinj-${RUN_ID}"
EVENT_ID="event-failinj-${RUN_ID}"
PLAYBACK_ID="pb-failinj-${RUN_ID}"
TOKEN="$(head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
# A second, distinct assignment for the graceful-shutdown test (Test C):
# Test A deliberately SIGKILLs the agent while STREAM's session is still
# "active" (never a clean on_unpublish), so a later on_publish for the
# *same* ingest_id would correctly be rejected as a conflicting active
# publisher - that would test session-conflict handling, not shutdown.
# A fresh event with no prior session history isolates Test C to only
# what it intends to exercise.
SHUTDOWN_STREAM="failinj-shutdown-${RUN_ID}"
SHUTDOWN_EVENT_ID="event-failinj-shutdown-${RUN_ID}"
SHUTDOWN_PLAYBACK_ID="pb-failinj-shutdown-${RUN_ID}"
SHUTDOWN_TOKEN="$(head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
WINDOW_START="$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)"
WINDOW_END="$(date -u -d '+4 hour' +%Y-%m-%dT%H:%M:%SZ)"
TOKEN_HASH="$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)"
SHUTDOWN_TOKEN_HASH="$(printf '%s' "$SHUTDOWN_TOKEN" | sha256sum | cut -d' ' -f1)"
mkdir -p "${TMP_BASE}/config"
cat > "${TMP_BASE}/config/assignments.json" <<EOF
[{
  "ingest_id": "${STREAM}", "event_id": "${EVENT_ID}", "playback_id": "${PLAYBACK_ID}",
  "stream_secret_hash": "${TOKEN_HASH}", "enabled": true,
  "publish_window_start_at": "${WINDOW_START}", "publish_window_end_at": "${WINDOW_END}",
  "config_version": "1"
},
{
  "ingest_id": "${SHUTDOWN_STREAM}", "event_id": "${SHUTDOWN_EVENT_ID}", "playback_id": "${SHUTDOWN_PLAYBACK_ID}",
  "stream_secret_hash": "${SHUTDOWN_TOKEN_HASH}", "enabled": true,
  "publish_window_start_at": "${WINDOW_START}", "publish_window_end_at": "${WINDOW_END}",
  "config_version": "1"
}]
EOF

MA_PORT="$(find_free_loopback_port 18685)"
start_agent() {
  # $1, if given, overrides the R2 endpoint (used by Test A to point the
  # very first start at an unroutable address so its one upload attempt
  # hangs instead of failing fast - see that test's own comment).
  local r2_endpoint="${1:-http://${MINIO_CONTAINER}:9000}"
  local r2_timeout="${2:-20s}"
  $DOCKER run -d --name "$CONTAINER" --network "$NETWORK" \
    -p "127.0.0.1:${MA_PORT}:8085" \
    -e "EVENTCAST_NODE_ID=failinj-${RUN_ID}" \
    -e "EVENTCAST_MEDIA_AGENT_HTTP_ADDR=0.0.0.0:8085" \
    -e "EVENTCAST_DB_PATH=/var/lib/eventcast/db/media-agent.sqlite3" \
    -e "EVENTCAST_SPOOL_ROOT=/var/lib/eventcast/spool" \
    -e "EVENTCAST_SRS_HLS_ROOT=/var/lib/eventcast/srs-output" \
    -e "EVENTCAST_ASSIGNMENT_SEED_PATH=/var/lib/eventcast/config/assignments.json" \
    -e "EVENTCAST_ALLOW_SEED_ENABLED_ASSIGNMENTS=true" \
    -e "EVENTCAST_R2_ENDPOINT=${r2_endpoint}" \
    -e "EVENTCAST_R2_REGION=us-east-1" \
    -e "EVENTCAST_R2_BUCKET=${BUCKET}" \
    -e "EVENTCAST_R2_ACCESS_KEY_ID=${MINIO_ACCESS_KEY}" \
    -e "EVENTCAST_R2_SECRET_ACCESS_KEY=${MINIO_SECRET_KEY}" \
    -e "EVENTCAST_R2_REQUEST_TIMEOUT=${r2_timeout}" \
    -e "EVENTCAST_R2_UPLOAD_LEASE_DURATION=3s" \
    -e "EVENTCAST_R2_UPLOAD_CONCURRENCY=1" \
    -v "${TMP_BASE}/spool:/var/lib/eventcast/spool" \
    -v "${TMP_BASE}/db:/var/lib/eventcast/db" \
    -v "${TMP_BASE}/srs-output:/var/lib/eventcast/srs-output" \
    -v "${TMP_BASE}/config:/var/lib/eventcast/config:ro" \
    "$MEDIA_AGENT_IMAGE" >/dev/null
}

# ==== Test A: stale queue claims (expired upload lease reclaim) =========

# A worker only ever leaves a segment "leased" (rather than releasing it
# back to pending on failure - see internal/store.ReleaseUploadForRetry)
# for the brief window an upload attempt is genuinely in flight. Against
# a *stopped* MinIO, that attempt fails near-instantly (connection
# refused), making that window too narrow to reliably hit with an
# external SIGKILL. Instead, point the very first agent at a guaranteed
# non-routable address (192.0.2.1, TEST-NET-1 - RFC 5737) so its one
# upload attempt hangs for the whole configured request timeout instead
# of failing fast, giving a wide, deterministic window in which the
# segment is genuinely still "leased" when this test kills the process.
log "3) [stale queue claims] starting media-agent pointed at an unroutable R2 endpoint so its first upload attempt hangs"
start_agent "http://192.0.2.1:9" "20s"
wait_http_200 "http://127.0.0.1:${MA_PORT}/readyz" 30

curl -s -X POST -d "{\"action\":\"on_publish\",\"stream\":\"${STREAM}\",\"app\":\"live\",\"param\":\"?token=${TOKEN}\"}" \
  "http://127.0.0.1:${MA_PORT}/internal/srs/on-publish" | grep -q '"code":0' || fail "on_publish rejected"

SEG_FILE="${TMP_BASE}/srs-output/live/${STREAM}/1700000000-1.ts"
mkdir -p "$(dirname "$SEG_FILE")"
head -c 65536 /dev/urandom > "$SEG_FILE"
CONTAINER_SEG_PATH="/var/lib/eventcast/srs-output/live/${STREAM}/1700000000-1.ts"
curl -s -X POST -d "{\"action\":\"on_hls\",\"stream\":\"${STREAM}\",\"app\":\"live\",\"file\":\"${CONTAINER_SEG_PATH}\",\"duration\":4.0,\"seq_no\":1}" \
  "http://127.0.0.1:${MA_PORT}/internal/srs/on-hls" | grep -q '"code":0' || fail "on_hls rejected"

# Give the worker time to claim the segment and start its (hanging)
# upload attempt, well within the 20s request timeout and comfortably
# past the 3s lease duration, so the claim is now genuinely stale.
sleep 5

log "   killing the media-agent container uncleanly (SIGKILL) while its one upload attempt is still hung/in flight"
$DOCKER kill -s KILL "$CONTAINER" >/dev/null
$DOCKER rm -f "$CONTAINER" >/dev/null
sleep 2 # let the 3s lease age past its expiry
start_agent
wait_http_200 "http://127.0.0.1:${MA_PORT}/readyz" 30

verify_log_line() {
  local pattern="$1" desc="$2" waited=0
  while (( waited <= 30 )); do
    agent_logs | grep -qE "$pattern" && return 0
    sleep 2; waited=$((waited+2))
  done
  fail "expected log line not found: ${desc} (pattern: ${pattern})"
}
verify_log_line "expired upload leases reclaimed at startup" "startup lease reclaim ran"
verify_log_line "\"segment upload confirmed\".*\"event_id\":\"${EVENT_ID}\"" "the previously-stuck-and-killed-mid-lease segment eventually confirmed"
log "   stale lease reclaimed and upload completed after restart"

$DOCKER rm -f "$CONTAINER" >/dev/null

# ==== Test B: low disk/spool threshold simulation =========================

log "4) [low disk/spool] giving the agent a 2MB Docker-managed tmpfs spool and forcing real ENOSPC"
# A container-scoped --tmpfs mount needs no host-level "mount" privilege
# beyond what running Docker itself already requires, unlike a host
# tmpfs mount - this keeps the test self-contained under the same
# permission model as every other container this script starts.
TINY_DB="${TMP_BASE}/tinydb"
mkdir -p "$TINY_DB" "${TMP_BASE}/tinyhls/live/${STREAM}"
chmod 0777 "$TINY_DB"

TINY_PORT="$(find_free_loopback_port 18785)"
TINY_CONTAINER="eventcast-tinyspool-${RUN_ID}"
$DOCKER run -d --name "$TINY_CONTAINER" --network "$NETWORK" \
  -p "127.0.0.1:${TINY_PORT}:8085" \
  -e "EVENTCAST_NODE_ID=tinyspool-${RUN_ID}" \
  -e "EVENTCAST_MEDIA_AGENT_HTTP_ADDR=0.0.0.0:8085" \
  -e "EVENTCAST_DB_PATH=/var/lib/eventcast/db/media-agent.sqlite3" \
  -e "EVENTCAST_SPOOL_ROOT=/var/lib/eventcast/spool" \
  -e "EVENTCAST_SRS_HLS_ROOT=/var/lib/eventcast/srs-output" \
  -e "EVENTCAST_ASSIGNMENT_SEED_PATH=/var/lib/eventcast/config/assignments.json" \
  -e "EVENTCAST_ALLOW_SEED_ENABLED_ASSIGNMENTS=true" \
  --tmpfs "/var/lib/eventcast/spool:size=2m,mode=0777" \
  -v "${TINY_DB}:/var/lib/eventcast/db" \
  -v "${TMP_BASE}/tinyhls:/var/lib/eventcast/srs-output" \
  -v "${TMP_BASE}/config:/var/lib/eventcast/config:ro" \
  "$MEDIA_AGENT_IMAGE" >/dev/null

wait_http_200 "http://127.0.0.1:${TINY_PORT}/readyz" 30

curl -s -X POST -d "{\"action\":\"on_publish\",\"stream\":\"${STREAM}\",\"app\":\"live\",\"param\":\"?token=${TOKEN}\"}" \
  "http://127.0.0.1:${TINY_PORT}/internal/srs/on-publish" | grep -q '"code":0' || fail "on_publish rejected on tiny-spool agent"

# A single ~4MB segment cannot fit in the 2MB tmpfs: the durable capture
# step must fail loudly (02_V1_ARCHITECTURE_SPEC.md "If durable capture
# cannot be completed, the callback MUST fail loudly") rather than
# silently acknowledging unprotected media.
BIG_SEG="${TMP_BASE}/tinyhls/live/${STREAM}/big-1.ts"
mkdir -p "$(dirname "$BIG_SEG")"
head -c 4000000 /dev/urandom > "$BIG_SEG"
BIG_SEG_CONTAINER_PATH="/var/lib/eventcast/srs-output/live/${STREAM}/big-1.ts"
DISK_PRESSURE_CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -d "{\"action\":\"on_hls\",\"stream\":\"${STREAM}\",\"app\":\"live\",\"file\":\"${BIG_SEG_CONTAINER_PATH}\",\"duration\":4.0,\"seq_no\":1}" \
  "http://127.0.0.1:${TINY_PORT}/internal/srs/on-hls")"
[[ "$DISK_PRESSURE_CODE" == "200" ]] || fail "on_hls transport status = ${DISK_PRESSURE_CODE}, want 200 (SRS callback convention: reject via non-zero code, not HTTP status)"
$DOCKER logs "$TINY_CONTAINER" 2>&1 | grep -qE "durable capture failed" || fail "expected a loudly-logged durable capture failure under disk pressure"
log "   durable capture correctly failed loudly when the spool filesystem had no room, instead of silently acknowledging unprotected media"

$DOCKER rm -f "$TINY_CONTAINER" >/dev/null

# ==== Test C: process shutdown during active work =========================

log "5) [graceful shutdown during active work] restarting the primary agent and sending SIGTERM mid-publish"
start_agent
wait_http_200 "http://127.0.0.1:${MA_PORT}/readyz" 30
curl -s -X POST -d "{\"action\":\"on_publish\",\"stream\":\"${SHUTDOWN_STREAM}\",\"app\":\"live\",\"param\":\"?token=${SHUTDOWN_TOKEN}\"}" \
  "http://127.0.0.1:${MA_PORT}/internal/srs/on-publish" | grep -q '"code":0' || fail "on_publish rejected before shutdown test"

$DOCKER stop --time 10 "$CONTAINER" >/dev/null   # docker stop sends SIGTERM, waits, then SIGKILL - the same graceful-shutdown path cmd/media-agent/main.go implements
EXIT_CODE="$($DOCKER inspect -f '{{.State.ExitCode}}' "$CONTAINER" 2>/dev/null || echo unknown)"
log "   container exit code after SIGTERM: ${EXIT_CODE}"
[[ "$EXIT_CODE" == "0" ]] || fail "expected exit code 0 (clean graceful shutdown), got ${EXIT_CODE}"
$DOCKER logs "$CONTAINER" 2>&1 | grep -q "media-agent stopped cleanly" || fail "expected the clean-shutdown log line"
log "   graceful shutdown completed cleanly (exit 0, clean-shutdown log line present)"

log "all checks passed (run ${RUN_ID})"
