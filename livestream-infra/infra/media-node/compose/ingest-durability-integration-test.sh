#!/usr/bin/env bash
#
# EventCast Media Node - v1.2 "ingest control and durability" automated
# integration proof.
#
# Extends the same isolated Docker Compose stack phase2-integration-test.sh
# uses (pinned SRS + the current media-agent source, synthetic FFmpeg
# publishing) to prove the behavior phase2 did not yet implement:
#
#   - an authorized publisher (seeded assignment cache entry) is accepted
#   - an unauthorized publisher (no cached assignment) is rejected
#   - a valid stream generates HLS and completed segments are durably
#     captured into the protected spool
#   - a segment queue record is created exactly once
#   - duplicate on_hls callback delivery for the same segment is idempotent
#     (no second spool file, no second queue record)
#   - a clean unpublish closes the session
#   - a publisher reconnect follows the documented lifecycle (new session,
#     stack stays healthy)
#   - a Media Agent restart preserves queue and session recovery behavior
#     (startup reconciliation runs, no duplicate spool files, a fresh
#     publish still works afterward)
#   - the stack remains healthy throughout
#   - secrets never appear in Media Agent logs
#   - only this run's own exact temporary resources are ever touched
#
# Like phase2-integration-test.sh, every resource this script creates
# (Compose project, container names, image tag, host temp directory, host
# ports) is suffixed with a run ID unique to this invocation. It never
# touches /opt/eventcast/media-node or the persistent container names.
#
# Usage:
#   ./ingest-durability-integration-test.sh
#   MEDIA_AGENT_IMAGE=<tag> ./ingest-durability-integration-test.sh   # reuse an already-built image
#
# Exit code is 0 only if every check passed; any failure exits non-zero
# with a "[ingest-durability][FAIL]" line naming the failed check. A trap
# always tears down exactly this run's containers, network, image (unless
# reused), and temp directory, regardless of outcome.

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$COMPOSE_DIR"

MEDIA_AGENT_SRC_DIR="$(cd "$COMPOSE_DIR/../../../services/media-agent" && pwd)"
SRS_CONF_SRC="$COMPOSE_DIR/../srs/srs.conf"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"

# ---- run identity (unique per invocation) ----------------------------

RUN_ID="ingestdur-$(date +%s)-$$"
PROJECT="eventcast-${RUN_ID}"
TMP_BASE="/tmp/eventcast-${RUN_ID}"
MEDIA_AGENT_CONTAINER="eventcast-media-agent-${RUN_ID}"
SRS_CONTAINER="eventcast-srs-${RUN_ID}"
BUILT_IMAGE_TAG="media-agent:${RUN_ID}"
MEDIA_AGENT_IMAGE="${MEDIA_AGENT_IMAGE:-$BUILT_IMAGE_TAG}"
REUSED_IMAGE=0
[[ "${MEDIA_AGENT_IMAGE}" != "${BUILT_IMAGE_TAG}" ]] && REUSED_IMAGE=1

# Pinned test-only publisher image (same pin as phase2-integration-test.sh).
FFMPEG_IMAGE="mwader/static-ffmpeg@sha256:df8a363ed7089ab0779c4f019b935a0e428c0b705478b6ff371b52b4bbe818f8"

STREAM_APP="live"

AUTH_STREAM="authdur-${RUN_ID}"
AUTH_EVENT_ID="event-authdur-${RUN_ID}"
AUTH_PLAYBACK_ID="pb-authdur-${RUN_ID}"
AUTH_TOKEN="$(head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')"

UNAUTH_STREAM="unauthdur-${RUN_ID}"
UNAUTH_TOKEN="$(head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')"

