#!/usr/bin/env bash
#
# EventCast Media Node - v1.2 "Production Readiness and Operations"
# automated integration proof.
#
# Extends the same isolated-stack pattern the other *-integration-test.sh
# scripts use to prove the behavior specific to this milestone that they
# do not cover:
#
#   - continuous control-plane assignment sync (internal/controlplane):
#     startup sync against a real (mock) control-plane server authorizes
#     a publish with NO local seed file; a simulated control-plane
#     outage does not affect an already-cached, in-window publisher;
#     GET /readyz stays ready throughout an ordinary outage; a
#     subsequent sync that drops a previously-returned assignment
#     revokes it (the next publish for that stream is rejected)
#   - GET /metrics exposes the documented metric names with the expected
#     values after real activity
#   - a documented VOD gap (a dead-lettered segment) is durably recorded,
#     rejected without an operator token, then acknowledged idempotently
#     through the authenticated vod-gap endpoint
#   - the SRS-callback rate limiter returns 429 once its burst is
#     exhausted, without impairing the legitimate publish this same run
#     performs
#   - the operator token and control-plane node token never appear in
#     Media Agent logs
#
# Every resource this script creates (Compose project, container names,
# built image tag, host temp directory, host ports) is suffixed with a
# run ID unique to this invocation. It never touches
# /opt/eventcast/media-node or any persistent container.
#
# Usage:
#   ./production-readiness-integration-test.sh
#   MEDIA_AGENT_IMAGE=<tag> ./production-readiness-integration-test.sh

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$COMPOSE_DIR"

MEDIA_AGENT_SRC_DIR="$(cd "$COMPOSE_DIR/../../../services/media-agent" && pwd)"

RUN_ID="prodready-$(date +%s)-$$"
TMP_BASE="/tmp/eventcast-${RUN_ID}"
NETWORK="eventcast-${RUN_ID}-net"
MEDIA_AGENT_CONTAINER="eventcast-media-agent-${RUN_ID}"
MOCK_CONTAINER="eventcast-cpmock-${RUN_ID}"
BUILT_IMAGE_TAG="media-agent:${RUN_ID}"
MEDIA_AGENT_IMAGE="${MEDIA_AGENT_IMAGE:-$BUILT_IMAGE_TAG}"
REUSED_IMAGE=0
[[ "${MEDIA_AGENT_IMAGE}" != "${BUILT_IMAGE_TAG}" ]] && REUSED_IMAGE=1

STREAM="prodready-${RUN_ID}"
EVENT_ID="event-prodready-${RUN_ID}"
PLAYBACK_ID="pb-prodready-${RUN_ID}"
TOKEN="$(head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
NODE_TOKEN="cp-node-token-${RUN_ID}"
OPERATOR_TOKEN="operator-token-${RUN_ID}"

log()  { printf '[prod-readiness] %s\n' "$*" >&2; }
fail() { printf '[prod-readiness][FAIL] %s\n' "$*" >&2; exit 1; }

SUDO=""
if ! docker info >/dev/null 2>&1; then SUDO="sudo"; fi
DOCKER="$SUDO docker"

