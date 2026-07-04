# services/media-agent

## Purpose

Home of the EventCast Media Agent, the Go service that owns durability and orchestration on each media node.

## Status

v1.2 "Production Readiness and Operations": building on media delivery, DVR/VOD, and relay, the Media Agent now continuously synchronizes its assignment cache from a control plane (with a documented contract, mock server, and last-known-good/stale-cache/revocation policy), exposes an explicit, auditable VOD-gap operator resolution workflow, publishes Prometheus-compatible metrics and richer readiness reporting, and rate-limits every externally reachable HTTP endpoint. It still does not implement Wasabi archival — see "Expected responsibilities" below.

## Go toolchain

This service is pinned to **Go 1.26.4** exactly, consistently in:

- `go.mod` (`go 1.26.4`)
- `Dockerfile` builder stage (`golang:1.26.4`, pinned by tag and digest)
- All validation commands (see "Local validation" below)

Do not change this version without an explicit decision; the governing architecture documents intentionally leave the exact Go version unpinned at the documentation level and defer it to `go.mod`/the container image, per `04_TECH_STACK_AND_VERSION_POLICY.md`.

## Configuration

Only these environment variables are read:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `EVENTCAST_NODE_ID` | yes | — | Non-secret node identifier. Startup fails if empty, longer than 128 characters, or containing anything other than ASCII letters, digits, `.`, `_`, `-`. |
| `EVENTCAST_MEDIA_AGENT_HTTP_ADDR` | no | `127.0.0.1:8085` | Must be a valid `host:port` with an explicit numeric port between 1 and 65535 (port `0` is rejected so the bind stays deterministic). Default is loopback-only. |
| `EVENTCAST_LOG_LEVEL` | no | `info` | One of `debug`, `info`, `warn`, `error`. |
| `EVENTCAST_DB_PATH` | yes | — | Absolute path to the SQLite WAL-backed durable database file. |
| `EVENTCAST_SPOOL_ROOT` | yes | — | Absolute path to the protected durable spool root. Must not equal or nest with `EVENTCAST_SRS_HLS_ROOT`. |
| `EVENTCAST_SRS_HLS_ROOT` | yes | — | Absolute path to the SRS HLS staging root; `on_hls` file paths must resolve inside it. |
| `EVENTCAST_ASSIGNMENT_SEED_PATH` | no | *(empty, seeding disabled)* | Absolute path to a JSON seed file of cached event assignments, imported once at startup. |
| `EVENTCAST_RECONCILE_INTERVAL` | no | `30s` | Periodic reconciliation interval (positive Go duration). |
| `EVENTCAST_SESSION_STALE_TIMEOUT` | no | `180s` | Max time an active session may lack segment activity before reconciliation marks it disconnected. |
| `EVENTCAST_DB_BUSY_TIMEOUT` | no | `5s` | SQLite `busy_timeout` applied to every connection. |
| `EVENTCAST_R2_ENDPOINT` | only if `EVENTCAST_R2_BUCKET` is set | *(empty)* | S3-compatible endpoint URL (`http://` or `https://`), e.g. an R2 account endpoint or a local MinIO/test endpoint. |
| `EVENTCAST_R2_REGION` | no | `auto` | Signing region; R2 uses `auto`. |
| `EVENTCAST_R2_BUCKET` | no | *(empty, subsystem disabled)* | Bucket name. Leaving this empty disables the entire upload/manifest/VOD/retention subsystem, logging a startup warning; setting it requires endpoint/access-key/secret together. |
| `EVENTCAST_R2_ACCESS_KEY_ID` | only if bucket is set | — | Least-privilege access key. |
| `EVENTCAST_R2_SECRET_ACCESS_KEY` | only if bucket is set | — | Secret key; never logged (`internal/logging.Secret`). |
| `EVENTCAST_R2_OBJECT_PREFIX` | no | *(empty)* | Optional prefix prepended to every object key. |
| `EVENTCAST_R2_PUBLIC_BASE_URL` | no | *(empty, relative keys)* | Public delivery base URL used to build absolute manifest segment URLs. |
| `EVENTCAST_R2_UPLOAD_CONCURRENCY` | no | `4` | Number of concurrent upload-worker goroutines. |
| `EVENTCAST_R2_RETRY_BASE_DELAY` / `EVENTCAST_R2_RETRY_MAX_DELAY` | no | `500ms` / `30s` | Exponential-backoff-with-jitter bounds for retryable upload failures. |
| `EVENTCAST_R2_REQUEST_TIMEOUT` | no | `20s` | Per-segment upload attempt timeout. |
| `EVENTCAST_R2_UPLOAD_LEASE_DURATION` | no | `30s` | How long a claimed-but-unfinished upload's lease is honored before another worker may reclaim it. |
| `EVENTCAST_R2_INSECURE_SKIP_VERIFY` | no | `false` | Skip TLS verification; production must never set this. Only for local test endpoints. |
| `EVENTCAST_DVR_WINDOW` | no | `900s` | Live manifest retention window (ADR-004). Production must not change this without a new decision record; overridable only for isolated tests. |
| `EVENTCAST_LOCAL_RETENTION_DELAY` | no | `24h` | Delay after VOD finalization before a confirmed segment's local spool copy becomes eligible for deletion. |
| `EVENTCAST_MANIFEST_REBUILD_INTERVAL` | no | `5s` | Periodic backstop live-manifest rebuild sweep interval. |
| `EVENTCAST_CLEANUP_INTERVAL` | no | `15m` | Retention worker sweep interval. |
| `EVENTCAST_YOUTUBE_FFMPEG_PATH` | no | `ffmpeg` | Path to the ffmpeg binary the relay supervisor spawns (the Docker image bundles a static build at `/usr/local/bin/ffmpeg`). |
| `EVENTCAST_YOUTUBE_RESTART_MAX_ATTEMPTS` | no | `5` | Consecutive relay restart attempts before giving up and marking the session's relay failed. |
| `EVENTCAST_YOUTUBE_RESTART_BACKOFF_BASE` / `_MAX` | no | `2s` / `60s` | Exponential backoff bounds between relay restart attempts. |
| `EVENTCAST_YOUTUBE_SOURCE_RTMP_BASE_URL` | no | `rtmp://127.0.0.1:1935` | This node's own SRS RTMP endpoint the relay pulls from (never a public address). |
| `EVENTCAST_CONTROLPLANE_BASE_URL` | no | *(empty, sync disabled)* | Control-plane origin for continuous assignment sync (`internal/controlplane`). Empty relies solely on `EVENTCAST_ASSIGNMENT_SEED_PATH`. |
| `EVENTCAST_CONTROLPLANE_NODE_TOKEN` | only if base URL is set | — | Rotatable node credential sent as `Authorization: Bearer`; never logged. |
| `EVENTCAST_CONTROLPLANE_REQUEST_TIMEOUT` | no | `10s` | Bounds each individual sync fetch attempt. |
| `EVENTCAST_CONTROLPLANE_SYNC_INTERVAL` | no | `30s` | Steady-state period between successful syncs. |
| `EVENTCAST_CONTROLPLANE_BACKOFF_BASE` / `_MAX` | no | `2s` / `5m` | Exponential-backoff-with-full-jitter bounds after a failed sync. |
| `EVENTCAST_CONTROLPLANE_STALE_WARN_AFTER` / `_STALE_CRITICAL_AFTER` | no | `5m` / `20m` | Age of the last successful sync at which the cache is reported stale / critically stale (the latter also fails `GET /readyz`'s `control_plane_cache` check). |
| `EVENTCAST_OPERATOR_API_TOKEN` | no | *(empty, unauthenticated)* | Bearer token guarding the VOD finalize and vod-gap operator endpoints (`internal/operatorauth`). Production must set this; a startup warning is logged when empty. |
| `EVENTCAST_RATE_LIMIT_RPS` / `_BURST` | no | `20` / `40` | Per-client-key token-bucket rate limit (`internal/ratelimit`) applied to SRS callbacks and the operator endpoints. |
| `EVENTCAST_TRUSTED_PROXY_ENABLED` | no | `false` | When true, the rate limiter and access logs key on the first `X-Forwarded-For` entry instead of the raw TCP remote address. Only set this behind a reverse proxy that itself strips any client-supplied `X-Forwarded-For`. |

Configuration is validated eagerly at startup (`internal/config`); invalid configuration causes the process to exit non-zero with a structured JSON error log and no secret values echoed. Filesystem paths must be absolute, clean (no `.`/`..`/duplicate separators), and non-overlapping; `EVENTCAST_DB_PATH` may not live inside either durable-media root. See `.env.example`.

YouTube relay authorization (enabled flag, destination base URL, and stream key) is per-event data resolved from the same assignment seed mechanism as stream tokens, not a separate environment variable - see "YouTube relay" below.

## Local validation (Docker only)

Go is intentionally not installed on the host running this repository, and Go must not be installed on deployment hosts either. All build/vet/test/runtime validation goes through the pinned `golang:1.26.4` image and the Dockerfile below (`gofmt -l`, `go vet ./...`, `go build ./...`, `go test -race ./...`, then a production image build, container start, healthcheck, invalid-configuration, and graceful-shutdown check).

## Docker image

`Dockerfile` is a two-stage build: the pinned `golang:1.26.4` builder produces a static binary (`CGO_ENABLED=0`), copied into a pinned `gcr.io/distroless/static-debian12:nonroot` runtime stage. The container runs as the non-root `nonroot` user, exposes no public bind by default, and self-checks via `/media-agent healthcheck` (no curl/wget needed in the minimal runtime image). The build accepts an optional `MEDIA_AGENT_VERSION` build argument (default `dev`, must be a single whitespace-free token) that is injected into `internal/health.Version` and reported by `GET /healthz`.

## Governing documents

Read before implementing anything here, in this order:

1. `../../01_SYSTEM_ARCHITECTURE.md` — Media node section, live ingest flow, ordered R2 publication flow
2. `../../02_V1_ARCHITECTURE_SPEC.md` — normative runtime behavior
3. `../../03_DATA_MODEL_AND_API_CONTRACTS.md` — local SQLite schema, SRS callback contracts, internal control-plane API, error codes
4. `../../04_TECH_STACK_AND_VERSION_POLICY.md` — Go toolchain pin, AWS SDK v2, SQLite WAL driver, logging format
5. `../../09_CLAUDE_CODE_EXECUTION_RULES.md` — production-quality rules, testing rules, logging rules

## Implemented (Phase 0, task 1)

- Typed, eagerly-validated startup configuration (`internal/config`)
- Structured JSON logging with a reusable `Secret` redaction type for future secret-bearing fields (`internal/logging`)
- `GET /healthz` returning `status`, `service`, `version`, `timestamp` (`internal/health`)
- Loopback-default HTTP server with production-appropriate timeouts and graceful shutdown on SIGINT/SIGTERM (`cmd/media-agent`)
- Two-stage, non-root, digest-pinned Docker image with a self-contained health check

## Implemented (Phase 0, task 3)

- `POST /internal/srs/on-publish`, `POST /internal/srs/on-hls`, `POST /internal/srs/on-unpublish` (`internal/srs`)
- Each handler: rejects non-`POST` methods (`405`), enforces a 1 MiB request body ceiling (`413`), rejects malformed JSON with a non-secret JSON error body (`400`), validates that the minimum identifying fields (`action`, `stream`) are present (`400` otherwise), logs the callback as structured JSON without the `param` value (which may carry the RTMP publish token) or any other secret, and returns the SRS-compatible `{"code":0}` success body (`200`) otherwise
- No database, authorization, session validation, or business-state logic yet — every well-formed callback with the required fields succeeds; that scope belongs to a later phase (see "Expected responsibilities")

## Implemented (Phase 1 baseline hardening)

- Strict configuration validation: explicit numeric port range 1–65535 (rejects empty/non-numeric/ephemeral port values that `net.SplitHostPort` alone accepts) and a safe node-id character set (`internal/config`)
- Graceful-shutdown correctness: a listener failure that races the termination signal is surfaced instead of being reported as a clean stop (`cmd/media-agent`)
- Structured `http.Server` internal error logging through the JSON logger
- Build-time version injection via the `MEDIA_AGENT_VERSION` Docker build argument
- Entry-point unit tests: full in-process startup/health/graceful-shutdown cycle, bind-failure and invalid-configuration failure paths, and the `healthcheck` subcommand against healthy, unhealthy, and unreachable servers (`cmd/media-agent/main_test.go`)

## Implemented (Phase 2 integration proof)

- No Media Agent source changes: the Phase 1 callback handlers already implement everything the Phase 2 integration proof requires (accept any well-formed SRS callback, redact secrets, structured logging)
- Automated, non-interactive proof that the pinned SRS runtime and this Media Agent, run together via `infra/media-node/compose`, complete the full RTMP-publish -> HLS -> callback -> reconnect -> unpublish lifecycle against a real synthetic FFmpeg stream, with a ~12-minute automated soak — see `infra/media-node/compose/phase2-integration-test.sh` and its README section for the exact validated behavior and run instructions

## Implemented (v1.2 ingest control and durability)

- Durable local assignment cache (`internal/store`, `cached_event_assignments` table): SHA-256-hashed stream secret, enabled flag, publish window, imported transactionally from an optional JSON seed file (`EVENTCAST_ASSIGNMENT_SEED_PATH`) since the control-plane sync client is a later milestone
- `on_publish` authorization (`internal/srs`): validates the ingest id and secret token against the cache, rejects unknown/disabled/expired/not-yet-open/invalid-credential/conflicting-publisher cases with the SRS-compatible non-zero callback result and a stable error code (`AUTH_INVALID`, `ASSIGNMENT_MISMATCH`, `PUBLISH_WINDOW_CLOSED`, `DUPLICATE_PUBLISHER`), and creates a new stream session on success
- Stream-session lifecycle (`internal/store`, `ingest_sessions` table): a partial unique index enforces at most one starting/active session per event as the concurrency-safe conflicting-publisher guard; reconnection always creates a new session identity; `on_unpublish` closes the current session idempotently without finalizing the event
- Durable spool capture (`internal/spool`): validates the SRS-provided file path resolves inside the configured HLS root (rejecting traversal and symlink escape), then hard-links the completed segment into the protected spool or falls back to a temp-file-plus-fsync-plus-atomic-rename-plus-directory-fsync copy, never overwriting an existing destination
- SQLite WAL-backed segment queue (`internal/store`, `segment_jobs` table): an idempotency-key claim design makes duplicate `on_hls` callbacks - including ones that arrive concurrently with the original - resolve to the same durable capture without a second spool file or queue row
- Startup and periodic reconciliation (`internal/reconcile`): discovers durable spool files with no queue row, resolves segment claims abandoned by a crashed process, reports (never deletes) queue rows whose file is missing, marks sessions stale after inactivity so their event can accept a new publisher, and removes only this service's own exactly-named temp files past a safety age
- `GET /readyz` (`internal/health`): reports database, spool-writable, and assignment-cache readiness as booleans only, alongside the unchanged, dependency-free `GET /healthz`

## Implemented (v1.2 media delivery, DVR/VOD, and relay)

- Durable upload worker (`internal/upload`): a pool of goroutines atomically claims pending segment jobs from the existing SQLite queue (lease-based, with restart-safe expiry reclaim), verifies the local file is stable and matches its recorded SHA-256, checks for an already-uploaded object before ever writing (HEAD-before-PUT), uploads via the S3-compatible API with `video/MP2T` content type and SHA-256/event/session/sequence/duration metadata, and confirms success only after a HEAD re-check - never before. Retryable failures (network, timeout, provider 5xx) get exponential backoff with jitter and are never dead-lettered merely for exceeding an attempt count; terminal failures (auth, missing/corrupted local file, a conflicting object at the deterministic key) are dead-lettered immediately with a stable error code
- R2 object storage client (`internal/upload.R2Client`): a thin AWS SDK v2 S3-compatible wrapper behind an `ObjectStore` interface, configured for endpoint/region/bucket/credentials/concurrency/retry timing/request timeouts/object prefix/TLS behavior, exercised in tests against both an in-memory fake and a real pinned MinIO container
- Deterministic object keys (`internal/upload.SegmentKey` etc.): reuse the same collision-safe `local_file_identity` the spool layer already established, so a retried or duplicate-worker upload always computes the identical key
- Live/DVR manifest (`internal/upload.ManifestManager`): rebuilds the public playlist from `UploadConfirmed` segments only, windows to the configured DVR duration, inserts `EXT-X-DISCONTINUITY` at session boundaries, publishes via a single atomic `PutObject` (R2/S3's own full-object-replacement semantics), skips redundant republishes for an unchanged segment set, and is driven both by an immediate per-confirmation trigger and a durable-state-driven periodic backstop sweep that tolerates delayed/out-of-order completion and process restart
- VOD finalization (`internal/upload.VODFinalizer`, `POST /internal/events/{event_id}/finalize`): builds the full `EXT-X-ENDLIST` playlist from all confirmed segments once every session has stopped and every segment has resolved past capture/upload, validates every referenced object is actually present, and records a durable, idempotent, restart-safe finalization state - never deleting uploaded media
- Retention and cleanup (`internal/upload.RetentionWorker`): deletes a local spool copy only once it is R2-confirmed, referenced by a finalized VOD, and past the configured local safety delay, bounded to paths resolving inside the configured spool root; never touches R2 objects (left to the documented R2 lifecycle policy)
- YouTube relay (`internal/relay.Supervisor`): per-session, ffmpeg-based (`-c copy`, no shell interpolation), started only when the resolved assignment authorizes it, with bounded exponential-backoff restarts, a redacted stderr/log surface (the destination URL and stream key never appear in logs), and complete isolation from HLS/spool/upload/manifest/VOD - a relay failure only ever updates that session's own relay record
- Schema migration `0002_media_delivery.sql`: adds upload/manifest-commit tracking to `segment_jobs`, plus `manifest_generations`, `vod_finalizations`, and `youtube_relays`, transactional and restart-safe from the v1.2 ingest-control schema

### YouTube relay authorization

When continuous control-plane sync (`internal/controlplane`) is disabled, YouTube relay authorization is resolved from the JSON seed file `EVENTCAST_ASSIGNMENT_SEED_PATH` points at, with each assignment entry optionally carrying `youtube_enabled`, `youtube_destination_base_url`, and `youtube_stream_key`. When sync is enabled, the same three fields come from the control plane's response instead, kept current in an in-memory `controlplane.StreamKeyCache` the syncer replaces after every successful sync. Either way, only the first two fields are ever persisted to SQLite (`cached_event_assignments.youtube_enabled`/`youtube_destination_base_url`); the raw stream key is never written to the database, logged, or exposed through `GetAssignment`/`GetAssignmentByEventID`.

## Implemented (v1.2 production readiness and operations)

- **Control-plane assignment synchronization** (`internal/controlplane`): a documented client contract (`GET /internal/media/nodes/{node_id}/assignments`, bearer-token-authenticated, request-id/timestamp/idempotency-key headers - see the package doc in `client.go` for the full documented request/response shape, since no production endpoint contract exists yet to implement against) plus a deterministic in-memory mock server (`mock.go`, also runnable standalone via `cmd/controlplane-mock` for Compose-based integration/failure-injection tests). `Syncer` performs a best-effort startup sync, then periodic refresh with exponential backoff and full jitter on failure, applying every response via `store.ApplyControlPlaneAssignments`: incoming assignments are upserted with `source='controlplane'`, and any previously-synced (never seed-sourced) ingest id absent from the latest response is revoked (`enabled=false`) rather than deleted. A durable `controlplane_sync_state` row records last attempt/success/error/consecutive-failure-count, read by `Syncer.Status` to classify the cache as stale or critically stale (the latter fails `GET /readyz`). The local JSON seed file remains a valid bootstrap mechanism but is never re-applied once sync is enabled and never overrides a `source='controlplane'` row.
- **VOD-gap operator resolution** (`internal/upload/vodgap.go`, `GET`/`POST /internal/events/{event_id}/vod-gap`): `vod_finalizations` now carries an independent `gap_status` (`none`/`pending_review`/`acknowledged`/`rejected`) alongside its existing `status`, so a finalized-but-incomplete recording is never indistinguishable from a fully healthy one. `VODFinalizer.Finalize` sets `gap_status='pending_review'` whenever it observes a permanently unresolvable (missing/dead-lettered) segment. The resolution endpoint is authenticated (`internal/operatorauth`), idempotent (repeating the same decision succeeds without changing state; a conflicting decision after resolution returns `409`), fully audited (`vod_gap_audit`, one append-only row per resolution attempt), and restart-safe (all state in SQLite). It never touches a segment, an R2 object, or the filesystem.
- **Metrics** (`internal/metrics`, `GET /metrics`): a minimal, dependency-free Prometheus text-exposition-format registry (no new external module - `go.sum` is unchanged by this milestone). Two true counters are incremented at their point of occurrence (`media_agent_publish_auth_total`, `media_agent_callback_total`); everything else - sessions, spool free/total bytes, segment/upload-status counts, queue age, manifest generations, VOD/VOD-gap status, relay status/restarts, control-plane sync health, reconciliation results, database health, process uptime, and shutdown state - is polled from durable state or the OS on each scrape (`cmd/media-agent/main.go`'s `collectMetrics`). Every label is a small, fixed, code-controlled enum; no event id, session id, or other unbounded/secret-derived value is ever used as a label.
- **Rate limiting** (`internal/ratelimit`): a per-client-key token-bucket limiter wraps every SRS callback and operator endpoint. The client key is always the TCP remote address unless `EVENTCAST_TRUSTED_PROXY_ENABLED` is explicitly set, in which case it uses `X-Forwarded-For` - never trusted by default, since it is trivially spoofable by the client the limiter exists to bound.
- **Operator endpoint authentication** (`internal/operatorauth`): a constant-time bearer-token check in front of the finalize and vod-gap endpoints, configured via `EVENTCAST_OPERATOR_API_TOKEN`.
- **Readiness**: `GET /readyz` gained a `control_plane_cache` check (passes when sync is disabled or healthy; fails only once the cache is critically stale, never merely during an ordinary transient outage).

## Expected responsibilities (not yet implemented)

- Wasabi archive job and restore-to-R2

## Non-negotiable rules

Do not publish SRS's local playlist directly. Do not mark an upload successful before provider confirmation. Do not use an in-memory queue for durability. Do not use shell interpolation for subprocess arguments. Do not log secrets or stream keys. See `../../09_CLAUDE_CODE_EXECUTION_RULES.md` for the full list.

## Internal layout

```text
services/media-agent/
  cmd/media-agent/        entrypoint, HTTP server wiring, graceful shutdown   [implemented]
  cmd/controlplane-mock/  standalone deterministic mock control plane        [implemented]
  internal/config/        typed env config, startup validation               [implemented]
  internal/logging/       structured JSON logging, Secret redaction type     [implemented]
  internal/health/        GET /healthz and GET /readyz handlers              [implemented]
  internal/srs/           SRS callback handlers (on-publish/on-hls/on-unpublish) [implemented]
  internal/store/         SQLite WAL store: assignment cache, sessions, segment queue [implemented]
  internal/spool/         durable local capture (hard link / atomic copy)    [implemented]
  internal/reconcile/     startup and periodic reconciliation                [implemented]
  internal/upload/        R2 upload, live/DVR/VOD manifests, retention, VOD-gap [implemented]
  internal/relay/         YouTube relay supervision                          [implemented]
  internal/controlplane/  control-plane sync client, mock server, key cache  [implemented]
  internal/metrics/       Prometheus-compatible metrics registry             [implemented]
  internal/ratelimit/     per-client token-bucket rate limiting              [implemented]
  internal/operatorauth/  bearer-token auth for operator endpoints           [implemented]
  internal/archive/       Wasabi archive + restore                          [not yet created]
  go.mod
  go.sum                  (modernc.org/sqlite: pure-Go SQLite driver, no CGO)
  Dockerfile
  .dockerignore
  .env.example
```

This layout is a proposal consistent with standard Go project conventions and is not itself an architecture decision; deviations do not require an ADR unless they change externally observable behavior.
