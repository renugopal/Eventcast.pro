# Media node deployment and rollback

This document is the concrete, script-level companion to `../08_OPERATIONS_RUNBOOK.md` "Deployment and rollback." It does not change any of that document's rules (canary first, one production node at a time, never simultaneously, preserve spool/SQLite data across rollback); it only describes the scripts in `compose/` that implement them.

## Scripts

| Script | Purpose | Default behavior |
|---|---|---|
| `compose/deploy.sh` | Validate environment, run preflight checks, start/update the persistent stack in dependency order, health-gate, and verify | **Dry run.** Prints every check and action; changes nothing until `--apply` |
| `compose/rollback.sh <image@sha256:digest>` | Restore a previous immutable media-agent image, preserving spool/SQLite data | **Dry run.** Prints what it would do; changes nothing until `--apply` |
| `compose/backup.sh <dest>` | Back up the SQLite database directory | **Dry run.** Changes nothing until `--apply` |
| `compose/restore-test.sh` | Isolated, non-production proof that a `backup.sh`-style backup actually restores | Always runs against throwaway temporary data; never touches production |
| `compose/image-reference-contract-test.sh` | Verify accepted and rejected Media Agent image-reference shapes | Local static check; no Docker, host, or network mutation |
| `compose/rollback-image-reference-contract-test.sh` | Verify rollback rejects mutable or malformed Media Agent image references | Local static check; no Docker, host, or network mutation |
| `compose/ownership-contract-test.sh` | Verify the deploy preflight accepts only the stated persistent-directory ownership/mode contracts | Local static check with command shims; no Docker daemon, host, or network mutation |

None of these scripts ever run `docker system prune`, `docker image prune`, `docker builder prune`, `docker container prune`, or any broad/wildcard deletion. Every destructive-shaped action (`rm`, `docker rm`, `docker rmi`) is scoped to an exact, script-owned path, container name, or image tag.

## `deploy.sh` checks, in order

1. **Environment validation** — the referenced `.env` file exists and contains required variables (`EVENTCAST_NODE_ID`, exactly one `MEDIA_AGENT_IMAGE`). The Media Agent image must be a lowercase `sha256` registry digest reference; tag-only, floating, malformed, missing, and duplicate values fail closed.
2. **Preflight** — never creates or chmods persistent host directories. It requires Media Agent spool/database directories to be `65532:65532`, mode `0750`. Deployment is currently blocked before Compose because the pinned SRS image's numeric runtime identity and safe shared-directory contract have not been proven from tracked evidence.
3. **Active-session safety check** — reads `media_agent_sessions{status="active"}` from the running agent's `/metrics` and refuses to proceed if any session is active, unless `--force` (matching the runbook's "deploy only when the node has no assigned critical event"). `--force` exists for a genuine emergency fix only.
4. **Compose config validation** — `docker compose config` must render cleanly before anything starts.
5. **Startup ordering and health gating** — `docker-compose.yml`'s own `depends_on: condition: service_healthy` already orders `srs` after `media-agent`; `deploy.sh` polls both containers' Docker healthcheck status and fails (suggesting `rollback.sh`) if either does not become healthy within `HEALTH_TIMEOUT_SECS` (default 90s).
6. **Post-deployment verification** — `GET /readyz` must return `200` before the script reports success.

## Provisional SRS shared-output contract

The unresolved-SRS sentence in the earlier script-order summary is superseded
by direct inspection evidence for the exact pinned SRS digest. `deploy.sh`
never creates, changes ownership of, or changes modes on persistent host
directories. It requires Media Agent spool/database directories to be
`65532:65532`, mode `0750`, and `SRS_OUTPUT_HOST_DIR` to be exactly `0:65532`,
mode `2750`.

The exact SRS image pinned by `docker-compose.yml` was separately inspected as
`ossrs/srs@sha256:4e293846ad2448ff1a0157aa2c694e7c451fff5046c93b5bc6da0fa0384ef998`.
Its configured user is empty and its default effective runtime identity is
`0:0`. The tracked Media Agent image declares `65532:65532`; its SRS-output
mount is read-only. Until the next evidence gate, provision the shared output
directory exactly as follows:

