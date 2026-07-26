#!/usr/bin/env bash
# validate-release-evidence.sh <releases-dir>
#
# Validates every committed release manifest in <releases-dir>.
# Exits 1 on any failure (fail-closed).
#
# Prints exactly two lines on stdout on success:
#   image_reference=<latest approved image_reference>
#   version_tag=<latest approved version>
set -euo pipefail

RELEASES_DIR="${1:?usage: validate-release-evidence.sh <releases-dir>}"
APPROVED_PACKAGE="ghcr.io/renugopal/eventcast-media-agent-private"
readonly V1_FIELDS=(format version source_commit image_reference dockerfile_sha256)
readonly V2_FIELDS=(format version source_commit image_reference \
                    dockerfile_sha256 platform workflow_run_url previous_image_reference)

cd "$RELEASES_DIR"

# ── Phase 1: inventory checks ─────────────────────────────────────────────────

# Reject orphan .sha256 files (no matching .release).
shopt -s nullglob
for sha_f in *.sha256; do
  [[ "$sha_f" == *.release.sha256 ]] || {
    echo "unexpected .sha256 file (not *.release.sha256): $sha_f" >&2; exit 1
  }
  manifest="${sha_f%.sha256}"
  [[ -f "$manifest" ]] || {
    echo "orphan checksum (no matching manifest): $sha_f" >&2; exit 1
  }
done
shopt -u nullglob

# Collect every *.release file in the directory.
shopt -s nullglob
all_release_files=(*.release)
shopt -u nullglob
[[ "${#all_release_files[@]}" -gt 0 ]] || {
  echo "no .release files found in ${RELEASES_DIR}" >&2; exit 1
}

# ── Phase 2: per-file validation ──────────────────────────────────────────────

declare -A semver_to_file=()

