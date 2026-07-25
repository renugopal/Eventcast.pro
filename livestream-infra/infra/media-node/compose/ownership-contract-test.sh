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
EOF

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

expect_success() {
  local name="$1"
  shift
  if PATH="$MOCK_BIN:$PATH" ENV_FILE="$ENV_FILE" "$@" >"$TMP_BASE/output" 2>&1; then
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
  if PATH="$MOCK_BIN:$PATH" ENV_FILE="$ENV_FILE" "$@" >"$TMP_BASE/output" 2>&1; then
    printf '[ownership-contract][FAIL] expected failure: %s\n' "$name" >&2
    failures=$((failures + 1))
  elif grep -Fq "$expected" "$TMP_BASE/output"; then
    printf '[ownership-contract][PASS] %s\n' "$name"
  else
    printf '[ownership-contract][FAIL] wrong failure for: %s\n' "$name" >&2
    sed 's/^/[ownership-contract][output] /' "$TMP_BASE/output" >&2
    failures=$((failures + 1))
  fi
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

missing_srs="$TMP_BASE/missing-srs"
sed -i "s#^SRS_OUTPUT_HOST_DIR=.*#SRS_OUTPUT_HOST_DIR=$missing_srs#" "$ENV_FILE"
expect_failure 'SRS directory must already exist' 'SRS_OUTPUT_HOST_DIR must be pre-provisioned' bash "$DEPLOY_SCRIPT"

if [[ "$failures" -ne 0 ]]; then
  printf '[ownership-contract] %d failure(s)\n' "$failures" >&2
  exit 1
fi

printf '[ownership-contract] all checks passed\n'
