#!/usr/bin/env bash
#
# EventCast Media Node - isolated backup/restore verification.
#
# Proves backup.sh's approach (stop the agent, copy the SQLite database
# directory, restart) actually produces a restorable backup, using
# entirely isolated, throwaway temporary data - never the persistent
# production database or spool
# (this milestone's requirement: "Provide tested restore verification
# using isolated temporary data, not production state").
#
# Method: start a standalone media-agent container seeded with one
# assignment, prove an authorized publish succeeds, stop it, back up its
# database directory, destroy the live database (simulating data loss),
# restore from the backup, restart the container WITHOUT the seed file
# this time, and prove the same publish still succeeds - the only way it
# can, since nothing reseeds the cache on this second start, is if the
# restored database genuinely contains the original assignment. This is
# a stronger proof than merely checking that files exist after copying
# them back.
#
# Usage: ./restore-test.sh
# Exit code is 0 only if every check passed. A trap always removes this
# run's container, image (unless reused via MEDIA_AGENT_IMAGE), network,
# and temp directories.

set -euo pipefail

COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$COMPOSE_DIR"

MEDIA_AGENT_SRC_DIR="$(cd "$COMPOSE_DIR/../../../services/media-agent" && pwd)"

RUN_ID="restoretest-$(date +%s)-$$"
TMP_BASE="/tmp/eventcast-${RUN_ID}"
CONTAINER="eventcast-restoretest-${RUN_ID}"
NETWORK="eventcast-restoretest-net-${RUN_ID}"
BUILT_IMAGE_TAG="media-agent:${RUN_ID}"
MEDIA_AGENT_IMAGE="${MEDIA_AGENT_IMAGE:-$BUILT_IMAGE_TAG}"
REUSED_IMAGE=0
[[ "${MEDIA_AGENT_IMAGE}" != "${BUILT_IMAGE_TAG}" ]] && REUSED_IMAGE=1

STREAM="restoretest-${RUN_ID}"
EVENT_ID="event-restoretest-${RUN_ID}"
PLAYBACK_ID="pb-restoretest-${RUN_ID}"
TOKEN="$(head -c16 /dev/urandom | od -An -tx1 | tr -d ' \n')"

log()  { printf '[restore-test] %s\n' "$*" >&2; }
fail() { printf '[restore-test][FAIL] %s\n' "$*" >&2; exit 1; }

SUDO=""
if ! docker info >/dev/null 2>&1; then
  SUDO="sudo"
fi
DOCKER="$SUDO docker"