for f in "${all_release_files[@]}"; do

  # 1. Validate filename against the naming contract before reading any content.
  [[ "$f" =~ ^eventcast-media-agent-v[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{12}\.release$ ]] || {
    echo "rejected: filename does not match naming contract: $f" >&2; exit 1
  }

  # 2. Matching checksum file must exist.
  [[ -f "${f}.sha256" ]] || {
    echo "missing checksum file: ${f}.sha256" >&2; exit 1
  }

  # 3. Validate checksum file: must contain exactly one line in the correct format.
  mapfile -t sha_lines < "${f}.sha256"
  [[ "${#sha_lines[@]}" -eq 1 ]] || {
    printf 'checksum file must contain exactly one line: %s (got %d)\n' \
      "${f}.sha256" "${#sha_lines[@]}" >&2
    exit 1
  }
  sha_line="${sha_lines[0]}"

  # Reject CRLF in checksum line.
  [[ "$sha_line" != *$'\r'* ]] || {
    echo "CRLF in checksum file: ${f}.sha256" >&2; exit 1
  }

  # Must be: 64 lowercase hex + two spaces + exact manifest basename.
  sha_hash="${sha_line%  *}"
  sha_name="${sha_line##*  }"
  [[ "$sha_hash" =~ ^[0-9a-f]{64}$ ]] || {
    printf 'malformed digest in %s (expected 64 lowercase hex): %s\n' \
      "${f}.sha256" "$sha_hash" >&2
    exit 1
  }
  [[ "$sha_name" == "$f" ]] || {
    printf 'checksum file references wrong filename in %s:\n  expected: %s\n  got:      %s\n' \
      "${f}.sha256" "$f" "$sha_name" >&2
    exit 1
  }

  # 4. Verify checksum integrity.
  sha256sum --check --strict --quiet "${f}.sha256" || {
    echo "checksum verification failed for: $f" >&2; exit 1
  }

  # 5. Parse manifest — reject blank lines, CRLF, malformed lines, empty values, duplicate keys.
  declare -a field_order=()
  declare -A field_map=()
  while IFS= read -r line; do
    [[ "$line" != *$'\r'* ]] || {
      echo "CRLF character in manifest: $f" >&2; exit 1
    }
    [[ -n "$line" ]] || {
      echo "blank line in manifest: $f" >&2; exit 1
    }
    [[ "$line" == *=* ]] || {
      printf "malformed line (no '='): '%s' in %s\n" "$line" "$f" >&2; exit 1
    }
    key="${line%%=*}"
    val="${line#*=}"
    [[ -n "$key" ]] || { echo "empty key in: $f" >&2; exit 1; }
    [[ -n "$val" ]] || { printf "empty value for key '%s' in: %s\n" "$key" "$f" >&2; exit 1; }
    [[ -z "${field_map[$key]+_}" ]] || {
      printf "duplicate field '%s' in: %s\n" "$key" "$f" >&2; exit 1
    }
    field_order+=("$key")
    field_map["$key"]="$val"
  done < "$f"

  # 6. Determine schema version and expected field list.
  frmt="${field_map[format]:-}"
  case "$frmt" in
    "eventcast-media-agent-release-v1") expected_fields=("${V1_FIELDS[@]}") ;;
    "eventcast-media-agent-release-v2") expected_fields=("${V2_FIELDS[@]}") ;;
    *) printf "unknown format '%s' in: %s\n" "$frmt" "$f" >&2; exit 1 ;;
  esac

  # 7. Exact field count.
  [[ "${#field_order[@]}" -eq "${#expected_fields[@]}" ]] || {
    printf 'wrong field count in %s: expected %d, got %d\n' \
      "$f" "${#expected_fields[@]}" "${#field_order[@]}" >&2
    exit 1
  }

  # 8. Exact field names in exact order.
  for i in "${!expected_fields[@]}"; do
    [[ "${field_order[$i]}" == "${expected_fields[$i]}" ]] || {
      printf 'field order mismatch in %s at position %d:\n  expected: %s\n  got:      %s\n' \
        "$f" "$i" "${expected_fields[$i]}" "${field_order[$i]}" >&2
      exit 1
    }
  done

  ver="${field_map[version]}"
  src="${field_map[source_commit]}"
  img="${field_map[image_reference]}"
  dsha="${field_map[dockerfile_sha256]}"

  # 9. version format: v<major>.<minor>.<patch>-<12-hex>
  [[ "$ver" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{12}$ ]] || {
    printf "malformed version '%s' in: %s\n" "$ver" "$f" >&2; exit 1
  }

  # 10. source_commit: 40 lowercase hex
  [[ "$src" =~ ^[0-9a-f]{40}$ ]] || {
    echo "malformed source_commit in: $f" >&2; exit 1
  }

  # 11. Cross-field: version suffix must equal source_commit[:12].
  ver_suffix="${ver##*-}"
  [[ "${src:0:12}" == "$ver_suffix" ]] || {
    printf 'version suffix does not match source_commit prefix in: %s\n  version suffix:     %s\n  source_commit[:12]: %s\n' \
      "$f" "$ver_suffix" "${src:0:12}" >&2
    exit 1
  }

  # 12. image_reference: approved package + sha256 digest
  [[ "$img" =~ ^${APPROVED_PACKAGE}@sha256:[0-9a-f]{64}$ ]] || {
    printf "malformed image_reference '%s' in: %s\n" "$img" "$f" >&2; exit 1
  }

  # 13. dockerfile_sha256: 64 lowercase hex
  [[ "$dsha" =~ ^[0-9a-f]{64}$ ]] || {
    echo "malformed dockerfile_sha256 in: $f" >&2; exit 1
  }

  # 14. v2-specific field validation.
  if [[ "$frmt" == "eventcast-media-agent-release-v2" ]]; then
    plat="${field_map[platform]}"
    run_url="${field_map[workflow_run_url]}"
    prev="${field_map[previous_image_reference]}"

    [[ "$plat" == "linux/amd64" ]] || {
      printf "unexpected platform '%s' in: %s\n" "$plat" "$f" >&2; exit 1
    }
    [[ "$run_url" =~ ^https://github\.com/renugopal/Eventcast\.pro/actions/runs/[0-9]+$ ]] || {
      echo "malformed workflow_run_url in: $f" >&2; exit 1
    }
    [[ "$prev" =~ ^${APPROVED_PACKAGE}@sha256:[0-9a-f]{64}$ ]] || {
      echo "malformed previous_image_reference in: $f" >&2; exit 1
    }
  fi

  # 15. Filename must equal eventcast-media-agent-<version>.release.
  expected_name="eventcast-media-agent-${ver}.release"
  [[ "$f" == "$expected_name" ]] || {
    printf "filename '%s' does not match version field (expected '%s')\n" "$f" "$expected_name" >&2
    exit 1
  }

  # 16. Deduplication: no two files may share the same semantic version.
  semver="${ver%-*}"
  [[ -z "${semver_to_file[$semver]+_}" ]] || {
    printf "duplicate semantic version %s: '%s' and '%s'\n" \
      "$semver" "${semver_to_file[$semver]}" "$f" >&2
    exit 1
  }
  semver_to_file["$semver"]="$f"

  # Reset per-file arrays for the next iteration.
  unset field_order field_map
  declare -a field_order=()
  declare -A field_map=()
done

# ── Phase 3: select the highest semantic version ──────────────────────────────

[[ "${#semver_to_file[@]}" -gt 0 ]] || {
  echo "no valid release manifests found" >&2; exit 1
}

latest_semver="$(printf '%s\n' "${!semver_to_file[@]}" | sort -V | tail -1)"
latest_file="${semver_to_file[$latest_semver]}"
latest_image_ref="$(grep '^image_reference=' "$latest_file" | cut -d= -f2-)"
latest_version="$(grep '^version=' "$latest_file" | cut -d= -f2-)"

# ── Phase 4: emit output ──────────────────────────────────────────────────────

printf 'image_reference=%s\n' "$latest_image_ref"
printf 'version_tag=%s\n' "$latest_version"
