#!/usr/bin/env bash
#
# EventCast Media Node - Phase 2 automated RTMP-to-HLS integration proof.
#
# Deterministic, non-interactive validation that a synthetic FFmpeg
# publisher can push RTMP into the pinned SRS runtime, that SRS produces
# playable HLS output, and that SRS's on_publish/on_hls/on_unpublish
# callbacks reach the current Media Agent correctly across the complete
# publish -> reconnect -> soak -> unpublish lifecycle - all without OBS,
# camera hardware, or any interactive step.
#
# Unlike smoke-test.sh (which validates the persistent single-VM
# deployment at its real host paths and container names), this script
# NEVER touches /opt/eventcast/media-node or the "eventcast-media-agent"/
# "eventcast-srs" container names. Every resource this script creates -
# Compose project, container names, image tag, host temp directory, host
# ports - is suffixed with a run ID unique to this invocation, so it is
# always an isolated copy, never the intended persistent deployment, and
# two runs (or this script run twice back to back) never collide or read
# each other's state.
#
# Must run on a Docker+Docker Compose host only (validated on the GCP
# media-node VM). FFmpeg runs only inside temporary, pinned-by-digest
# containers - nothing is installed on the host.
#
# Usage:
#   ./phase2-integration-test.sh                 # full run: functional
#                                                 # stream + reconnect +
#                                                 # ~12 min soak
#   QUICK=1 ./phase2-integration-test.sh          # functional + reconnect
#                                                 # only, no soak - used to
#                                                 # prove a second,
#                                                 # independent run does
#                                                 # not collide with a
#                                                 # prior run's resources
#   MEDIA_AGENT_IMAGE=<tag> ./phase2-integration-test.sh
#                                                 # reuse an already-built
#                                                 # media-agent image
#                                                 # instead of rebuilding
#
# Exit code is 0 only if every check passed; any failure exits non-zero
# with a "[phase2][FAIL]" line naming the failed check. A trap always
# tears down exactly this run's containers, network, image (unless
# reused via MEDIA_AGENT_IMAGE), and temp directory, regardless of
# outcome.

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$COMPOSE_DIR"

MEDIA_AGENT_SRC_DIR="$(cd "$COMPOSE_DIR/../../../services/media-agent" && pwd)"
SRS_CONF_SRC="$COMPOSE_DIR/../srs/srs.conf"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"

# ---- run identity (unique per invocation) ----------------------------

RUN_ID="phase2-$(date +%s)-$$"
PROJECT="eventcast-${RUN_ID}"
TMP_BASE="/tmp/eventcast-${RUN_ID}"
MEDIA_AGENT_CONTAINER="eventcast-media-agent-${RUN_ID}"
SRS_CONTAINER="eventcast-srs-${RUN_ID}"
BUILT_IMAGE_TAG="media-agent:${RUN_ID}"
MEDIA_AGENT_IMAGE="${MEDIA_AGENT_IMAGE:-$BUILT_IMAGE_TAG}"
REUSED_IMAGE=0
[[ "${MEDIA_AGENT_IMAGE}" != "${BUILT_IMAGE_TAG}" ]] && REUSED_IMAGE=1

QUICK="${QUICK:-0}"

# Pinned test-only publisher image. Resolved once on the validation VM
# by pulling mwader/static-ffmpeg:latest and reading back RepoDigests,
# exactly like the SRS pin in ../srs/README.md. This image is used only
# to drive the synthetic publish/probe steps below; it is never part of
# the production media path. Its ENTRYPOINT is the ffmpeg binary itself
# (no shell, no ffprobe, no "ffmpeg" prefix token in the command).
FFMPEG_IMAGE="mwader/static-ffmpeg@sha256:df8a363ed7089ab0779c4f019b935a0e428c0b705478b6ff371b52b4bbe818f8"

STREAM_APP="live"

