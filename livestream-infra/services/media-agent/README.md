# services/media-agent

## Purpose

Home of the EventCast Media Agent, the Go service that owns durability and orchestration on each media node. This directory is currently a placeholder created during the Phase 0 repository baseline (`06_IMPLEMENTATION_ROADMAP.md`). No implementation code exists yet.

## Governing documents

Read before implementing anything here, in this order:

1. `../../01_SYSTEM_ARCHITECTURE.md` — Media node section, live ingest flow, ordered R2 publication flow
2. `../../02_V1_ARCHITECTURE_SPEC.md` — normative runtime behavior
3. `../../03_DATA_MODEL_AND_API_CONTRACTS.md` — local SQLite schema, SRS callback contracts, internal control-plane API, error codes
4. `../../04_TECH_STACK_AND_VERSION_POLICY.md` — Go toolchain pin, AWS SDK v2, SQLite WAL driver, logging format
5. `../../09_CLAUDE_CODE_EXECUTION_RULES.md` — production-quality rules, testing rules, logging rules

## Expected responsibilities (not yet implemented)

- SRS callback handlers: `on_publish`, `on_hls`, `on_unpublish`
- Durable spool capture (hard-link or atomic copy + fsync) ahead of upload
- SQLite WAL-backed queue: `cached_event_assignments`, `ingest_sessions`, `segment_jobs`, `manifest_generations`, `youtube_relays`, `archive_jobs`, `agent_outbox`
- Ordered upload to Cloudflare R2 with SHA-256 verification
- Live and VOD manifest generation (single manifest writer per event)
- YouTube relay supervision (independent failure domain)
- Wasabi archive job and restore-to-R2
- Prometheus/OpenMetrics endpoint, loopback-only HTTP, graceful shutdown

## Non-negotiable rules

Do not publish SRS's local playlist directly. Do not mark an upload successful before provider confirmation. Do not use an in-memory queue for durability. Do not use shell interpolation for subprocess arguments. Do not log secrets or stream keys. See `../../09_CLAUDE_CODE_EXECUTION_RULES.md` for the full list.

## Expected internal layout (to be created when implementation starts)

```text
services/media-agent/
  cmd/media-agent/        entrypoint
  internal/srs/           SRS callback handlers
  internal/spool/         durable local capture
  internal/queue/         SQLite WAL queue
  internal/upload/        R2 upload + manifest publication
  internal/archive/       Wasabi archive + restore
  internal/relay/         YouTube relay supervision
  internal/controlplane/  outbound API client
  internal/metrics/       Prometheus/OpenMetrics
  go.mod
  go.sum
```

This layout is a proposal consistent with standard Go project conventions and is not itself an architecture decision; deviations do not require an ADR unless they change externally observable behavior.
