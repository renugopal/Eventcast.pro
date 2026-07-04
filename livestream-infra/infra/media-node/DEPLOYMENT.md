# Media node deployment and rollback

This document is the concrete, script-level companion to `../08_OPERATIONS_RUNBOOK.md` "Deployment and rollback." It does not change any of that document's rules (canary first, one production node at a time, never simultaneously, preserve spool/SQLite data across rollback); it only describes the scripts in `compose/` that implement them.

## Scripts

| Script | Purpose | Default behavior |
|---|---|---|
| `compose/deploy.sh` | Validate environment, run preflight checks, start/update the persistent stack in dependency order, health-gate, and verify | **Dry run.** Prints every check and action; changes nothing until `--apply` |
| `compose/rollback.sh <image>` | Restore a previous pinned media-agent image, preserving spool/SQLite data | **Dry run.** Prints what it would do; changes nothing until `--apply` |
| `compose/backup.sh <dest>` | Back up the SQLite database directory | **Dry run.** Changes nothing until `--apply` |
| `compose/restore-test.sh` | Isolated, non-production proof that a `backup.sh`-style backup actually restores | Always runs against throwaway temporary data; never touches production |

None of these scripts ever run `docker system prune`, `docker image prune`, `docker builder prune`, `docker container prune`, or any broad/wildcard deletion. Every destructive-shaped action (`rm`, `docker rm`, `docker rmi`) is scoped to an exact, script-owned path, container name, or image tag.

## `deploy.sh` checks, in order

1. **Environment validation** — the referenced `.env` file exists and contains required variables (`EVENTCAST_NODE_ID`); refuses a floating `:latest` image tag.
2. **Preflight** — creates any missing host directories (`SPOOL_HOST_DIR`, `DB_HOST_DIR`, `SRS_OUTPUT_HOST_DIR`, `ASSIGNMENT_SEED_HOST_DIR`) only under `--apply`; verifies at least 10% free space on the spool filesystem.
3. **Active-session safety check** — reads `media_agent_sessions{status="active"}` from the running agent's `/metrics` and refuses to proceed if any session is active, unless `--force` (matching the runbook's "deploy only when the node has no assigned critical event"). `--force` exists for a genuine emergency fix only.
4. **Compose config validation** — `docker compose config` must render cleanly before anything starts.
5. **Startup ordering and health gating** — `docker-compose.yml`'s own `depends_on: condition: service_healthy` already orders `srs` after `media-agent`; `deploy.sh` polls both containers' Docker healthcheck status and fails (suggesting `rollback.sh`) if either does not become healthy within `HEALTH_TIMEOUT_SECS` (default 90s).
6. **Post-deployment verification** — `GET /readyz` must return `200` before the script reports success.

## Database migration

No separate migration step exists or is needed: the Media Agent applies every pending versioned migration in `services/media-agent/internal/store/migrations/*.sql` transactionally at its own startup (`internal/store.applyMigrations`), and this has always been true — it is safe to call on every restart, an already-fully-migrated database applies zero migrations, and the health gate above already waits for the container to report healthy, which only happens after `store.Open` (and therefore migration) succeeds.

## Rollback

`rollback.sh <previous-image>` overrides `MEDIA_AGENT_IMAGE` for one `docker compose up -d media-agent` call, health-gates the result, and never touches `SPOOL_HOST_DIR`, `DB_HOST_DIR`, or `SRS_OUTPUT_HOST_DIR`. A schema migration is always forward-compatible with the *previous* code as long as that previous code never depended on a column a newer migration removed — this repository's migrations are additive-only (`09_CLAUDE_CODE_EXECUTION_RULES.md` "Use additive, reviewed ... migrations. Do not edit an already-applied migration"), so a same-database rollback to an older image is safe by construction; a rollback across a *future* migration that ever needed to be non-additive would require its own tested backward-recovery plan, per `08_OPERATIONS_RUNBOOK.md`.

**Scope limitation:** `rollback.sh` only ever changes which media-agent *image* runs against the `docker-compose.yml` and `.env` currently checked out on the node. It does not check out or restore a previous *version of the Compose file or environment* from git history. If a past deployment's configuration differed structurally from what is currently checked out (e.g. a new required environment variable this rollback's compose file does not know how to fall back on), a true full-configuration rollback additionally requires checking out the matching git commit for `infra/media-node` before running this script - operators should not assume "rollback" restores anything beyond the container image.

## Production mutation safety

Both `deploy.sh` and `rollback.sh` default to printing their plan and exiting `0` without changing anything. Every default host path they read (`/opt/eventcast/media-node/...`) matches `docker-compose.yml`'s own defaults exactly, so a dry run against the real environment file shows exactly what a real deployment would do — but `--apply` is always required to actually do it. This satisfies the requirement to never automatically deploy over the existing persistent installation during development validation: every isolated validation run in this repository (`*-integration-test.sh`, `restore-test.sh`) uses its own uniquely-named temp directories, Compose projects, and container names instead of calling `deploy.sh` at all.
