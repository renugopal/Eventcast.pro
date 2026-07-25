#!/usr/bin/env bash
#
# Shared production Media Agent image-reference validation.
#
# This helper is intentionally pure: it reads no files, contacts no registry,
# and never prints the supplied reference. It is sourced by deploy.sh and by
# the local contract test.

validate_immutable_media_agent_image_reference() {
  local reference="${1-}"

  # The digest must be the identity used for production deployment. The image
  # name is deliberately not constrained to one registry so a future approved
  # registry choice does not require changing this validation rule.
  if [[ "$reference" =~ ^[^[:space:]@]+@sha256:[0-9a-f]{64}$ ]]; then
    return 0
  fi

  printf '%s\n' 'MEDIA_AGENT_IMAGE must be a non-empty registry image name followed by @sha256:<64-lowercase-hex>' >&2
  return 1
}
