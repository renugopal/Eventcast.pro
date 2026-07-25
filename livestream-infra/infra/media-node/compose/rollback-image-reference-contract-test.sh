#!/usr/bin/env bash
#
# Local static contract test for rollback's immutable Media Agent image gate.
# It uses no Docker daemon, registry, network, environment file, or host path.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
digest="$(printf 'b%.0s' {1..64})"
failures=0

expect_reject() {
  local name="$1"
  local reference="$2"

  if ENV_FILE="${SCRIPT_DIR}/does-not-exist" bash "$SCRIPT_DIR/rollback.sh" "$reference" >/dev/null 2>&1; then
    printf '[rollback-image-reference-contract][FAIL] expected rejection: %s\n' "$name" >&2
    failures=$((failures + 1))
  else
    printf '[rollback-image-reference-contract][PASS] %s\n' "$name"
  fi
}

expect_reject 'floating tag' 'registry.example/eventcast/media-agent:latest'
expect_reject 'short digest' 'registry.example/eventcast/media-agent@sha256:0123'
expect_reject 'uppercase digest' "registry.example/eventcast/media-agent@sha256:${digest^^}"

# A valid reference must pass the rollback image gate, then stop at the
# deliberately missing non-secret test environment file before Docker access.
valid_output="$(ENV_FILE="${SCRIPT_DIR}/does-not-exist" bash "$SCRIPT_DIR/rollback.sh" "registry.example/eventcast/media-agent@sha256:${digest}" 2>&1 || true)"
if printf '%s\n' "$valid_output" | grep -Fq 'env file not found:'; then
  printf '[rollback-image-reference-contract][PASS] valid immutable digest reaches later preflight\n'
else
  printf '[rollback-image-reference-contract][FAIL] valid immutable digest did not reach the environment preflight\n' >&2
  failures=$((failures + 1))
fi

if [[ "$failures" -ne 0 ]]; then
  printf '[rollback-image-reference-contract] %d failure(s)\n' "$failures" >&2
  exit 1
fi

printf '[rollback-image-reference-contract] all checks passed\n'