# Stream identity and credentials, generated up front (before the stack
# starts) because they must be seeded into the assignment cache the
# Media Agent imports at startup - v1.2 "ingest control and durability"
# requires on_publish to authorize against a cached assignment, so an
# arbitrary stream name/token (as Phase 0-2 used) is no longer accepted.
# The reconnect step (6) deliberately reuses FUNCTIONAL_TOKEN rather
# than generating a second one: a real encoder reconnect presents the
# same configured stream key, not a new credential.
FUNCTIONAL_STREAM="functional-${RUN_ID}"
FUNCTIONAL_EVENT_ID="event-functional-${RUN_ID}"
FUNCTIONAL_PLAYBACK_ID="pb-functional-${RUN_ID}"
FUNCTIONAL_TOKEN="$(head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
SOAK_STREAM="soak-${RUN_ID}"
SOAK_EVENT_ID="event-soak-${RUN_ID}"
SOAK_PLAYBACK_ID="pb-soak-${RUN_ID}"
SOAK_TOKEN="$(head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')"

HEALTH_TIMEOUT_SECS=60
RESTART_HEALTH_TIMEOUT_SECS=60
HEALTH_POLL_INTERVAL_SECS=2

FUNCTIONAL_DURATION_SECS=20
FUNCTIONAL_HARD_TIMEOUT_SECS=35
RECONNECT_DURATION_SECS=20
RECONNECT_HARD_TIMEOUT_SECS=35
SOAK_DURATION_SECS=720          # 12 minutes
SOAK_HARD_TIMEOUT_SECS=780      # 13 minutes
SOAK_SAMPLE_INTERVAL_SECS=90
PUBLISH_KILL_AFTER_SECS=5

# ---- helpers ------------------------------------------------------------

log()  { printf '[phase2] %s\n' "$*" >&2; }
fail() { printf '[phase2][FAIL] %s\n' "$*" >&2; exit 1; }

SUDO=""
if ! docker info >/dev/null 2>&1; then
  SUDO="sudo"
fi
DOCKER="$SUDO docker"
COMPOSE="$DOCKER compose -p $PROJECT -f $COMPOSE_FILE"

# find_free_loopback_port BASE - scans upward from BASE for a TCP port
# with nothing currently in LISTEN state on 127.0.0.1, so two isolated
# runs (or a run alongside a real deployment on the standard ports)
# never collide.
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

# publish STREAM_NAME TOKEN DURATION HARD_TIMEOUT - runs a bounded
# synthetic FFmpeg publish, attached to this run's private Compose
# network and addressing SRS by its Compose service DNS name ("srs"),
# never via a host-published port. The stream key carries a synthetic
# "?token=" query per 02_V1_ARCHITECTURE_SPEC.md's documented
# "<ingest_id>?token=<secret>" form, so the secret-redaction check below
# has a real secret to look for.
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
    fail "ffmpeg publish for stream ${stream} exited ${rc}"
  fi
}

agent_logs() { $DOCKER logs "$MEDIA_AGENT_CONTAINER" 2>&1; }

# verify_callback ACTION STREAM - polls (bounded, 10s) rather than
# checking once, so a transient hiccup in a single "docker logs" call
# under concurrent daemon load (health checks, other docker inspect
# calls during a long soak) cannot be mistaken for a missing callback.
verify_callback() {
  local action="$1" stream="$2" waited=0
  while (( waited <= 10 )); do
    agent_logs | grep -qE "\"callback\":\"${action}\".*\"stream\":\"${stream}\"" && return 0
    sleep 1
    waited=$((waited + 1))
  done
  fail "no successful ${action} callback found in media-agent logs for stream ${stream}"
}

segment_count() {
  $SUDO find "${TMP_BASE}/srs-output/${STREAM_APP}/$1" -name '*.ts' -type f 2>/dev/null | wc -l
}

# EXT-X-MEDIA-SEQUENCE is deliberately NOT used to prove playlist
# advancement here: srs.conf sets hls_window 900 (seconds), so the
# sequence number only starts incrementing once a stream has been live
# longer than 15 minutes and segments begin rolling out of the window.
# The soak below runs ~12 minutes (by design, per Phase 2 scope - the
# full 2-hour/900s+ soak is a separate later operational gate), so the
# sequence number would legitimately stay at 0 for the entire run even
# though new segments are being produced. segment_count() growth is the
# correct, window-independent signal that the playlist is advancing.

