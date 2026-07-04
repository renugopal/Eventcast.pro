#!/usr/bin/env bash
#
# EventCast Media Node - bounded multi-stream capacity baseline.
#
# Measures actual CPU, memory, upload queue depth/age, and segment
# confirmation behavior at 1, 2, and 3 concurrent synthetic streams
# against the real isolated stack (SRS + media-agent + MinIO) on
# whatever hardware this script actually runs on. It does NOT attempt
# the architecture's ten-stream initial scheduler limit
# (05_DECISIONS.md ADR-014): that number is a safety ceiling requiring
# production-equivalent hardware to qualify
# (07_TEST_AND_ACCEPTANCE_PLAN.md "Load qualification": "Run the exact
# production node at one, five, and ten simultaneous streams"), and this
# script's own header reports the exact vCPU/RAM it ran on so the
# results are never misread as a production capacity claim beyond what
# was actually measured.
#
# Usage: ./capacity-baseline-test.sh [max-streams]   (default 3)
#
# Every resource this script creates is suffixed with a run ID unique to
# this invocation; it never touches /opt/eventcast/media-node.

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$COMPOSE_DIR"

MEDIA_AGENT_SRC_DIR="$(cd "$COMPOSE_DIR/../../../services/media-agent" && pwd)"
SRS_CONF_SRC="$COMPOSE_DIR/../srs/srs.conf"

MAX_STREAMS="${1:-3}"
RUN_ID="capacity-$(date +%s)-$$"
TMP_BASE="/tmp/eventcast-${RUN_ID}"
NETWORK="eventcast-${RUN_ID}-net"
MEDIA_AGENT_CONTAINER="eventcast-media-agent-${RUN_ID}"
SRS_CONTAINER="eventcast-srs-${RUN_ID}"
MINIO_CONTAINER="eventcast-minio-${RUN_ID}"
BUILT_IMAGE_TAG="media-agent:${RUN_ID}"
MEDIA_AGENT_IMAGE="${MEDIA_AGENT_IMAGE:-$BUILT_IMAGE_TAG}"
REUSED_IMAGE=0
[[ "${MEDIA_AGENT_IMAGE}" != "${BUILT_IMAGE_TAG}" ]] && REUSED_IMAGE=1

FFMPEG_IMAGE="mwader/static-ffmpeg@sha256:df8a363ed7089ab0779c4f019b935a0e428c0b705478b6ff371b52b4bbe818f8"
MINIO_IMAGE="minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e"
MINIO_ACCESS_KEY="testaccesskey"
MINIO_SECRET_KEY="testsecretkey12345"
BUCKET="eventcast-test-${RUN_ID}"
REPORT="${TMP_BASE}/capacity-report.txt"

log()  { printf '[capacity] %s\n' "$*" >&2; }
fail() { printf '[capacity][FAIL] %s\n' "$*" >&2; exit 1; }

SUDO=""
if ! docker info >/dev/null 2>&1; then SUDO="sudo"; fi
DOCKER="$SUDO docker"