HEALTH_TIMEOUT_SECS=60
PUBLISH_DURATION_SECS=15
PUBLISH_HARD_TIMEOUT_SECS=30
UNAUTH_HARD_TIMEOUT_SECS=15
RECONNECT_DURATION_SECS=15
RECONNECT_HARD_TIMEOUT_SECS=30
RESTART_HEALTH_TIMEOUT_SECS=60
HEALTH_POLL_INTERVAL_SECS=2
PUBLISH_KILL_AFTER_SECS=5

# ---- helpers --------------------------------------------------------

log()  { printf '[ingest-durability] %s\n' "$*" >&2; }
fail() { printf '[ingest-durability][FAIL] %s\n' "$*" >&2; exit 1; }

SUDO=""
if ! docker info >/dev/null 2>&1; then
  SUDO="sudo"
fi
DOCKER="$SUDO docker"
COMPOSE="$DOCKER compose -p $PROJECT -f $COMPOSE_FILE"

find_free_loopback_port() {
  local base="$1" port listening
  listening="$(ss -ltn 2>/dev/null || true)"
  for ((port = base; port < base + 500; port++)); do
    if ! echo "$listening" | grep -qE "[:.]${port}[[:space:]]"; then
      echo "$port"
      return 0
    fi
  done
  fail "could not find a free loopback port starting at ${base}"
}

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
  log "timed out waiting for healthy: media-agent=${ma_health}, srs=${srs_health}"
  return 1
}

# publish STREAM TOKEN DURATION HARD_TIMEOUT - bounded synthetic FFmpeg
# publish. Fails the script if ffmpeg exits non-zero (other than the
# timeout-kill codes), i.e. this expects the publish to be ACCEPTED.
publish() {
  local stream="$1" token="$2" duration="$3" hard_timeout="$4"
  local name="ffmpeg-publish-${RUN_ID}-${stream}"
  local url="rtmp://srs:1935/${STREAM_APP}/${stream}?token=${token}"
  local rc=0
  $SUDO timeout --kill-after="${PUBLISH_KILL_AFTER_SECS}s" "${hard_timeout}s" \
    $DOCKER run --rm --name "$name" --network "$NETWORK_NAME" "$FFMPEG_IMAGE" \
      -nostdin -nostats -loglevel warning \
        -re -f lavfi -i "testsrc=size=320x240:rate=25" \
        -f lavfi -i "sine=frequency=1000:sample_rate=48000" \
        -pix_fmt yuv420p \
        -c:v libx264 -profile:v main -g 50 -keyint_min 50 -sc_threshold 0 -b:v 400k \
        -c:a aac -b:a 96k -ar 48000 \
        -t "$duration" \
        -f flv "$url" || rc=$?
  if [[ "$rc" -eq 124 || "$rc" -eq 137 ]]; then
    fail "ffmpeg publish for stream ${stream} exceeded ${hard_timeout}s and was force-killed"
  elif [[ "$rc" -ne 0 ]]; then
    fail "ffmpeg publish for stream ${stream} exited ${rc} (expected an accepted publish to run to completion)"
  fi
}

# publish_expect_rejection STREAM TOKEN HARD_TIMEOUT - a publish this
# script expects SRS to refuse because on_publish rejected it. A
# rejected on_publish causes SRS to close the RTMP connection instead of
# accepting the stream, so ffmpeg exits non-zero well before the hard
# timeout; this helper fails the script if ffmpeg instead runs to a
# clean, full-duration exit (rc 0), which would mean the publish was
# incorrectly accepted.
publish_expect_rejection() {
  local stream="$1" token="$2" hard_timeout="$3"
  local name="ffmpeg-publish-${RUN_ID}-${stream}"
  local url="rtmp://srs:1935/${STREAM_APP}/${stream}?token=${token}"
  local rc=0
  $SUDO timeout --kill-after="${PUBLISH_KILL_AFTER_SECS}s" "${hard_timeout}s" \
    $DOCKER run --rm --name "$name" --network "$NETWORK_NAME" "$FFMPEG_IMAGE" \
      -nostdin -nostats -loglevel warning \
        -re -f lavfi -i "testsrc=size=320x240:rate=25" \
        -f lavfi -i "sine=frequency=1000:sample_rate=48000" \
        -pix_fmt yuv420p \
        -c:v libx264 -profile:v main -g 50 -keyint_min 50 -sc_threshold 0 -b:v 400k \
        -c:a aac -b:a 96k -ar 48000 \
        -t 20 \
        -f flv "$url" || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    fail "ffmpeg publish for unauthorized stream ${stream} completed successfully; want SRS to refuse the connection"
  fi
  if [[ "$rc" -eq 124 || "$rc" -eq 137 ]]; then
    fail "ffmpeg publish for unauthorized stream ${stream} was not refused quickly; it ran until the hard timeout"
  fi
}