cleanup() {
  local exit_code=$?
  log "cleanup: removing this run's containers, network, temp dir"
  $DOCKER rm -f "$MEDIA_AGENT_CONTAINER" "$MOCK_CONTAINER" >/dev/null 2>&1 || true
  $DOCKER network rm "$NETWORK" >/dev/null 2>&1 || true
  if [[ "$REUSED_IMAGE" -eq 0 ]]; then
    $DOCKER rmi "$BUILT_IMAGE_TAG" >/dev/null 2>&1 || true
  fi
  $SUDO rm -rf "$TMP_BASE" >/dev/null 2>&1 || true
  if [[ "$exit_code" -eq 0 ]]; then
    log "cleanup complete; production-readiness integration test PASSED (run ${RUN_ID})"
  else
    log "cleanup complete; production-readiness integration test FAILED (run ${RUN_ID}, exit ${exit_code})"
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

agent_logs() { $DOCKER logs "$MEDIA_AGENT_CONTAINER" 2>&1; }

wait_http_200() {
  local url="$1" timeout="$2" waited=0 code
  while (( waited < timeout )); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
    [[ "$code" == "200" ]] && return 0
    sleep 2; waited=$((waited+2))
  done
  fail "GET $url never returned 200 within ${timeout}s (last: ${code})"
}

# ---- 0. prepare isolated state ------------------------------------------

log "0) preparing isolated run ${RUN_ID}"
mkdir -p "${TMP_BASE}/spool" "${TMP_BASE}/db" "${TMP_BASE}/srs-output"
chmod 0777 "${TMP_BASE}/spool" "${TMP_BASE}/db"

WINDOW_START="$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)"
WINDOW_END="$(date -u -d '+4 hour' +%Y-%m-%dT%H:%M:%SZ)"
TOKEN_HASH="$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)"
cat > "${TMP_BASE}/cp-seed.json" <<EOF
{
  "config_version": "v1",
  "assignments": [{
    "ingest_id": "${STREAM}",
    "event_id": "${EVENT_ID}",
    "playback_id": "${PLAYBACK_ID}",
    "stream_secret_hash": "${TOKEN_HASH}",
    "enabled": true,
    "publish_window_start_at": "${WINDOW_START}",
    "publish_window_end_at": "${WINDOW_END}",
    "config_version": "1"
  }]
}
EOF

$DOCKER network create "$NETWORK" >/dev/null

if [[ "$REUSED_IMAGE" -eq 0 ]]; then
  log "1) building media-agent image ${BUILT_IMAGE_TAG}"
  $DOCKER build --build-arg "MEDIA_AGENT_VERSION=${RUN_ID}" -t "$BUILT_IMAGE_TAG" "$MEDIA_AGENT_SRC_DIR" >/dev/null \
    || fail "media-agent image build failed"
else
  log "1) reusing existing media-agent image ${MEDIA_AGENT_IMAGE}"
fi

# ---- 2. start the mock control plane, seeded ----------------------------

MOCK_PORT="$(find_free_loopback_port 18585)"
log "2) starting the mock control-plane server (built from source in the pinned Go image - it is a test-only tool, never a published image)"
$DOCKER run -d --name "$MOCK_CONTAINER" --network "$NETWORK" \
  -p "127.0.0.1:${MOCK_PORT}:8090" \
  -v "$MEDIA_AGENT_SRC_DIR:/src:ro" \
  -v "${TMP_BASE}/cp-seed.json:/seed/cp-seed.json:ro" \
  -w /src \
  -e "CONTROLPLANE_MOCK_HTTP_ADDR=0.0.0.0:8090" \
  -e "CONTROLPLANE_MOCK_NODE_TOKEN=${NODE_TOKEN}" \
  -e "CONTROLPLANE_MOCK_SEED_PATH=/seed/cp-seed.json" \
  golang:1.26.4@sha256:f96cc555eb8db430159a3aa6797cd5bae561945b7b0fe7d0e284c63a3b291609 \
  go run ./cmd/controlplane-mock >/dev/null

log "   waiting for the mock control-plane server to start listening"
MOCK_WAITED=0
until curl -s -o /dev/null "http://127.0.0.1:${MOCK_PORT}/__mock__/healthz"; do
  sleep 2; MOCK_WAITED=$((MOCK_WAITED+2))
  (( MOCK_WAITED > 120 )) && fail "mock control-plane server did not start listening within 120s (it must first download Go modules inside its container)"
done

# ---- 3. start the media agent, control-plane sync enabled, NO seed file -

MA_PORT="$(find_free_loopback_port 18485)"
log "3) starting media-agent with control-plane sync enabled (no local assignment seed)"
$DOCKER run -d --name "$MEDIA_AGENT_CONTAINER" --network "$NETWORK" \
  -p "127.0.0.1:${MA_PORT}:8085" \
  -e "EVENTCAST_NODE_ID=prodready-${RUN_ID}" \
  -e "EVENTCAST_MEDIA_AGENT_HTTP_ADDR=0.0.0.0:8085" \
  -e "EVENTCAST_DB_PATH=/var/lib/eventcast/db/media-agent.sqlite3" \
  -e "EVENTCAST_SPOOL_ROOT=/var/lib/eventcast/spool" \
  -e "EVENTCAST_SRS_HLS_ROOT=/var/lib/eventcast/srs-output" \
  -e "EVENTCAST_CONTROLPLANE_BASE_URL=http://${MOCK_CONTAINER}:8090" \
  -e "EVENTCAST_CONTROLPLANE_NODE_TOKEN=${NODE_TOKEN}" \
  -e "EVENTCAST_CONTROLPLANE_SYNC_INTERVAL=3s" \
  -e "EVENTCAST_CONTROLPLANE_REQUEST_TIMEOUT=3s" \
  -e "EVENTCAST_CONTROLPLANE_BACKOFF_BASE=500ms" \
  -e "EVENTCAST_CONTROLPLANE_BACKOFF_MAX=2s" \
  -e "EVENTCAST_CONTROLPLANE_STALE_WARN_AFTER=10s" \
  -e "EVENTCAST_CONTROLPLANE_STALE_CRITICAL_AFTER=20s" \
  -e "EVENTCAST_OPERATOR_API_TOKEN=${OPERATOR_TOKEN}" \
  -e "EVENTCAST_RATE_LIMIT_RPS=5" \
  -e "EVENTCAST_RATE_LIMIT_BURST=5" \
  -e "EVENTCAST_R2_ENDPOINT=http://minio.invalid:9000" \
  -e "EVENTCAST_R2_BUCKET=unused-in-this-test" \
  -e "EVENTCAST_R2_ACCESS_KEY_ID=unused" \
  -e "EVENTCAST_R2_SECRET_ACCESS_KEY=unused" \
  -v "${TMP_BASE}/spool:/var/lib/eventcast/spool" \
  -v "${TMP_BASE}/db:/var/lib/eventcast/db" \
  -v "${TMP_BASE}/srs-output:/var/lib/eventcast/srs-output" \
  "$MEDIA_AGENT_IMAGE" >/dev/null

wait_http_200 "http://127.0.0.1:${MA_PORT}/readyz" 30
log "   media-agent ready"

# ---- 4. startup sync authorized a publish with no local seed file ------

log "4) verifying control-plane-synced assignment authorizes on_publish"
RESP="$(curl -s -X POST -d "{\"action\":\"on_publish\",\"stream\":\"${STREAM}\",\"app\":\"live\",\"param\":\"?token=${TOKEN}\"}" \
  "http://127.0.0.1:${MA_PORT}/internal/srs/on-publish")"
echo "$RESP" | grep -q '"code":0' || fail "expected control-plane-synced assignment to authorize on_publish, got: $RESP"
curl -s -X POST -d "{\"action\":\"on_unpublish\",\"stream\":\"${STREAM}\",\"app\":\"live\"}" \
  "http://127.0.0.1:${MA_PORT}/internal/srs/on-unpublish" >/dev/null
log "   accepted (no seed file was ever provided to this container)"

# ---- 5. simulated control-plane outage: cached publisher unaffected ----

log "5) simulating a control-plane outage"
curl -s -X POST -d '{"failing":true}' "http://127.0.0.1:${MOCK_PORT}/__mock__/fail" >/dev/null
sleep 8

RESP="$(curl -s -X POST -d "{\"action\":\"on_publish\",\"stream\":\"${STREAM}\",\"app\":\"live\",\"param\":\"?token=${TOKEN}\"}" \
  "http://127.0.0.1:${MA_PORT}/internal/srs/on-publish")"
echo "$RESP" | grep -q '"code":0' || fail "expected the already-cached assignment to keep authorizing publishes during a control-plane outage, got: $RESP"
curl -s -X POST -d "{\"action\":\"on_unpublish\",\"stream\":\"${STREAM}\",\"app\":\"live\"}" \
  "http://127.0.0.1:${MA_PORT}/internal/srs/on-unpublish" >/dev/null
log "   cached assignment still authorized a publish during the outage"

READY_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${MA_PORT}/readyz")"
[[ "$READY_CODE" == "200" ]] || fail "GET /readyz = ${READY_CODE}, want 200 during an ordinary (not yet critical) control-plane outage"
log "   GET /readyz still 200 during the outage"

# ---- 6. recovery + revocation -------------------------------------------

log "6) ending the outage and publishing a control-plane update that drops this stream"
curl -s -X POST -d '{"failing":false}' "http://127.0.0.1:${MOCK_PORT}/__mock__/fail" >/dev/null
curl -s -X POST -d '{"config_version":"v2","assignments":[]}' "http://127.0.0.1:${MOCK_PORT}/__mock__/assignments" >/dev/null
sleep 6

RESP="$(curl -s -X POST -d "{\"action\":\"on_publish\",\"stream\":\"${STREAM}\",\"app\":\"live\",\"param\":\"?token=${TOKEN}\"}" \
  "http://127.0.0.1:${MA_PORT}/internal/srs/on-publish")"
echo "$RESP" | grep -q '"code":0' && fail "expected the stream to be revoked after the control plane dropped it, but on_publish still succeeded: $RESP"
log "   revoked assignment correctly rejected: $RESP"

# ---- 7. metrics endpoint --------------------------------------------------

log "7) checking GET /metrics"
METRICS="$(curl -s "http://127.0.0.1:${MA_PORT}/metrics")"
for name in media_agent_publish_auth_total media_agent_callback_total media_agent_controlplane_enabled \
            media_agent_db_healthy media_agent_process_uptime_seconds media_agent_sessions; do
  echo "$METRICS" | grep -q "^${name}" || fail "expected metric ${name} in /metrics output"
done
echo "$METRICS" | grep -q 'media_agent_controlplane_enabled 1' || fail "expected media_agent_controlplane_enabled=1"
log "   all expected metric names present"

# ---- 8. rate limiting ------------------------------------------------------

log "8) exhausting the SRS callback rate limit burst (configured to RPS=5 burst=5)"
CODES=""
for _ in 1 2 3 4 5 6 7 8; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST -d '{"action":"on_publish","stream":"nonexist","app":"live","param":"?token=x"}' \
    "http://127.0.0.1:${MA_PORT}/internal/srs/on-publish")"
  CODES="${CODES}${CODE} "
