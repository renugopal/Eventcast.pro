# Media Agent immutable release procedure

This is the authoritative local release contract for the Go EventCast Media
Agent. It prepares a future, separately authorized publication; it does not
create a package, authenticate, build, pull, push, deploy, or alter Git state.

## Inputs and identity

- **Registry:** GitHub Container Registry (GHCR).
- **Package:** `ghcr.io/renugopal/eventcast-media-agent-private`.
- **Visibility:** private. The package was established as private manually
  after the first bootstrap publish. The release workflow requires the package
  to already exist with private visibility. The former
  `ghcr.io/renugopal/eventcast-media-agent` package is public, permanently
  excluded from deployment, and must never be used as a release or rollback
  reference.
- **Build context:** `livestream-infra/services/media-agent/`.
- **Dockerfile:** `livestream-infra/services/media-agent/Dockerfile`
- **Platform:** `linux/amd64` only. The Dockerfile explicitly builds
  `GOOS=linux GOARCH=amd64`; multi-platform publication is a separate change.
- **Release identity:** `v<major>.<minor>.<patch>-<12-lowercase-hex-source-sha>`.
  The version input is semantic version text such as `v1.2.0`; the workflow
  derives the suffix from the checked-out committed source SHA.
- **Production identity:**
  `ghcr.io/renugopal/eventcast-media-agent-private@sha256:<64-lowercase-hex>`.

The tag is a human discovery label only. `compose/deploy.sh` and
`compose/rollback.sh` accept only the production identity, never a tag.

## Bootstrap and chain anchor

The first publish was a manual bootstrap event. See `BOOTSTRAP.md` for the
full record. The committed v1.0.0 evidence
(`releases/eventcast-media-agent-v1.0.0-1e6142d9b5b1.release`) is the chain
anchor: its `image_reference` is the value required as `previous_image_reference`
for the v1.0.1 release run. That file must never be modified.

## Clean committed-source rule

The manual workflow at `.github/workflows/media-agent-release.yml` checks out
its triggering commit and fails unless that checkout is clean, has no
untracked files, and resolves exactly to `GITHUB_SHA`. It has no input that can
replace the source revision. This prevents a release from incorporating a
local workspace change, such as an untracked operational script.

The `.dockerignore` is an allowlist. Only Go module metadata plus `cmd/` and
`internal/` source enter the build context. Environment files, documentation,
release evidence, operational scripts, and all other local/untracked material
are excluded from all build stages.

## Reproducible build inputs

The release records and validates these non-secret inputs:

1. full checked-out source SHA;
2. semantic version and derived release identity;
3. SHA-256 of this Dockerfile;
4. `go.mod` and `go.sum` present in the allowlisted context;
5. exact digest-pinned FFmpeg, Go builder, and distroless runtime base images;
6. `linux/amd64`; and
7. build flags `-trimpath`, `-buildvcs=false`, and `-mod=readonly`.

The final image carries only OCI source, revision, and version labels. No
credential, token, secret, environment value, node address, assignment, or
media URL may be passed as a build argument, label, artifact field, or log.

## Authorized release sequence

1. Review and commit the release-preparation source, then approve a manual
   workflow run with a semantic-version input and a `previous_image_reference`
   input. Both inputs are required. `previous_image_reference` must be the
   `image_reference` value from the latest committed `.release` manifest in
   `releases/`. A future run must be based on a reviewed committed revision; it
   must not use a dirty local worktree.
2. The workflow validates the branch (`main` only), source cleanliness,
   `previous_image_reference` format, and the full committed evidence chain
   before any build or publish step runs.
3. The workflow runs Go formatting, vet, build, and tests using the already
   pinned Go image before the publish job can proceed.
4. The publish job uses only the GitHub Actions-generated `GITHUB_TOKEN` with
   `contents: read` and `packages: write`. It does not use a local PAT. The
   token is provided to Docker login through the action secret channel and is
   never echoed or written to an artifact.
5. Before the push, the workflow requires the package to already exist (HTTP
   200), to have `container` type, `private` visibility, and the correct
   repository linkage. It also confirms the proposed release tag is absent from
   GHCR, and that the `previous_image_reference` corresponds to an active,
   tagged GHCR version object.
