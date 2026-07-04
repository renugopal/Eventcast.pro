# services/media-agent

## Purpose

Home of the EventCast Media Agent, the Go service that owns durability and orchestration on each media node.

## Status

v1.2 Phase 2: the automated SRS RTMP-to-HLS integration proof (`infra/media-node/compose/phase2-integration-test.sh`) is complete and passing on top of the Phase 1 production-quality service baseline. The Media Agent itself provides typed, validated startup configuration (including strict node-id and port validation), structured JSON logging with reusable secret redaction, a `GET /healthz` endpoint with build-time version injection, graceful shutdown with a bounded drain and listener-failure detection, unit tests for every package including the entry point, and minimal `on-publish`/`on-hls`/`on-unpublish` handlers that validate and log each callback (added in Phase 0, task 3). It does not yet implement the durable spool, the SQLite queue, R2/Wasabi upload, YouTube relay, publish authorization, or any business workflow logic — see "Expected responsibilities" below for what remains.

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

Configuration is validated eagerly at startup (`internal/config`); invalid configuration causes the process to exit non-zero with a structured JSON error log and no secret values echoed. See `.env.example`.

## Local validation (Docker only)

Go is intentionally not installed on the host running this repository, and Go must not be installed on deployment hosts either. All build/vet/test/runtime validation goes through the pinned `golang:1.26.4` image and the Dockerfile below (`gofmt -l`, `go vet ./...`, `go build ./...`, `go test ./...`, then a production image build, container start, healthcheck, invalid-configuration, and graceful-shutdown check).

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

## Expected responsibilities (not yet implemented)

- Publish authorization / ingest-secret validation, session tracking, and rejection responses for `on-publish`
- Durable spool capture (hard-link or atomic copy + fsync) ahead of upload
- SQLite WAL-backed queue: `cached_event_assignments`, `ingest_sessions`, `segment_jobs`, `manifest_generations`, `youtube_relays`, `archive_jobs`, `agent_outbox`
- Ordered upload to Cloudflare R2 with SHA-256 verification
- Live and VOD manifest generation (single manifest writer per event)
- YouTube relay supervision (independent failure domain)
- Wasabi archive job and restore-to-R2
- Prometheus/OpenMetrics endpoint

## Non-negotiable rules

Do not publish SRS's local playlist directly. Do not mark an upload successful before provider confirmation. Do not use an in-memory queue for durability. Do not use shell interpolation for subprocess arguments. Do not log secrets or stream keys. See `../../09_CLAUDE_CODE_EXECUTION_RULES.md` for the full list.

## Internal layout

```text
services/media-agent/
  cmd/media-agent/        entrypoint, HTTP server wiring, graceful shutdown   [implemented]
  internal/config/        typed env config, startup validation               [implemented]
  internal/logging/       structured JSON logging, Secret redaction type     [implemented]
  internal/health/        GET /healthz handler                               [implemented]
  internal/srs/           SRS callback handlers (on-publish/on-hls/on-unpublish) [implemented]
  internal/spool/         durable local capture                              [not yet created]
  internal/queue/         SQLite WAL queue                                   [not yet created]
  internal/upload/        R2 upload + manifest publication                   [not yet created]
  internal/archive/       Wasabi archive + restore                          [not yet created]
  internal/relay/         YouTube relay supervision                          [not yet created]
  internal/controlplane/  outbound API client                                [not yet created]
  internal/metrics/       Prometheus/OpenMetrics                             [not yet created]
  go.mod
  go.sum                  (only if/when an external dependency is added)
  Dockerfile
  .dockerignore
  .env.example
```

This layout is a proposal consistent with standard Go project conventions and is not itself an architecture decision; deviations do not require an ADR unless they change externally observable behavior.
