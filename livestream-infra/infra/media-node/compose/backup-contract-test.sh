#!/usr/bin/env bash
#
# Local contract test for backup.sh's DB_HOST_DIR resolution.
#
# Covers the DB_HOST_DIR-absent bug found during a production preflight:
# backup.sh ran with `set -euo pipefail`, and its DB_DIR lookup piped
# `grep | tail | cut` into a plain assignment. When DB_HOST_DIR was simply
# absent from ENV_FILE (the normal, undocumented-as-required case),
# `grep` found no match, `pipefail` propagated that exit 1, and `set -e`
# terminated the script silently before its own documented fallback
# (`/opt/eventcast/media-node/data/db`) could ever apply. The fix reuses
# deploy.sh's already-tested `env_path_or_default` pattern.
#
# It uses temporary files plus a mock `docker` shim only: no Docker
# daemon, network, registry, host directory, or persistent file is
# accessed - the real /opt/eventcast/media-node/data/db path is never
# read from or written to by this test.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SCRIPT="$SCRIPT_DIR/backup.sh"
TMP_BASE="$(mktemp -d "${TMPDIR:-/tmp}/eventcast-backup-contract.XXXXXX")"
trap 'rm -rf "$TMP_BASE"' EXIT

MOCK_BIN="$TMP_BASE/bin"
mkdir -p "$MOCK_BIN"

# `docker info` succeeding (exit 0) matches running as root/in the docker
# group, so backup.sh's own SUDO stays empty and its `cp -a`/mkdir calls
# run as the invoking test user - no real privilege needed for this test.
# `docker ps --format {{.Names}}` returns no names, so backup.sh's own
# running-container check is always false here: the --apply case below
# never attempts to stop/start anything through Compose.
cat > "$MOCK_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  info) exit 0 ;;
  ps) exit 0 ;;
  *) printf 'unexpected docker invocation: %s\n' "$*" >&2; exit 1 ;;
esac
EOF
chmod +x "$MOCK_BIN/docker"

failures=0
SECRET_SENTINEL='TEST_SECRET_SENTINEL_DO_NOT_PRINT_9b2e14'

run_backup() {
  # Runs backup.sh under the mock docker and a per-call ENV_FILE, capturing
  # combined output and exit status without letting `set -e` here abort
  # the test on an expected-nonzero exit.
  local env_file="$1"; shift
  local status=0
  PATH="$MOCK_BIN:$PATH" ENV_FILE="$env_file" bash "$BACKUP_SCRIPT" "$@" \
    >"$TMP_BASE/output" 2>&1 || status=$?
  return "$status"
}

check_no_secret_leak() {
  local name="$1"
  if grep -qF "$SECRET_SENTINEL" "$TMP_BASE/output"; then
    printf '[backup-contract][FAIL] secret sentinel appeared in captured output: %s\n' "$name" >&2
    failures=$((failures + 1))
    return 1
  fi
  return 0
}

expect() {
  local name="$1" want_status="$2" want_substring="$3"
  local status
  status=0
  run_backup "${@:4}" || status=$?
  check_no_secret_leak "$name" || return

  if [[ "$status" -ne "$want_status" ]]; then
    printf '[backup-contract][FAIL] %s: exit %s, want %s\n' "$name" "$status" "$want_status" >&2
    sed 's/^/[backup-contract][output] /' "$TMP_BASE/output" >&2
    failures=$((failures + 1))
    return
  fi
  if ! grep -qF "$want_substring" "$TMP_BASE/output"; then
    printf '[backup-contract][FAIL] %s: output missing %q\n' "$name" "$want_substring" >&2
    sed 's/^/[backup-contract][output] /' "$TMP_BASE/output" >&2
    failures=$((failures + 1))
    return
  fi
  printf '[backup-contract][PASS] %s\n' "$name"
}

# ---- 1. DB_HOST_DIR absent -> documented default, dry run succeeds -------

env_no_db_dir="$TMP_BASE/no-db-dir.env"
cat > "$env_no_db_dir" <<EOF
EVENTCAST_NODE_ID=local-static-node
EVENTCAST_OPERATOR_API_TOKEN=$SECRET_SENTINEL
EOF
expect 'DB_HOST_DIR absent falls back to documented default (dry run)' 0 \
  '[backup] database directory: /opt/eventcast/media-node/data/db' \
  "$env_no_db_dir" "$TMP_BASE/dest-1"

# ---- 2. DB_HOST_DIR explicitly set -> that value is used ------------------

custom_db_dir="$TMP_BASE/custom-db"
mkdir -p "$custom_db_dir"
env_with_db_dir="$TMP_BASE/with-db-dir.env"
cat > "$env_with_db_dir" <<EOF
EVENTCAST_NODE_ID=local-static-node
DB_HOST_DIR=$custom_db_dir
EOF
expect 'explicit DB_HOST_DIR is used (dry run)' 0 \
  "[backup] database directory: $custom_db_dir" \
  "$env_with_db_dir" "$TMP_BASE/dest-2"

# ---- 3. malformed/unsupported arguments still fail as before --------------

expect 'no destination argument fails with usage' 2 \
  'usage: ' \
  "$env_with_db_dir"

expect 'unknown flag is rejected' 2 \
  'unknown argument: --bogus' \
  "$env_with_db_dir" "$TMP_BASE/dest-3" --bogus

# ---- 4. --apply behaviour is unchanged apart from DB_DIR resolution -------

printf 'fake sqlite contents\n' > "$custom_db_dir/media-agent.sqlite3"
apply_dest_base="$TMP_BASE/dest-apply"
expect '--apply copies the resolved DB_DIR and completes (no running container)' 0 \
  '[backup] backup complete:' \
  "$env_with_db_dir" "$apply_dest_base" --apply

copied_count="$(find "$apply_dest_base" -name 'media-agent.sqlite3' | wc -l)"
if [[ "$copied_count" -eq 1 ]]; then
  printf '[backup-contract][PASS] --apply copied the database file into the timestamped destination\n'
else
  printf '[backup-contract][FAIL] --apply did not copy the database file as expected (found %s)\n' "$copied_count" >&2
  failures=$((failures + 1))
fi

if [[ "$failures" -ne 0 ]]; then
  printf '[backup-contract] %d failure(s)\n' "$failures" >&2
  exit 1
fi

printf '[backup-contract] all checks passed\n'