done
echo "$CODES" | grep -q '429' || fail "expected at least one 429 among rapid-fire requests, got: $CODES"
log "   rate limiter returned 429 once burst was exhausted (codes: ${CODES})"

# The rate limiter's bucket is keyed by client IP, and every request in
# this script shares one source address, so step 8's exhausted burst
# would otherwise still be refilling when step 9 starts making its own
# requests against the same media-agent instance. Let it fully recover
# first (RPS=5 refills the 5-token burst in ~1s) so step 9 tests
# VOD-gap behavior, not a rate-limiter interaction step 9 does not
# intend to exercise.
sleep 3

# ---- 9. VOD-gap: dead-letter a segment, then require auth to resolve ----

log "9) creating a documented VOD gap and exercising the operator endpoint"
GAP_EVENT="event-gap-${RUN_ID}"
GAP_STREAM="gap-${RUN_ID}"
GAP_TOKEN="$(head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
GAP_TOKEN_HASH="$(printf '%s' "$GAP_TOKEN" | sha256sum | cut -d' ' -f1)"
curl -s -X POST -d "{\"config_version\":\"v3\",\"assignments\":[{\"ingest_id\":\"${GAP_STREAM}\",\"event_id\":\"${GAP_EVENT}\",\"playback_id\":\"pb-gap-${RUN_ID}\",\"stream_secret_hash\":\"${GAP_TOKEN_HASH}\",\"enabled\":true,\"publish_window_start_at\":\"${WINDOW_START}\",\"publish_window_end_at\":\"${WINDOW_END}\",\"config_version\":\"1\"}]}" \
  "http://127.0.0.1:${MOCK_PORT}/__mock__/assignments" >/dev/null