cleanup() {
  local exit_code=$?
  $DOCKER rm -f "$CONTAINER" >/dev/null 2>&1 || true
  $DOCKER network rm "$NETWORK" >/dev/null 2>&1 || true
  if [[ "$REUSED_IMAGE" -eq 0 ]]; then
    $DOCKER rmi "$BUILT_IMAGE_TAG" >/dev/null 2>&1 || true
  fi
  $SUDO rm -rf "$TMP_BASE" >/dev/null 2>&1 || true
  if [[ "$exit_code" -eq 0 ]]; then
    log "cleanup complete; restore test PASSED (run ${RUN_ID})"
  else
    log "cleanup complete; restore test FAILED (run ${RUN_ID}, exit ${exit_code})"
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

find_free_loopback_port() {
  local base="$1" port listening
  listening="$(ss -ltn 2>/dev/null || true)"
  for ((port = base; port < base + 500; port++)); do
    if ! echo "$listening" | grep -qE "[:.]${port}[[:space:]]"; then
      echo "$port"; return 0
    fi
  done
  fail "could not find a free loopback port starting at ${base}"
}

wait_ready() {
  local port="$1" timeout="$2" waited=0 code
  while (( waited < timeout )); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/readyz" || true)"
    [[ "$code" == "200" ]] && return 0
    sleep 2; waited=$((waited + 2))
  done
  fail "media agent did not become ready within ${timeout}s (last /readyz code: ${code})"
}

try_publish() {
  local port="$1"
  curl -s -X POST -d "{\"action\":\"on_publish\",\"stream\":\"${STREAM}\",\"app\":\"live\",\"param\":\"?token=${TOKEN}\"}" \
    "http://127.0.0.1:${port}/internal/srs/on-publish"
}

close_publish() {
  local port="$1"
  curl -s -X POST -d "{\"action\":\"on_unpublish\",\"stream\":\"${STREAM}\",\"app\":\"live\"}" \
    "http://127.0.0.1:${port}/internal/srs/on-unpublish" >/dev/null
}

# ---- 0. prepare isolated temp state -----------------------------------

log "0) preparing isolated run ${RUN_ID}"
mkdir -p "${TMP_BASE}/spool" "${TMP_BASE}/srs-output" "${TMP_BASE}/db" "${TMP_BASE}/config" "${TMP_BASE}/backup/db"
chmod 0777 "${TMP_BASE}/spool" "${TMP_BASE}/db"

WINDOW_START="$(date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ)"
WINDOW_END="$(date -u -d '+4 hour' +%Y-%m-%dT%H:%M:%SZ)"
TOKEN_HASH="$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)"
cat > "${TMP_BASE}/config/assignments.json" <<EOF
[{
  "ingest_id": "${STREAM}",
  "event_id": "${EVENT_ID}",
  "playback_id": "${PLAYBACK_ID}",
  "stream_secret_hash": "${TOKEN_HASH}",
  "enabled": true,
  "publish_window_start_at": "${WINDOW_START}",
  "publish_window_end_at": "${WINDOW_END}",
  "config_version": "1"
}]
EOF

$DOCKER network create "$NETWORK" >/dev/null

if [[ "$REUSED_IMAGE" -eq 0 ]]; then
  log "1) building media-agent image ${BUILT_IMAGE_TAG}"
  $DOCKER build --build-arg "MEDIA_AGENT_VERSION=${RUN_ID}" -t "$BUILT_IMAGE_TAG" "$MEDIA_AGENT_SRC_DIR" >/dev/null \
    || fail "media-agent image build failed"
else
  log "1) reusing existing media-agent image ${MEDIA_AGENT_IMAGE}"
fi

PORT="$(find_free_loopback_port 18385)"

start_container() {
  local seed_args=()
  if [[ "$1" == "with-seed" ]]; then
    seed_args=(-e "EVENTCAST_ASSIGNMENT_SEED_PATH=/var/lib/eventcast/config/assignments.json" \
      -v "${TMP_BASE}/config:/var/lib/eventcast/config:ro")
  fi
  $DOCKER run -d --name "$CONTAINER" --network "$NETWORK" \
    -p "127.0.0.1:${PORT}:8085" \
    -e "EVENTCAST_NODE_ID=restoretest-${RUN_ID}" \
    -e "EVENTCAST_MEDIA_AGENT_HTTP_ADDR=0.0.0.0:8085" \
    -e "EVENTCAST_DB_PATH=/var/lib/eventcast/db/media-agent.sqlite3" \
    -e "EVENTCAST_SPOOL_ROOT=/var/lib/eventcast/spool" \
    -e "EVENTCAST_SRS_HLS_ROOT=/var/lib/eventcast/srs-output" \
    -v "${TMP_BASE}/db:/var/lib/eventcast/db" \
    -v "${TMP_BASE}/spool:/var/lib/eventcast/spool" \
    -v "${TMP_BASE}/srs-output:/var/lib/eventcast/srs-output" \
    "${seed_args[@]}" \
    "$MEDIA_AGENT_IMAGE" >/dev/null
}

# ---- 2. first run: seed, publish succeeds, clean unpublish -------------

log "2) starting media-agent WITH the seed file (first run)"
start_container with-seed
wait_ready "$PORT" 30

RESP1="$(try_publish "$PORT")"
echo "$RESP1" | grep -q '"code":0' || fail "expected the seeded assignment to authorize on_publish, got: $RESP1"
log "   on_publish accepted (assignment cache populated from seed)"
close_publish "$PORT"

# ---- 3. stop, back up the database directory ---------------------------

log "3) stopping the container for a consistent database copy"
$DOCKER stop "$CONTAINER" >/dev/null
$DOCKER rm "$CONTAINER" >/dev/null

log "   backing up ${TMP_BASE}/db -> ${TMP_BASE}/backup/db"
# Must run as root (matching backup.sh): the live database file is owned
# by the media-agent container's non-root UID, and only root can
# preserve that ownership across a copy (`cp -a` run as an unprivileged
# user instead silently reassigns ownership to the invoking user, which
# then leaves the copied file mode 644 - unwritable by the container's
# UID once restored, so the restarted container would fail to open its
# own database).
$SUDO cp -a "${TMP_BASE}/db/." "${TMP_BASE}/backup/db/"
[[ -f "${TMP_BASE}/backup/db/media-agent.sqlite3" ]] || fail "backup did not produce a database file"

# ---- 4. simulate data loss ----------------------------------------------

log "4) simulating data loss: removing the live database directory contents"
$SUDO rm -f "${TMP_BASE}/db/"*

# ---- 5. restore from backup ---------------------------------------------

log "5) restoring from backup"
$SUDO cp -a "${TMP_BASE}/backup/db/." "${TMP_BASE}/db/"

# ---- 6. restart WITHOUT the seed file and prove the assignment survived -

log "6) restarting WITHOUT the seed file (only the restored database can authorize this publish)"
start_container without-seed
wait_ready "$PORT" 30

RESP2="$(try_publish "$PORT")"
echo "$RESP2" | grep -q '"code":0' || fail "restored database did not authorize on_publish for the original assignment: $RESP2"
log "   on_publish accepted again post-restore with no seed file present: restore verified"
close_publish "$PORT"

log "all checks passed (run ${RUN_ID})"