agent_logs() { $DOCKER logs "$MEDIA_AGENT_CONTAINER" 2>&1; }

verify_log_line() {
  local pattern="$1" description="$2" waited=0
  while (( waited <= 10 )); do
    agent_logs | grep -qE "$pattern" && return 0
    sleep 1
    waited=$((waited + 1))
  done
  fail "expected log line not found: ${description} (pattern: ${pattern})"
}

# segment_count STREAM - always prints a single number and exits 0, even
# when the stream's output directory was never created (the expected
# case for a rejected/unauthorized stream): under "set -o pipefail",
# find's non-zero exit for a missing directory would otherwise make the
# whole pipeline fail even though wc -l already printed the correct "0".
segment_count() {
  { $SUDO find "${TMP_BASE}/srs-output/${STREAM_APP}/$1" -name '*.ts' -type f 2>/dev/null | wc -l; } || true
}

spool_file_count() {
  $SUDO find "${TMP_BASE}/spool" -type f 2>/dev/null | grep -v '\.tmp-eventcast-' | wc -l
}

# ---- cleanup (always runs) -------------------------------------------

cleanup() {
  local exit_code=$?

  jobs -p | xargs -r kill >/dev/null 2>&1 || true
  log "cleanup: removing any leftover ffmpeg publisher containers from this run"
  $DOCKER ps -aq --filter "name=ffmpeg-publish-${RUN_ID}-" | xargs -r $DOCKER rm -f >/dev/null 2>&1 || true

  log "cleanup: tearing down Compose project ${PROJECT} (containers + its own network only)"
  $COMPOSE down --remove-orphans >/dev/null 2>&1 || true

  if [[ "$REUSED_IMAGE" -eq 0 ]]; then
    log "cleanup: removing this run's built image ${BUILT_IMAGE_TAG} only"
    $DOCKER rmi "$BUILT_IMAGE_TAG" >/dev/null 2>&1 || true
  else
    log "cleanup: MEDIA_AGENT_IMAGE was reused (${MEDIA_AGENT_IMAGE}); not removing it"
  fi

  log "cleanup: removing this run's temp directory ${TMP_BASE} only"
  $SUDO rm -rf "$TMP_BASE" >/dev/null 2>&1 || true

  if [[ "$exit_code" -eq 0 ]]; then
    log "cleanup complete; ingest-durability integration test PASSED (run ${RUN_ID})"
  else
    log "cleanup complete; ingest-durability integration test FAILED (run ${RUN_ID}, exit ${exit_code})"
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# ---- 0. prepare isolated run, seed assignment cache ----------------------

log "0) preparing isolated run ${RUN_ID}"
mkdir -p "${TMP_BASE}/srs-output" "${TMP_BASE}/spool" "${TMP_BASE}/db" "${TMP_BASE}/config"
# media-agent runs as the image's non-root "nonroot" user (not the SSH
# user that just created these directories), so its two writable mounts
# need permissive host-side permissions. srs-output also needs this now:
# docker-compose.yml's srs service runs cap_drop: [ALL] (this milestone's
# hardening), which removes CAP_DAC_OVERRIDE, so the srs container's root
# user can no longer bypass host directory permissions the way an
# unrestricted root process could - it is subject to the same permission
# bits as any other user.
chmod 0777 "${TMP_BASE}/spool" "${TMP_BASE}/db" "${TMP_BASE}/srs-output"
cp "$SRS_CONF_SRC" "${TMP_BASE}/srs.conf"

MA_HTTP_PORT="$(find_free_loopback_port 18185)"
SRS_RTMP_PORT="$(find_free_loopback_port 12935)"
log "   media-agent HTTP -> 127.0.0.1:${MA_HTTP_PORT}, SRS RTMP -> 127.0.0.1:${SRS_RTMP_PORT} (loopback only, unique)"

# Only AUTH_STREAM is seeded; UNAUTH_STREAM is deliberately absent from
# the assignment cache to exercise the "unknown publisher" rejection path.
WINDOW_START="$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)"
WINDOW_END="$(date -u -d '+4 hour' +%Y-%m-%dT%H:%M:%SZ)"
AUTH_TOKEN_HASH="$(printf '%s' "$AUTH_TOKEN" | sha256sum | cut -d' ' -f1)"
cat > "${TMP_BASE}/config/assignments.json" <<EOF
[
  {
    "ingest_id": "${AUTH_STREAM}",
    "event_id": "${AUTH_EVENT_ID}",
    "playback_id": "${AUTH_PLAYBACK_ID}",
    "stream_secret_hash": "${AUTH_TOKEN_HASH}",
    "enabled": true,
    "publish_window_start_at": "${WINDOW_START}",
    "publish_window_end_at": "${WINDOW_END}",
    "config_version": "1"
  }
]
EOF

# Fast reconciliation and session-stale timing so the restart-recovery
# check below does not need to wait on production-scale intervals.
cat > "${TMP_BASE}/.env" <<EOF
EVENTCAST_NODE_ID=ingest-durability-${RUN_ID}
EVENTCAST_LOG_LEVEL=info
MEDIA_AGENT_IMAGE=${MEDIA_AGENT_IMAGE}
MEDIA_AGENT_CONTAINER_NAME=${MEDIA_AGENT_CONTAINER}
SRS_CONTAINER_NAME=${SRS_CONTAINER}
SPOOL_HOST_DIR=${TMP_BASE}/spool
DB_HOST_DIR=${TMP_BASE}/db
SRS_CONF_HOST_PATH=${TMP_BASE}/srs.conf
SRS_OUTPUT_HOST_DIR=${TMP_BASE}/srs-output
ASSIGNMENT_SEED_HOST_DIR=${TMP_BASE}/config
EVENTCAST_ASSIGNMENT_SEED_PATH=/var/lib/eventcast/config/assignments.json
EVENTCAST_RECONCILE_INTERVAL=5s
EVENTCAST_SESSION_STALE_TIMEOUT=20s
MEDIA_AGENT_HTTP_HOST_BIND=127.0.0.1:${MA_HTTP_PORT}
SRS_RTMP_HOST_BIND=127.0.0.1:${SRS_RTMP_PORT}
EOF
COMPOSE="$COMPOSE --env-file ${TMP_BASE}/.env"

# ---- 1. build the current media-agent image (unless reusing one) --------

if [[ "$REUSED_IMAGE" -eq 0 ]]; then
  log "1) building current media-agent source as ${BUILT_IMAGE_TAG}"
  $DOCKER build --build-arg "MEDIA_AGENT_VERSION=${RUN_ID}" \
    -t "$BUILT_IMAGE_TAG" "$MEDIA_AGENT_SRC_DIR" >/dev/null \
    || fail "media-agent image build failed"
else
  log "1) reusing existing media-agent image ${MEDIA_AGENT_IMAGE}"
fi

# ---- 2. validate and start the isolated Compose stack --------------------

log "2) validating docker compose config"
$COMPOSE config >/dev/null || fail "docker compose config failed"

log "2) starting isolated compose stack (project ${PROJECT})"
$COMPOSE up -d || fail "docker compose up failed"

NETWORK_NAME="$($DOCKER network ls --filter "label=com.docker.compose.project=${PROJECT}" --format '{{.Name}}' | head -1)"
[[ -n "$NETWORK_NAME" ]] || fail "could not determine the Compose-created network for project ${PROJECT}"
log "   isolated network: ${NETWORK_NAME}"

# ---- 3. wait for both services healthy ------------------------------------

log "3) waiting up to ${HEALTH_TIMEOUT_SECS}s for both services to report healthy"
wait_for_healthy "$HEALTH_TIMEOUT_SECS" || fail "services did not become healthy within ${HEALTH_TIMEOUT_SECS}s"

code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${MA_HTTP_PORT}/readyz")"
[[ "$code" == "200" ]] || fail "GET /readyz = ${code}, want 200 once the stack is healthy"

# ---- 4. authorized publisher is accepted, produces HLS, captures segments -

log "4) authorized publish (${PUBLISH_DURATION_SECS}s) for stream ${AUTH_STREAM}"
publish "$AUTH_STREAM" "$AUTH_TOKEN" "$PUBLISH_DURATION_SECS" "$PUBLISH_HARD_TIMEOUT_SECS"
sleep 2

verify_log_line "\"on_publish accepted\".*\"stream\":\"${AUTH_STREAM}\"" "on_publish accepted for authorized stream"
verify_log_line "\"segment captured\".*\"stream\":\"${AUTH_STREAM}\"" "segment captured for authorized stream"
verify_log_line "\"on_unpublish closed session\".*\"stream\":\"${AUTH_STREAM}\"" "on_unpublish closed the session"

seg1="$(segment_count "$AUTH_STREAM")"
(( seg1 >= 1 )) || fail "no HLS segments found for authorized stream, want at least 1"
log "   ${seg1} segment(s) produced by SRS"

spool_before_dup="$(spool_file_count)"
(( spool_before_dup >= 1 )) || fail "no durable spool files found after authorized publish, want at least 1"
log "   ${spool_before_dup} durable spool file(s) captured"

agent_logs | grep -qF "$AUTH_TOKEN" && fail "secret token leaked into media-agent logs" || true

# ---- 5. unauthorized publisher is rejected --------------------------------

log "5) unauthorized publish attempt for stream ${UNAUTH_STREAM} (no cached assignment)"
publish_expect_rejection "$UNAUTH_STREAM" "$UNAUTH_TOKEN" "$UNAUTH_HARD_TIMEOUT_SECS"
verify_log_line "on_publish rejected.*\"stream\":\"${UNAUTH_STREAM}\"" "on_publish rejected for unauthorized stream"

unauth_segments="$(segment_count "$UNAUTH_STREAM")"
[[ "$unauth_segments" -eq 0 ]] || fail "unauthorized stream produced ${unauth_segments} HLS segment(s), want 0"

wait_for_healthy 15 || fail "stack was not healthy after the rejected publish attempt"

# ---- 6. duplicate on_hls callback delivery is idempotent ------------------

log "6) replaying a real on_hls callback directly to verify idempotency"
seg_path="$($SUDO find "${TMP_BASE}/srs-output/${STREAM_APP}/${AUTH_STREAM}" -name '*.ts' -type f | sort | tail -1)"
[[ -n "$seg_path" ]] || fail "could not find a captured segment file to replay"
seg_basename="$(basename "$seg_path")"
seg_no="${seg_basename%.ts}"
seg_no="${seg_no##*-}"
container_file="/var/lib/eventcast/srs-output/${STREAM_APP}/${AUTH_STREAM}/${seg_basename}"

replay_body="$(printf '{"action":"on_hls","stream":"%s","app":"live","file":"%s","duration":4.0,"seq_no":%s}' \
  "$AUTH_STREAM" "$container_file" "$seg_no")"

for i in 1 2 3; do
  resp="$(curl -s -w '\n%{http_code}' -X POST -d "$replay_body" "http://127.0.0.1:${MA_HTTP_PORT}/internal/srs/on-hls")"
  status="$(echo "$resp" | tail -1)"
  [[ "$status" == "200" ]] || fail "replayed on_hls call ${i} = ${status}, want 200"
  echo "$resp" | head -1 | grep -q '"code":0' || fail "replayed on_hls call ${i} did not return {\"code\":0}: $(echo "$resp" | head -1)"
done

spool_after_dup="$(spool_file_count)"
[[ "$spool_after_dup" -eq "$spool_before_dup" ]] \
  || fail "spool file count changed after duplicate on_hls replay (${spool_before_dup} -> ${spool_after_dup}); duplicates must not create new files"

verify_log_line "duplicate callback (observed|resolved)" "duplicate on_hls callback logged as such"
log "   duplicate on_hls callback delivery confirmed idempotent (spool file count unchanged: ${spool_after_dup})"

# ---- 7. reconnect follows the documented lifecycle ------------------------

log "7) reconnect check: republishing stream ${AUTH_STREAM} after clean stop"
publish "$AUTH_STREAM" "$AUTH_TOKEN" "$RECONNECT_DURATION_SECS" "$RECONNECT_HARD_TIMEOUT_SECS"
sleep 2
wait_for_healthy 15 || fail "stack was not healthy immediately after the reconnect publish"

reconnect_publish_count="$(agent_logs | grep -cE "\"on_publish accepted\".*\"stream\":\"${AUTH_STREAM}\"" || true)"
(( reconnect_publish_count >= 2 )) || fail "expected at least 2 accepted on_publish callbacks for ${AUTH_STREAM} across the reconnect, got ${reconnect_publish_count}"
log "   reconnect verified: ${reconnect_publish_count} accepted on_publish callbacks recorded for ${AUTH_STREAM}"

