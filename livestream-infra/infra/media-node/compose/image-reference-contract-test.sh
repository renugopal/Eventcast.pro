#!/usr/bin/env bash
#
# Local static contract test for the production Media Agent image reference.
# No Docker daemon, network, registry, file mutation, or host path is used.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/validate-image-reference.sh
source "$SCRIPT_DIR/lib/validate-image-reference.sh"

failures=0

expect_accept() {
  local name="$1"
  local value="$2"
  if validate_immutable_media_agent_image_reference "$value" >/dev/null 2>&1; then
    printf '[image-reference-contract][PASS] %s\n' "$name"
  else
    printf '[image-reference-contract][FAIL] expected acceptance: %s\n' "$name" >&2
    failures=$((failures + 1))
  fi
}

expect_reject() {
  local name="$1"
  local value="$2"
  if validate_immutable_media_agent_image_reference "$value" >/dev/null 2>&1; then
    printf '[image-reference-contract][FAIL] expected rejection: %s\n' "$name" >&2
    failures=$((failures + 1))
  else
    printf '[image-reference-contract][PASS] %s\n' "$name"
  fi
}

digest="$(printf 'a%.0s' {1..64})"

expect_accept 'registry digest' "registry.example/eventcast/media-agent@sha256:${digest}"
expect_accept 'registry port digest' "registry.example:5000/team/media-agent@sha256:${digest}"
expect_reject 'missing value' ''
expect_reject 'floating latest tag' 'registry.example/eventcast/media-agent:latest'
expect_reject 'tag-only reference' 'registry.example/eventcast/media-agent:v1.2.3'
expect_reject 'short digest' 'registry.example/eventcast/media-agent@sha256:0123'
expect_reject 'uppercase digest' "registry.example/eventcast/media-agent@sha256:${digest^^}"
expect_reject 'unsupported digest algorithm' "registry.example/eventcast/media-agent@sha512:${digest}"
expect_reject 'whitespace' "registry.example/eventcast/media agent@sha256:${digest}"

if [[ "$failures" -ne 0 ]]; then
  printf '[image-reference-contract] %d failure(s)\n' "$failures" >&2
  exit 1
fi

printf '[image-reference-contract] all checks passed\n'