| Host path | Owner | Group | Mode | Access intent |
| --- | --- | --- | --- | --- |
| `SRS_OUTPUT_HOST_DIR` (default `/opt/eventcast/media-node/data/srs`) | UID `0` | GID `65532` | `2750` | SRS writes as owner; Media Agent can traverse/read through its shared group; no access for other users |

`2750` includes the set-group-ID bit so child entries retain group `65532`.
The exact pinned image was directly validated in an isolated synthetic-publish
test with the tracked HLS paths, `http_hooks` disabled only for isolation, and
the SRS command wrapper `umask 0027; exec ./objs/srs -c conf/eventcast.conf`.
It created directories as `0:65532` mode `2750` and playlists/segments as
`0:65532` mode `0640`; UID/GID `65532:65532` could read through the read-only
mount but could not write, no world permissions existed, and `SIGTERM` stopped
the exec-wrapped SRS process cleanly. `docker-compose.yml` uses that proven
wrapper. This removes the HLS-output ownership blocker only; immutable Media
Agent release, secret-safe configuration, deployment approval, and all other
deployment gates still apply.

## Immutable Media Agent image contract

`docker-compose.yml` has no default Media Agent image. A production
environment file must provide exactly one `MEDIA_AGENT_IMAGE` in the form
`<registry>/<repository>@sha256:<64-lowercase-hex>`. `deploy.sh` validates
that shape before it renders Compose, builds nothing, and never publishes an
image. Selecting a registry and publishing a tested Media Agent digest are
separate, explicitly authorized release steps.

The registry-neutral build, digest capture, manifest, checksum, and
rollback-record procedure is in `../../services/media-agent/RELEASE.md`.

The isolated integration scripts are deliberately outside this production
gate: they pass uniquely built local tags directly to Compose so they can
exercise the stack without a registry. They must never be used as a
production deployment path.

## Database migration

No separate migration step exists or is needed: the Media Agent applies every pending versioned migration in `services/media-agent/internal/store/migrations/*.sql` transactionally at its own startup (`internal/store.applyMigrations`), and this has always been true — it is safe to call on every restart, an already-fully-migrated database applies zero migrations, and the health gate above already waits for the container to report healthy, which only happens after `store.Open` (and therefore migration) succeeds.

## Rollback

`rollback.sh <previous-image@sha256:digest>` overrides `MEDIA_AGENT_IMAGE` for one `docker compose up -d media-agent` call, health-gates the result, and never touches `SPOOL_HOST_DIR`, `DB_HOST_DIR`, or `SRS_OUTPUT_HOST_DIR`. The previous image reference must pass the same immutable registry-digest validation as deployment; mutable tags and malformed values fail before Docker or environment-file access. A schema migration is always forward-compatible with the *previous* code as long as that previous code never depended on a column a newer migration removed — this repository's migrations are additive-only (`09_CLAUDE_CODE_EXECUTION_RULES.md` "Use additive, reviewed ... migrations. Do not edit an already-applied migration"), so a same-database rollback to an older image is safe by construction; a rollback across a *future* migration that ever needed to be non-additive would require its own tested backward-recovery plan, per `08_OPERATIONS_RUNBOOK.md`.

**Scope limitation:** `rollback.sh` only ever changes which media-agent *image* runs against the `docker-compose.yml` and `.env` currently checked out on the node. It does not check out or restore a previous *version of the Compose file or environment* from git history. If a past deployment's configuration differed structurally from what is currently checked out (e.g. a new required environment variable this rollback's compose file does not know how to fall back on), a true full-configuration rollback additionally requires checking out the matching git commit for `infra/media-node` before running this script - operators should not assume "rollback" restores anything beyond the container image.

Run `bash compose/rollback-image-reference-contract-test.sh` for the local
static rollback contract check.

## Production mutation safety

Both `deploy.sh` and `rollback.sh` default to printing their plan and exiting `0` without changing anything. Every default host path they read (`/opt/eventcast/media-node/...`) matches `docker-compose.yml`'s own defaults exactly, so a dry run against the real environment file shows exactly what a real deployment would do — but `--apply` is always required to actually do it. This satisfies the requirement to never automatically deploy over the existing persistent installation during development validation: every isolated validation run in this repository (`*-integration-test.sh`, `restore-test.sh`) uses its own uniquely-named temp directories, Compose projects, and container names instead of calling `deploy.sh` at all.
