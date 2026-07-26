#!/usr/bin/env bash
#
# Local contract test for deploy.sh persistent-directory preflight checks.
# It uses temporary files plus command shims only: no Docker daemon, network,
# registry, host directory, or persistent file is accessed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy.sh"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
TMP_BASE="$(mktemp -d "${TMPDIR:-/tmp}/eventcast-ownership-contract.XXXXXX")"
trap 'rm -rf "$TMP_BASE"' EXIT

MOCK_BIN="$TMP_BASE/bin"
ENV_FILE="$TMP_BASE/test.env"
mkdir -p "$MOCK_BIN" "$TMP_BASE/spool" "$TMP_BASE/db" "$TMP_BASE/srs"

cat > "$ENV_FILE" <<EOF
EVENTCAST_NODE_ID=local-static-node
MEDIA_AGENT_IMAGE=registry.invalid/eventcast/media-agent@sha256:$(printf 'c%.0s' {1..64})
SPOOL_HOST_DIR=$TMP_BASE/spool
DB_HOST_DIR=$TMP_BASE/db
SRS_OUTPUT_HOST_DIR=$TMP_BASE/srs
MEDIA_AGENT_HTTP_HOST_BIND=127.0.0.1:8085
EVENTCAST_OPERATOR_API_TOKEN=TEST_SECRET_SENTINEL_DO_NOT_PRINT_7f4c91
EOF

# Resolved from the real (not-yet-mocked) PATH, before MOCK_BIN is prepended
# anywhere below - the grep shim embeds this fixed absolute path rather than
# doing any PATH-based lookup at run time, so it cannot recursively invoke
# itself.
REAL_GREP="$(command -v grep)"
cat > "$MOCK_BIN/grep" <<EOF
#!/usr/bin/env bash
# Transparent passthrough to the real grep, except: when
# SIMULATE_GREP_ERROR_FOR names an exact argument this invocation received,
# simulate a real read/parse failure (exit 2, no output) instead of running
# grep at all. Scoped to one call so other deploy.sh grep invocations are
# unaffected, and independent of filesystem permissions (root-proof).
if [[ -n "\${SIMULATE_GREP_ERROR_FOR:-}" ]]; then
  for arg in "\$@"; do
    [[ "\$arg" == "\$SIMULATE_GREP_ERROR_FOR" ]] && exit 2
  done
fi
exec "$REAL_GREP" "\$@"
EOF
chmod +x "$MOCK_BIN/grep"

cat > "$MOCK_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  info|compose) exit 0 ;;
  ps) printf 'eventcast-media-agent\n'; exit 0 ;;
  *) printf 'unexpected docker invocation: %s\n' "$*" >&2; exit 1 ;;
esac
EOF

cat > "$MOCK_BIN/stat" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
format="${2:-}"
path="${3:-}"
case "$(basename "$path"):$format" in
  spool:%u:%g|db:%u:%g) printf '65532:65532\n' ;;
  spool:%a|db:%a) printf '750\n' ;;
  srs:%u:%g) printf '%s\n' "${SRS_OWNER:-0:65532}" ;;
  srs:%a) printf '%s\n' "${SRS_MODE:-2750}" ;;
  *) printf 'unexpected stat invocation: %s\n' "$*" >&2; exit 1 ;;
esac
EOF

cat > "$MOCK_BIN/df" <<'EOF'
#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf 'mockfs 100 1 99 1%% /\n'
EOF
cat > "$MOCK_BIN/curl" <<'EOF'
#!/usr/bin/env bash
# An empty metrics body makes deploy.sh's existing awk expression report zero.
exit 0
EOF
chmod +x "$MOCK_BIN/docker" "$MOCK_BIN/stat" "$MOCK_BIN/df" "$MOCK_BIN/curl"

failures=0
SECRET_SENTINEL='TEST_SECRET_SENTINEL_DO_NOT_PRINT_7f4c91'

expect_success() {
  local name="$1"
  shift
  local primary_ok=1
  if PATH="$MOCK_BIN:$PATH" ENV_FILE="$ENV_FILE" "$@" >"$TMP_BASE/output" 2>&1; then
    primary_ok=0
  fi

  # Sentinel check runs first, before any branch below is allowed to dump
  # captured output. If the secret leaked, no dump ever happens for this
  # invocation, regardless of whether the primary expectation also failed.
  if grep -qF "$SECRET_SENTINEL" "$TMP_BASE/output"; then
    printf '[ownership-contract][FAIL] secret sentinel appeared in captured output: %s\n' "$name" >&2
    failures=$((failures + 1))
    if [[ "$primary_ok" -ne 0 ]]; then
      printf '[ownership-contract][FAIL] expected success: %s (diagnostic output withheld: secret sentinel present)\n' "$name" >&2
      failures=$((failures + 1))
    fi
    return
  fi

  if [[ "$primary_ok" -eq 0 ]]; then
    printf '[ownership-contract][PASS] %s\n' "$name"
  else
    printf '[ownership-contract][FAIL] expected success: %s\n' "$name" >&2
    sed 's/^/[ownership-contract][output] /' "$TMP_BASE/output" >&2
    failures=$((failures + 1))
  fi
}

