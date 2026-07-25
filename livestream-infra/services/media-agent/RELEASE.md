# Media Agent immutable release procedure

This is the authoritative local release contract for the Go EventCast Media
Agent. It prepares a future, separately authorized publication; it does not
create a package, authenticate, build, pull, push, deploy, or alter Git state.

## Inputs and identity

- **Registry:** GitHub Container Registry (GHCR).
- **Package:** `ghcr.io/renugopal/eventcast-media-agent`.
- **Initial visibility:** private. Package visibility and access are external
  owner-managed settings and are not changed by repository content.
- **Build context:** `livestream-infra/services/media-agent/`.
- **Dockerfile:** `livestream-infra/services/media-agent/Dockerfile`
- **Platform:** `linux/amd64` only. The Dockerfile explicitly builds
  `GOOS=linux GOARCH=amd64`; multi-platform publication is a separate change.
- **Release identity:** `v<major>.<minor>.<patch>-<12-lowercase-hex-source-sha>`.
  The version input is semantic version text such as `v1.2.0`; the workflow
  derives the suffix from the checked-out committed source SHA.
- **Production identity:**
  `ghcr.io/renugopal/eventcast-media-agent@sha256:<64-lowercase-hex>`.

The tag is a human discovery label only. `compose/deploy.sh` and
`compose/rollback.sh` accept only the production identity, never a tag.

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
   workflow run with a semantic-version input. A future run must be based on a
   reviewed committed revision; it must not use a dirty local worktree.
2. The workflow runs Go formatting, vet, build, and tests using the already
   pinned Go image before a release job can publish.
3. The release job uses only the GitHub Actions-generated `GITHUB_TOKEN` with
   `contents: read` and `packages: write`. It does not use a local PAT. The
   token is provided to Docker login through the action secret channel and is
   never echoed or written to an artifact.
4. The workflow builds and pushes the single `linux/amd64` tag, then validates
   the returned canonical digest with registry manifest inspection.
5. It creates a non-secret release manifest/checksum artifact. A separately
   approved repository change may later add the real evidence files under
   `releases/`; the workflow has only read permission for repository contents
   and cannot commit them.
6. VM registry login, immutable-digest pull/verification, Compose preflight,
   and deployment remain separate approvals. For the initial private package,
   the VM needs separately approved minimum `read:packages` access through a
   secret-safe mechanism.

## Release manifest

For each actually published release, create these two non-secret files under
`releases/`:

```text
eventcast-media-agent-<version>-<short-source-sha>.release
eventcast-media-agent-<version>-<short-source-sha>.release.sha256
```

The `.release` file has these required fields, in this order:

```text
format=eventcast-media-agent-release-v1
version=<vmajor.minor.patch-short-source-sha>
source_commit=<full-40-lowercase-hex>
image_reference=ghcr.io/renugopal/eventcast-media-agent@sha256:<64-lowercase-hex>
dockerfile_sha256=<64-lowercase-hex>
```

For every release after the first, append this required immutable rollback
record:

```text
previous_image_reference=ghcr.io/renugopal/eventcast-media-agent@sha256:<64-lowercase-hex>
```

The first release omits `previous_image_reference`; it must not invent a
rollback digest.

Create a detached checksum beside it:

```text
sha256sum eventcast-media-agent-<version>-<short-source-sha>.release > eventcast-media-agent-<version>-<short-source-sha>.release.sha256
```

No placeholder manifest, checksum, tag, or digest is committed before a real
registry publication. The manifest and checksum contain image and file
checksums, never credentials, registry tokens, node URLs, assignment data, or
media secrets.

## Verification and rollback

Before deployment, compare the manifest's `image_reference` with the
registry-reported canonical digest and run:

```text
bash infra/media-node/compose/image-reference-contract-test.sh
bash infra/media-node/compose/rollback-image-reference-contract-test.sh
```

For rollback, use `previous_image_reference` from the later successful release
manifest. Run `rollback.sh <prior-reference>` without `--apply` first, and use
`--apply` only under separate deployment approval. The rollback script rejects
tags, malformed references, and non-lowercase SHA-256 digests. It does not
restore a previous Compose file or environment file; use the matching reviewed
configuration release when that is required.