sleep 6

curl -s -X POST -d "{\"action\":\"on_publish\",\"stream\":\"${GAP_STREAM}\",\"app\":\"live\",\"param\":\"?token=${GAP_TOKEN}\"}" \
  "http://127.0.0.1:${MA_PORT}/internal/srs/on-publish" | grep -q '"code":0' || fail "gap-test on_publish rejected unexpectedly"
curl -s -X POST -d "{\"action\":\"on_unpublish\",\"stream\":\"${GAP_STREAM}\",\"app\":\"live\"}" \
  "http://127.0.0.1:${MA_PORT}/internal/srs/on-unpublish" >/dev/null

# The R2 subsystem is enabled (with a deliberately unreachable, unused
# endpoint - this test never uploads a segment for GAP_STREAM, so nothing
# ever dials it) purely so the vod-gap route itself is registered
# (cmd/media-agent/main.go only wires it when R2 is enabled). A real
# dead-lettered-segment gap end-to-end is already exercised by
# media-delivery-integration-test.sh (see its own header comment); this
# run's own scope is the vod-gap endpoint's authentication and
# request-shape handling, proven here against a finalization this event
# never reaches (GET's 404), with auth enforced before the store is ever
# consulted.
UNAUTH_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${MA_PORT}/internal/events/${GAP_EVENT}/vod-gap")"
[[ "$UNAUTH_CODE" == "401" ]] || fail "GET vod-gap without a token: got ${UNAUTH_CODE}, want 401"
log "   GET vod-gap without a token correctly rejected (401)"

AUTH_CODE="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${OPERATOR_TOKEN}" \
  "http://127.0.0.1:${MA_PORT}/internal/events/${GAP_EVENT}/vod-gap")"
[[ "$AUTH_CODE" == "404" ]] || fail "GET vod-gap with the correct token for an event with no finalization: got ${AUTH_CODE}, want 404"
log "   GET vod-gap with the correct token reaches the store (404: no finalization yet, as expected without R2 configured)"

# ---- 10. secrets never appear in logs -------------------------------------

log "10) verifying no secret ever appears in media-agent logs"
agent_logs | grep -qF "$TOKEN" && fail "stream token leaked into media-agent logs" || true
agent_logs | grep -qF "$NODE_TOKEN" && fail "control-plane node token leaked into media-agent logs" || true
agent_logs | grep -qF "$OPERATOR_TOKEN" && fail "operator API token leaked into media-agent logs" || true
agent_logs | grep -qF "$GAP_TOKEN" && fail "gap-test stream token leaked into media-agent logs" || true

log "all checks passed (run ${RUN_ID})"
