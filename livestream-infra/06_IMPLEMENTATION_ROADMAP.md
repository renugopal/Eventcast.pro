# 06 — Implementation Roadmap

## Phase 0 — Repository and configuration baseline

Create the media service boundaries without changing unrelated web features. Add a `services/media-agent` Go service, `infra/media-node` deployment files, database migrations for node/session/job state, and this documentation pack under the repository documentation directory. Define typed configuration, secret references, structured logging, health endpoints, and CI checks. Exit requires reproducible local startup, pinned dependencies, no secrets in source control, and an automated check that the exact pinned SRS image accepts the generated configuration.

## Phase 1 — Local RTMP-to-HLS proof

Run pinned SRS v6.0-r0, publish H.264/AAC from OBS, generate four-second MPEG-TS segments on a persistent spool, and verify callback payloads. Implement local publish authorization using seeded cached assignments. Exit requires a two-hour continuous stream, correct segment durations, clean audio/video playback, publisher rejection tests, reconnect session creation, verified `on_hls` payloads from the pinned image, and a confirmed failure path when the durable spool cannot accept a segment.

## Phase 2 — Durable Media Agent queue

Implement SQLite WAL migrations, callback idempotency, reconciliation scanning, stable-file validation, SHA-256 calculation, retry scheduling, outbox delivery, and graceful restart. Exit requires callback loss recovery, agent restart recovery, duplicate callback safety, and zero segment duplication.

## Phase 3 — Ordered R2 publication

Implement R2 S3 client, least-privilege credentials, immutable object layout, upload verification, per-event ordered commitment, and the Media Agent live manifest builder. Add the R2 custom domain and cache rules, including cache bypass/no-store for live manifests and prevention of cached 404 responses on manifest paths. Exit requires the public manifest to reference only confirmed objects under forced upload delay and injected failures.

## Phase 4 — Player and DVR

Integrate the production HLS URL into the EventCast player, enable approximately fifteen minutes of DVR, configure live-edge behavior, and send player telemetry. Exit requires Chrome, Android, Safari/iOS, reconnect, seek-back, and live-edge recovery tests.

## Phase 5 — Event lifecycle and VOD

Implement state transitions, manual End Live, scheduled-end plus grace logic, quiet-period finalization, full VOD playlist generation, discontinuities, ENDLIST, and VOD validation through the production delivery path. Exit requires immediate post-event replay for an eight-hour test with at least two reconnects.

## Phase 6 — YouTube relay

Implement optional per-event relay supervision with FFmpeg stream copy, encrypted secret retrieval, retry status, redacted logs, and isolation from primary HLS. Exit requires EventCast playback to remain healthy while YouTube credentials are invalid, YouTube is unreachable, and the relay process crashes.

## Phase 7 — Wasabi archive and restore

Implement resumable copy, a non-self-referential archive manifest with separately stored manifest digest, verification, low-priority throttling, hot-retention scheduling, guarded local-spool and R2 cleanup, and restore-to-R2. Exit requires a complete archive, a deliberate interrupted archive that resumes correctly, and a successful restore followed by normal VOD playback.

## Phase 8 — Monitoring and operational controls

Expose Media Agent metrics, scrape SRS exporter, collect host/disk logs and metrics, create alerts, add node capacity reporting, maintenance mode, and assignment blocking. Exit requires tested alerts for stalled segments, R2 backlog, disk pressure, Media Agent down, and missing playback objects.

## Phase 9 — Failure, soak, and load qualification

Run the complete test plan on production-equivalent hardware. Start with one stream, then the configured ten-stream limit, and run long-duration soak and failure injection. Fix all P0 and P1 findings. Exit requires a signed validation record and no unresolved production-blocking issue.

## Phase 10 — Two-node production readiness

Provision a second media node, implement scheduler sharding, node maintenance workflows, node-level health gates, and event reassignment before publish. Run simultaneous events across both nodes. Exit allows broad paid production; it does not imply seamless active-stream failover.

## Deferred phase — SRT and H.265 premium workflow

First validate SRT with H.264/AAC using Kiloview and OBS under packet loss, jitter, bandwidth reduction, reconnect, and six-to-eight-hour duration. Only after passing that gate test SRT plus H.265. Decide whether premium H.265 means HEVC end-to-end on a restricted compatibility matrix or HEVC ingest followed by dedicated GPU H.264 transcoding. Update architecture decisions before production enablement.