# verify_segment_codecs STREAM - proves at least one produced segment is
# a real, readable H.264/AAC MPEG-TS file, not just a non-empty file.
# The pinned FFmpeg test image ships no ffprobe and no shell, so this
# runs "ffmpeg -i <segment>" directly (its ENTRYPOINT is the ffmpeg
# binary itself) and reads the stream summary FFmpeg prints to stderr
# for any input, without transcoding or a separate probe tool.
verify_segment_codecs() {
  local stream="$1" seg
  local dir="${TMP_BASE}/srs-output/${STREAM_APP}/${stream}"
  seg="$($SUDO find "$dir" -name '*.ts' -type f | sort | tail -1)"
  [[ -n "$seg" ]] || fail "no segment file found to inspect for stream ${stream}"
  $SUDO test -s "$seg" || fail "segment ${seg} is empty"
  local rel; rel="$(basename "$seg")"
  local info
  info="$($DOCKER run --rm -v "${dir}:/data:ro" "$FFMPEG_IMAGE" -hide_banner -i "/data/${rel}" 2>&1 || true)"
  echo "$info" | grep -qi 'Video: h264' || fail "segment ${seg} does not report an h264 video stream (ffmpeg -i: ${info})"
  echo "$info" | grep -qi 'Audio: aac' || fail "segment ${seg} does not report an aac audio stream (ffmpeg -i: ${info})"
}

# direct_contract_checks MA_PORT - proves the deployed container's HTTP
# behavior directly (method handling, malformed input, response shape),
# independent of and in addition to the real SRS-triggered path.
#
# The same well-formed-but-unauthenticated body is posted to all three
# routes. Each route's *correct* outcome now differs, because v1.2
# "ingest control and durability" added real business logic: on-publish
# must reject an unknown/unseeded stream (ASSIGNMENT_MISMATCH); on-hls
# must reject a stream with no session on record (no prior accepted
# publish in this direct-check flow); on-unpublish for an unknown
# stream is a documented idempotent no-op, so it alone still returns
# {"code":0}. All three still return HTTP 200 either way, per the SRS
# callback contract (rejection is a non-zero "code", not an HTTP error
# status).
direct_contract_checks() {
  local port="$1"
  local base="http://127.0.0.1:${port}"

  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "${base}/healthz")"
  [[ "$code" == "200" ]] || fail "direct GET /healthz = ${code}, want 200"

  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${base}/healthz")"
  [[ "$code" == "405" ]] || fail "direct POST /healthz = ${code}, want 405"

  code="$(curl -s -o /dev/null -w '%{http_code}' "${base}/readyz")"
  [[ "$code" == "200" ]] || fail "direct GET /readyz = ${code}, want 200"

  for route in on-publish on-hls on-unpublish; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "${base}/internal/srs/${route}")"
    [[ "$code" == "405" ]] || fail "direct GET /internal/srs/${route} = ${code}, want 405"

    code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -d '{"action":' "${base}/internal/srs/${route}")"
    [[ "$code" == "400" ]] || fail "direct malformed POST /internal/srs/${route} = ${code}, want 400"

    local body resp status want_code
    body='{"action":"on_publish","stream":"direct-contract-check","app":"live"}'
    resp="$(curl -s -w '\n%{http_code}' -X POST -d "$body" "${base}/internal/srs/${route}")"
    status="$(echo "$resp" | tail -1)"
    [[ "$status" == "200" ]] || fail "direct valid POST /internal/srs/${route} = ${status}, want 200"

    if [[ "$route" == "on-unpublish" ]]; then
      want_code='"code":0'
    else
      want_code='"code":1'
    fi
    echo "$resp" | head -1 | grep -q "$want_code" \
      || fail "direct valid POST /internal/srs/${route} response did not contain ${want_code} (got: $(echo "$resp" | head -1))"
  done
}

# ---- cleanup (always runs) ----------------------------------------------