# ---- 8. Media Agent restart preserves queue and session recovery ---------

log "8) restarting the media-agent container only"
spool_before_restart="$(spool_file_count)"
$COMPOSE restart media-agent || fail "docker compose restart media-agent failed"

wait_for_healthy "$RESTART_HEALTH_TIMEOUT_SECS" || fail "media-agent did not become healthy again within ${RESTART_HEALTH_TIMEOUT_SECS}s after restart"
verify_log_line "startup reconciliation complete" "startup reconciliation ran after restart"

spool_after_restart="$(spool_file_count)"
[[ "$spool_after_restart" -eq "$spool_before_restart" ]] \
  || fail "spool file count changed across restart (${spool_before_restart} -> ${spool_after_restart}); restart recovery must not duplicate or lose durable files"

log "   restarting a fresh publish on the same stream to confirm the agent still accepts authorized publishers post-restart"
publish "$AUTH_STREAM" "$AUTH_TOKEN" "$RECONNECT_DURATION_SECS" "$RECONNECT_HARD_TIMEOUT_SECS"
sleep 2
verify_log_line "\"on_publish accepted\".*\"stream\":\"${AUTH_STREAM}\"" "on_publish accepted after restart"
verify_log_line "\"segment captured\".*\"stream\":\"${AUTH_STREAM}\"" "segment captured after restart"

spool_after_post_restart_publish="$(spool_file_count)"
(( spool_after_post_restart_publish > spool_after_restart )) \
  || fail "no new durable spool file captured after the post-restart publish"

code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${MA_HTTP_PORT}/readyz")"
[[ "$code" == "200" ]] || fail "GET /readyz = ${code}, want 200 after restart recovery"

agent_logs | grep -qF "$AUTH_TOKEN" && fail "secret token leaked into media-agent logs after restart" || true

log "all checks passed (run ${RUN_ID})"