cleanup() {
  local exit_code=$?
  $DOCKER ps -aq --filter "name=ffmpeg-cap-${RUN_ID}-" | xargs -r $DOCKER rm -f >/dev/null 2>&1 || true
  $DOCKER rm -f "$MEDIA_AGENT_CONTAINER" "$SRS_CONTAINER" "$MINIO_CONTAINER" >/dev/null 2>&1 || true
  $DOCKER network rm "$NETWORK" >/dev/null 2>&1 || true
  if [[ "$REUSED_IMAGE" -eq 0 ]]; then $DOCKER rmi "$BUILT_IMAGE_TAG" >/dev/null 2>&1 || true; fi
  if [[ -f "$REPORT" ]]; then
    echo "=== capacity-baseline-test.sh report (run ${RUN_ID}) ===" >&2
    cat "$REPORT" >&2
  fi
  $SUDO rm -rf "$TMP_BASE" >/dev/null 2>&1 || true
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
wait_http_200() {
  local url="$1" timeout="$2" waited=0 code
  while (( waited < timeout )); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
    [[ "$code" == "200" ]] && return 0
    sleep 2; waited=$((waited+2))
  done
  fail "GET $url never returned 200 within ${timeout}s (last: ${code})"
}

log "0) preparing isolated run ${RUN_ID} (host: $(nproc) vCPU, $(free -h | awk 'NR==2{print $2}') RAM)"
mkdir -p "${TMP_BASE}/spool" "${TMP_BASE}/db" "${TMP_BASE}/srs-output" "${TMP_BASE}/minio-data" "${TMP_BASE}/config"
# This script drives raw `docker run` containers rather than
# docker-compose.yml, so it does not itself apply that file's
# cap_drop: [ALL] hardening to the srs container - capacity/soak
# measurement, not hardening validation, is this script's purpose (the
# compose-based integration tests already exercise the real hardened
# config). srs-output is still made permissive here for consistency
# with every other writable mount and to match the hardened behavior
# exactly if cap_drop flags are ever added to this script later.
chmod 0777 "${TMP_BASE}/spool" "${TMP_BASE}/db" "${TMP_BASE}/minio-data" "${TMP_BASE}/srs-output"
cp "$SRS_CONF_SRC" "${TMP_BASE}/srs.conf"

{
  echo "EventCast capacity baseline - run ${RUN_ID}"
  echo "Host: $(nproc) vCPU, $(free -h | awk 'NR==2{print $2}') RAM, $(uname -r)"
  echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
} > "$REPORT"

$DOCKER network create "$NETWORK" >/dev/null

if [[ "$REUSED_IMAGE" -eq 0 ]]; then
  log "1) building media-agent image ${BUILT_IMAGE_TAG}"
  $DOCKER build --build-arg "MEDIA_AGENT_VERSION=${RUN_ID}" -t "$BUILT_IMAGE_TAG" "$MEDIA_AGENT_SRC_DIR" >/dev/null \
    || fail "media-agent image build failed"
else
  log "1) reusing existing media-agent image ${MEDIA_AGENT_IMAGE}"
fi

MINIO_PORT="$(find_free_loopback_port 19300)"
log "2) starting MinIO"
$DOCKER run -d --name "$MINIO_CONTAINER" --network "$NETWORK" \
  -e "MINIO_ROOT_USER=${MINIO_ACCESS_KEY}" -e "MINIO_ROOT_PASSWORD=${MINIO_SECRET_KEY}" \
  -v "${TMP_BASE}/minio-data:/data" -p "127.0.0.1:${MINIO_PORT}:9000" \
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

# Seed MAX_STREAMS distinct authorized assignments up front.
WINDOW_START="$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)"
WINDOW_END="$(date -u -d '+4 hour' +%Y-%m-%dT%H:%M:%SZ)"
{
  echo "["
  for ((i = 1; i <= MAX_STREAMS; i++)); do
    tok="captoken-${RUN_ID}-${i}"
    tokhash="$(printf '%s' "$tok" | sha256sum | cut -d' ' -f1)"
    printf '{"ingest_id":"cap-%s-%d","event_id":"event-cap-%s-%d","playback_id":"pb-cap-%s-%d","stream_secret_hash":"%s","enabled":true,"publish_window_start_at":"%s","publish_window_end_at":"%s","config_version":"1"}' \
      "$RUN_ID" "$i" "$RUN_ID" "$i" "$RUN_ID" "$i" "$tokhash" "$WINDOW_START" "$WINDOW_END"
    [[ "$i" -lt "$MAX_STREAMS" ]] && echo ","
  done
  echo "]"
} > "${TMP_BASE}/config/assignments.json"

MA_PORT="$(find_free_loopback_port 18885)"
SRS_RTMP_PORT="$(find_free_loopback_port 13135)"
log "3) starting media-agent + SRS"
$DOCKER run -d --name "$MEDIA_AGENT_CONTAINER" --network "$NETWORK" --network-alias media-agent \
  -p "127.0.0.1:${MA_PORT}:8085" \
  -e "EVENTCAST_NODE_ID=capacity-${RUN_ID}" \
  -e "EVENTCAST_MEDIA_AGENT_HTTP_ADDR=0.0.0.0:8085" \
  -e "EVENTCAST_DB_PATH=/var/lib/eventcast/db/media-agent.sqlite3" \
  -e "EVENTCAST_SPOOL_ROOT=/var/lib/eventcast/spool" \
  -e "EVENTCAST_SRS_HLS_ROOT=/var/lib/eventcast/srs-output" \
  -e "EVENTCAST_ASSIGNMENT_SEED_PATH=/var/lib/eventcast/config/assignments.json" \
  -e "EVENTCAST_R2_ENDPOINT=http://${MINIO_CONTAINER}:9000" \
  -e "EVENTCAST_R2_REGION=us-east-1" \
  -e "EVENTCAST_R2_BUCKET=${BUCKET}" \
  -e "EVENTCAST_R2_ACCESS_KEY_ID=${MINIO_ACCESS_KEY}" \
  -e "EVENTCAST_R2_SECRET_ACCESS_KEY=${MINIO_SECRET_KEY}" \
  -e "EVENTCAST_R2_UPLOAD_CONCURRENCY=4" \
  -v "${TMP_BASE}/spool:/var/lib/eventcast/spool" \
  -v "${TMP_BASE}/db:/var/lib/eventcast/db" \
  -v "${TMP_BASE}/srs-output:/var/lib/eventcast/srs-output" \
  -v "${TMP_BASE}/config:/var/lib/eventcast/config:ro" \
  "$MEDIA_AGENT_IMAGE" >/dev/null
wait_http_200 "http://127.0.0.1:${MA_PORT}/readyz" 30

$DOCKER run -d --name "$SRS_CONTAINER" --network "$NETWORK" \
  -p "127.0.0.1:${SRS_RTMP_PORT}:1935" \
  -v "${TMP_BASE}/srs.conf:/usr/local/srs/conf/eventcast.conf:ro" \
  -v "${TMP_BASE}/srs-output:/var/lib/eventcast/srs-output" \
  ossrs/srs@sha256:4e293846ad2448ff1a0157aa2c694e7c451fff5046c93b5bc6da0fa0384ef998 \
  ./objs/srs -c conf/eventcast.conf >/dev/null

sleep 3
SRS_WAITED=0
until $DOCKER inspect -f '{{.State.Running}}' "$SRS_CONTAINER" 2>/dev/null | grep -q true; do
  sleep 2; SRS_WAITED=$((SRS_WAITED+2))
  (( SRS_WAITED > 30 )) && fail "SRS container did not start"
done
log "   media-agent and SRS running"

sample_stats() {
  $DOCKER stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' "$MEDIA_AGENT_CONTAINER" "$SRS_CONTAINER" 2>/dev/null || true
}

run_level() {
  local n="$1" duration="$2"
  log "4) running ${n} concurrent stream(s) for ${duration}s"
  local pids=()
  for ((i = 1; i <= n; i++)); do
    (
      $DOCKER run --rm --name "ffmpeg-cap-${RUN_ID}-${i}" --network "$NETWORK" "$FFMPEG_IMAGE" \
        -nostdin -nostats -loglevel error \
        -re -f lavfi -i "testsrc=size=320x240:rate=25" \
        -f lavfi -i "sine=frequency=1000:sample_rate=48000" -pix_fmt yuv420p \
        -c:v libx264 -profile:v main -g 50 -keyint_min 50 -sc_threshold 0 -b:v 400k \
        -c:a aac -b:a 96k -ar 48000 -t "$duration" \
        -f flv "rtmp://${SRS_CONTAINER}:1935/live/cap-${RUN_ID}-${i}?token=captoken-${RUN_ID}-${i}"
    ) &
    pids+=($!)
  done

  sleep $(( duration / 2 ))
  log "   mid-run sample:"
  sample_stats | tee -a "$REPORT" >&2
  METRICS_MID="$(curl -s "http://127.0.0.1:${MA_PORT}/metrics")"
  QUEUE_AGE="$(echo "$METRICS_MID" | awk '/^media_agent_queue_oldest_pending_age_seconds/ {print $2}')"
  echo "  mid-run queue_oldest_pending_age_seconds=${QUEUE_AGE:-0}" >> "$REPORT"

  for pid in "${pids[@]}"; do wait "$pid" || true; done
  sleep 5

  local confirmed=0
  for ((i = 1; i <= n; i++)); do
    c="$($DOCKER logs "$MEDIA_AGENT_CONTAINER" 2>&1 | grep -cE "\"segment upload confirmed\".*\"event_id\":\"event-cap-${RUN_ID}-${i}\"" || true)"
    confirmed=$(( confirmed + c ))
  done
  echo "  streams=${n} total_confirmed_segments=${confirmed}" | tee -a "$REPORT" >&2
  METRICS_END="$(curl -s "http://127.0.0.1:${MA_PORT}/metrics")"
  DEADLETTER="$(echo "$METRICS_END" | awk -F'[{}" ]+' '/^media_agent_segment_upload_status/ && /dead_letter/ {print $NF}')"
  echo "  streams=${n} dead_letter_count=${DEADLETTER:-0}" | tee -a "$REPORT" >&2
  echo >> "$REPORT"
}

echo "--- per-level results ---" >> "$REPORT"
LEVEL=1
while (( LEVEL <= MAX_STREAMS )); do
  echo "## ${LEVEL} concurrent stream(s)" >> "$REPORT"
  run_level "$LEVEL" 60
  LEVEL=$((LEVEL + 1))
done

log "capacity baseline complete (run ${RUN_ID}); see report above"