expect_failure() {
  local name="$1"
  local expected="$2"
  shift 2
  local primary_status
  if PATH="$MOCK_BIN:$PATH" ENV_FILE="$ENV_FILE" "$@" >"$TMP_BASE/output" 2>&1; then
    primary_status=success   # command unexpectedly succeeded
  elif grep -Fq "$expected" "$TMP_BASE/output"; then
    primary_status=match
  else
    primary_status=mismatch
  fi

  # Sentinel check runs first, before any branch below is allowed to dump
  # captured output.
  if grep -qF "$SECRET_SENTINEL" "$TMP_BASE/output"; then
    printf '[ownership-contract][FAIL] secret sentinel appeared in captured output: %s\n' "$name" >&2
    failures=$((failures + 1))
    case "$primary_status" in
      match) ;; # the expected-substring check itself passed; only the leak is a problem
      success)
        printf '[ownership-contract][FAIL] expected failure: %s (diagnostic output withheld: secret sentinel present)\n' "$name" >&2
        failures=$((failures + 1))
        ;;
      mismatch)
        printf '[ownership-contract][FAIL] wrong failure for: %s (diagnostic output withheld: secret sentinel present)\n' "$name" >&2
        failures=$((failures + 1))
        ;;
    esac
    return
  fi

  case "$primary_status" in
    success)
      printf '[ownership-contract][FAIL] expected failure: %s\n' "$name" >&2
      failures=$((failures + 1))
      ;;
    match)
      printf '[ownership-contract][PASS] %s\n' "$name"
      ;;
    mismatch)
      printf '[ownership-contract][FAIL] wrong failure for: %s\n' "$name" >&2
      sed 's/^/[ownership-contract][output] /' "$TMP_BASE/output" >&2
      failures=$((failures + 1))
      ;;
  esac
}

if grep -Eq '^[[:space:]]*(\$SUDO[[:space:]]+)?(mkdir|chmod|chown)([[:space:]]|$)' "$DEPLOY_SCRIPT"; then
  printf '[ownership-contract][FAIL] deploy.sh contains a persistent-directory mutation command\n' >&2
  failures=$((failures + 1))
else
  printf '[ownership-contract][PASS] deploy.sh has no persistent-directory mutation command\n'
fi

if grep -Fq 'command: ["/bin/sh", "-c", "umask 0027; exec ./objs/srs -c conf/eventcast.conf"]' "$COMPOSE_FILE"; then
  printf '[ownership-contract][PASS] SRS uses the validated umask 0027 exec wrapper\n'
else
  printf '[ownership-contract][FAIL] SRS umask 0027 exec wrapper is missing\n' >&2
  failures=$((failures + 1))
fi

expect_success 'exact provisional SRS contract' bash "$DEPLOY_SCRIPT"
expect_failure 'SRS owner must be root:65532' 'SRS_OUTPUT_HOST_DIR must be owned by 0:65532' env SRS_OWNER='65532:65532' bash "$DEPLOY_SCRIPT"
expect_failure 'SRS mode must be 2750' 'SRS_OUTPUT_HOST_DIR must have mode 2750' env SRS_MODE='2755' bash "$DEPLOY_SCRIPT"

absent_spool_env="$TMP_BASE/absent-spool.env"
grep -v '^SPOOL_HOST_DIR=' "$ENV_FILE" > "$absent_spool_env"
expect_failure 'absent SPOOL_HOST_DIR falls back to documented default' \
  'SPOOL_HOST_DIR must be pre-provisioned' \
  env ENV_FILE="$absent_spool_env" bash "$DEPLOY_SCRIPT"

expect_failure 'grep exit >=2 on SPOOL_HOST_DIR lookup is surfaced' \
  'failed to read SPOOL_HOST_DIR from' \
  env SIMULATE_GREP_ERROR_FOR='^SPOOL_HOST_DIR=' bash "$DEPLOY_SCRIPT"

missing_node_id_env="$TMP_BASE/missing-node-id.env"
grep -v '^EVENTCAST_NODE_ID=' "$ENV_FILE" > "$missing_node_id_env"
expect_failure 'required EVENTCAST_NODE_ID absence still fails closed' \
  'required variable EVENTCAST_NODE_ID is missing or empty' \
  env ENV_FILE="$missing_node_id_env" bash "$DEPLOY_SCRIPT"

missing_srs="$TMP_BASE/missing-srs"
sed -i "s#^SRS_OUTPUT_HOST_DIR=.*#SRS_OUTPUT_HOST_DIR=$missing_srs#" "$ENV_FILE"
expect_failure 'SRS directory must already exist' 'SRS_OUTPUT_HOST_DIR must be pre-provisioned' bash "$DEPLOY_SCRIPT"

if [[ "$failures" -ne 0 ]]; then
  printf '[ownership-contract] %d failure(s)\n' "$failures" >&2
  exit 1
fi

printf '[ownership-contract] all checks passed\n'