cleanup() {
  local exit_code=$?

  # If a failure happened while a background soak publish was still
  # running, stop it (and any of its helper containers) BEFORE tearing
  # down the Compose stack, so SRS is not yanked out from under a still
  # -connected publisher, which would otherwise print a misleading
  # cascade of unrelated RTMP send-error lines after the real failure.
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
    log "cleanup complete; phase2 integration test PASSED (run ${RUN_ID})"
  else
    log "cleanup complete; phase2 integration test FAILED (run ${RUN_ID}, exit ${exit_code})"
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# ---- 0. prepare isolated temp directory and config ----------------------

log "0) preparing isolated run ${RUN_ID}"
mkdir -p "${TMP_BASE}/srs-output" "${TMP_BASE}/spool" "${TMP_BASE}/db" "${TMP_BASE}/config"
# media-agent runs as the image's non-root "nonroot" user (not the SSH
# user that just created these directories), so its two writable mounts
# need permissive host-side permissions. srs-output is untouched here:
# the srs image runs as root, which already has write access regardless.
chmod 0777 "${TMP_BASE}/spool" "${TMP_BASE}/db"
cp "$SRS_CONF_SRC" "${TMP_BASE}/srs.conf"

MA_HTTP_PORT="$(find_free_loopback_port 18085)"
SRS_RTMP_PORT="$(find_free_loopback_port 11935)"
log "   media-agent HTTP -> 127.0.0.1:${MA_HTTP_PORT}, SRS RTMP -> 127.0.0.1:${SRS_RTMP_PORT} (loopback only, unique)"

# Seed the assignment cache the Media Agent imports at startup: one
# entry per stream this script publishes, with a wide publish window
# (now -1h .. now +4h) comfortably covering the functional, reconnect,
# and soak steps below. Only the SHA-256 hash of each token is written,
# never the raw secret.
WINDOW_START="$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)"
WINDOW_END="$(date -u -d '+4 hour' +%Y-%m-%dT%H:%M:%SZ)"
FUNCTIONAL_TOKEN_HASH="$(printf '%s' "$FUNCTIONAL_TOKEN" | sha256sum | cut -d' ' -f1)"
SOAK_TOKEN_HASH="$(printf '%s' "$SOAK_TOKEN" | sha256sum | cut -d' ' -f1)"
cat > "${TMP_BASE}/config/assignments.json" <<EOF
[
  {
    "ingest_id": "${FUNCTIONAL_STREAM}",
    "event_id": "${FUNCTIONAL_EVENT_ID}",
    "playback_id": "${FUNCTIONAL_PLAYBACK_ID}",
    "stream_secret_hash": "${FUNCTIONAL_TOKEN_HASH}",
    "enabled": true,
    "publish_window_start_at": "${WINDOW_START}",
    "publish_window_end_at": "${WINDOW_END}",
    "config_version": "1"
  },
  {
    "ingest_id": "${SOAK_STREAM}",
    "event_id": "${SOAK_EVENT_ID}",
    "playback_id": "${SOAK_PLAYBACK_ID}",
    "stream_secret_hash": "${SOAK_TOKEN_HASH}",
    "enabled": true,
    "publish_window_start_at": "${WINDOW_START}",
    "publish_window_end_at": "${WINDOW_END}",
    "config_version": "1"
  }
]
EOF

cat > "${TMP_BASE}/.env" <<EOF
EVENTCAST_NODE_ID=phase2-integration-${RUN_ID}
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

# ---- 4. direct HTTP contract checks ---------------------------------------

log "4) direct HTTP contract checks against the running media-agent"
direct_contract_checks "$MA_HTTP_PORT"

# ---- 5. functional publish: on_publish / on_hls / on_unpublish -----------

log "5) functional publish (${FUNCTIONAL_DURATION_SECS}s) for stream ${FUNCTIONAL_STREAM}"
publish "$FUNCTIONAL_STREAM" "$FUNCTIONAL_TOKEN" "$FUNCTIONAL_DURATION_SECS" "$FUNCTIONAL_HARD_TIMEOUT_SECS"
sleep 2

verify_callback on_publish "$FUNCTIONAL_STREAM"
verify_callback on_hls "$FUNCTIONAL_STREAM"
verify_callback on_unpublish "$FUNCTIONAL_STREAM"

seg1="$(segment_count "$FUNCTIONAL_STREAM")"
(( seg1 >= 1 )) || fail "no HLS segments found for functional stream, want at least 1"
log "   ${seg1} segment(s) produced"
verify_segment_codecs "$FUNCTIONAL_STREAM"

log "   verifying secret token is absent from media-agent logs"
agent_logs | grep -qF "$FUNCTIONAL_TOKEN" && fail "secret token leaked into media-agent logs" || true

# ---- 6. reconnect: stop then republish the same stream --------------------

log "6) reconnect check: republishing stream ${FUNCTIONAL_STREAM} after clean stop"
# Reuses FUNCTIONAL_TOKEN (not a new token): a real encoder reconnect
# presents the same configured stream key, and the assignment cache
# only has one credential seeded per ingest id.
publish "$FUNCTIONAL_STREAM" "$FUNCTIONAL_TOKEN" "$RECONNECT_DURATION_SECS" "$RECONNECT_HARD_TIMEOUT_SECS"
sleep 2

wait_for_healthy 15 || fail "stack was not healthy immediately after the reconnect publish"

reconnect_publish_count=0
reconnect_waited=0
while (( reconnect_waited <= 10 )); do
  reconnect_publish_count="$(agent_logs | grep -cE "\"callback\":\"on_publish\".*\"stream\":\"${FUNCTIONAL_STREAM}\"" || true)"
  (( reconnect_publish_count >= 2 )) && break
  sleep 1
  reconnect_waited=$((reconnect_waited + 1))