6. After the push, the workflow re-confirms package metadata (HTTP 200,
   private, correct linkage), confirms tag-to-digest identity on the same
   version object (with bounded retry for GHCR propagation), and verifies OCI
   labels and platform. Any failure after the push but before evidence creation
   is a partial-publish condition — investigate before the next run.
7. The workflow creates a non-secret release manifest/checksum artifact. A
   separately approved repository change may later add the real evidence files
   under `releases/`; the workflow has only read permission for repository
   contents and cannot commit them.
8. VM registry login, immutable-digest pull/verification, Compose preflight,
   and deployment remain separate approvals.

## Release manifest schemas

### v1 — bootstrap-only (v1.0.0, committed, immutable)

`format=eventcast-media-agent-release-v1` — exactly five fields in this order:

```text
format=eventcast-media-agent-release-v1
version=<vmajor.minor.patch-12-hex>
source_commit=<full-40-lowercase-hex>
image_reference=ghcr.io/renugopal/eventcast-media-agent-private@sha256:<64-lowercase-hex>
dockerfile_sha256=<64-lowercase-hex>
```

Used exclusively for v1.0.0. Must never be modified. The v1 schema is not used
for any release after v1.0.0.

### v2 — all future releases

`format=eventcast-media-agent-release-v2` — exactly eight fields in this order:

```text
format=eventcast-media-agent-release-v2
version=<vmajor.minor.patch-12-hex>
source_commit=<full-40-lowercase-hex>
image_reference=ghcr.io/renugopal/eventcast-media-agent-private@sha256:<64-lowercase-hex>
dockerfile_sha256=<64-lowercase-hex>
platform=linux/amd64
workflow_run_url=https://github.com/renugopal/Eventcast.pro/actions/runs/<run-id>
previous_image_reference=ghcr.io/renugopal/eventcast-media-agent-private@sha256:<64-lowercase-hex>
```

All eight fields are always present. `previous_image_reference` is always the
final field. There is no conditional or optional field in v2.

## Adding committed release evidence

For each actually published release, add these two non-secret files to
`releases/` in a separately approved commit:

```text
eventcast-media-agent-<version>-<short-source-sha>.release
eventcast-media-agent-<version>-<short-source-sha>.release.sha256
```

Copy the manifest from the workflow artifact. Verify the checksum matches:

```bash
sha256sum --check --strict eventcast-media-agent-<version>-<short-source-sha>.release.sha256
```

The manifest file must pass `scripts/validate-release-evidence.sh releases/`
before committing. No placeholder manifest, checksum, tag, or digest is
committed before a real registry publication.

The manifest and checksum files contain image and file checksums, never
credentials, registry tokens, node URLs, assignment data, or media secrets.

## Verification and rollback

Before deployment, compare the manifest's `image_reference` with the
registry-reported canonical digest and run:

```bash
bash infra/media-node/compose/image-reference-contract-test.sh
bash infra/media-node/compose/rollback-image-reference-contract-test.sh
```

For rollback, use `previous_image_reference` from the later successful release
manifest. Run `rollback.sh <prior-reference>` without `--apply` first, and use
`--apply` only under separate deployment approval. The rollback script rejects
tags, malformed references, and non-lowercase SHA-256 digests. It does not
restore a previous Compose file or environment file; use the matching reviewed
configuration release when that is required.

## Failure handling

| Failure point | Image pushed? | Evidence generated? | Required action |
|---|---|---|---|
| Any pre-publish gate (R-1 through P-6) | No | No | Fix condition, re-dispatch |
| Post-publish metadata regression (Q-1) | Yes | No | Investigate visibility; manual review |
| Tag-to-digest identity, all retries exhausted (Q-2) | Yes | No | Investigate GHCR; partial-push condition |
| OCI label or platform mismatch (Q-3) | Yes | No | Image invalid for release; investigate build |
| All gates pass | Yes | Yes | Commit evidence under separate approval |

A partially pushed image is never represented as an approved release.
