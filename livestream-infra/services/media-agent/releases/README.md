# Media Agent release evidence

This directory contains no release evidence until GHCR has actually published
an immutable Media Agent image. Do not add placeholder releases, tags, digests,
checksums, or rollback references.

For each real release, add the non-secret `.release` manifest and its matching
`.release.sha256` checksum using the names and field order in
[`../RELEASE.md`](../RELEASE.md). The canonical `image_reference` must be the
registry-reported `ghcr.io/renugopal/eventcast-media-agent-private@sha256:<64-lowercase-hex>`
value, never a mutable tag.

The first release has no prior immutable Media Agent image and therefore omits
`previous_image_reference`. Every later release records its prior successful
immutable reference in that field, enabling a reviewed rollback candidate.

These files are release evidence, not credentials. Never place tokens, private
keys, node addresses, assignment data, environment values, or media URLs here.