done
(( reconnect_publish_count >= 2 )) || fail "expected at least 2 on_publish callbacks for ${FUNCTIONAL_STREAM} across the reconnect, got ${reconnect_publish_count}"
verify_callback on_unpublish "$FUNCTIONAL_STREAM"
agent_logs | grep -qF "$FUNCTIONAL_TOKEN" && fail "secret token leaked into media-agent logs after reconnect" || true
log "   reconnect verified: stack remained healthy and produced a second on_publish/on_unpublish pair"

if [[ "$QUICK" -eq 1 ]]; then
  log "QUICK=1: skipping the soak phase"
else
  # ---- 7. ~12 minute automated soak with playlist-advancement sampling ---

  log "7) starting ${SOAK_DURATION_SECS}s (~$((SOAK_DURATION_SECS/60)) min) automated soak for stream ${SOAK_STREAM}"

  publish "$SOAK_STREAM" "$SOAK_TOKEN" "$SOAK_DURATION_SECS" "$SOAK_HARD_TIMEOUT_SECS" &
  soak_pid=$!

  # Give SRS a moment to create the stream directory before the first sample.
  sleep 10
  last_count=-1
  samples=0
  while kill -0 "$soak_pid" 2>/dev/null; do
    sleep "$SOAK_SAMPLE_INTERVAL_SECS"
    samples=$((samples + 1))
    cur_count="$(segment_count "$SOAK_STREAM")"
    cur_ma="$($DOCKER inspect -f '{{.State.Health.Status}}' "$MEDIA_AGENT_CONTAINER" 2>/dev/null || echo unknown)"
    cur_srs="$($DOCKER inspect -f '{{.State.Health.Status}}' "$SRS_CONTAINER" 2>/dev/null || echo unknown)"
    log "   soak sample ${samples}: segment-count=${cur_count} media-agent=${cur_ma} srs=${cur_srs}"
    [[ "$cur_ma" == "healthy" && "$cur_srs" == "healthy" ]] || fail "soak sample ${samples}: a service is unhealthy (media-agent=${cur_ma}, srs=${cur_srs})"
    if (( samples > 1 )); then
      (( cur_count > last_count )) || fail "soak sample ${samples}: HLS segment count did not advance (${last_count} -> ${cur_count})"
    fi
    last_count="$cur_count"
  done
  wait "$soak_pid" || fail "soak publish process exited with an error"

  (( samples >= 3 )) || fail "soak produced only ${samples} playlist samples, want at least 3 to prove advancement over time"

  sleep 2
  verify_callback on_publish "$SOAK_STREAM"
  verify_callback on_unpublish "$SOAK_STREAM"
  seg_soak="$(segment_count "$SOAK_STREAM")"
  (( seg_soak >= 10 )) || fail "soak stream produced only ${seg_soak} segments, want at least 10 over ${SOAK_DURATION_SECS}s"
  verify_segment_codecs "$SOAK_STREAM"
  agent_logs | grep -qF "$SOAK_TOKEN" && fail "soak secret token leaked into media-agent logs" || true
  log "   soak complete: ${samples} samples, segment count advanced monotonically, ${seg_soak} segments, both services stayed healthy throughout"
fi

log "all checks passed (run ${RUN_ID})"
