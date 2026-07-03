# 04 — Tech Stack and Version Policy

## Control plane

The control plane remains the existing EventCast application based on Next.js App Router, React, TypeScript, Supabase PostgreSQL/Auth, and Cloudflare deployment services. Existing versions must be discovered from the repository lockfile and deployment configuration; Claude Code must not upgrade the web stack as part of media-pipeline implementation unless the upgrade is separately approved.

Supabase is used for business records, event lifecycle, assignments, node summaries, and audit history. Media segments and high-frequency segment queue rows do not belong in Supabase.

## Media server

SRS is the selected media server. Production V1 pins `ossrs/srs:v6.0-r0` or its verified immutable digest. SRS is selected over datarhei Restreamer because EventCast needs a programmable multi-event media gateway, callbacks, HLS packaging, SRT/HEVC future compatibility, Prometheus-format metrics, and integration with custom orchestration rather than a UI-centric manual restream application.

A future SRS major-version upgrade must be treated as an architecture-sensitive change. It requires regression tests for RTMP authorization, HLS file naming, callback payloads, segment duration, cleanup behavior, HEVC/SRT behavior when enabled, and long-duration memory stability.

## EventCast Media Agent

The Media Agent is implemented in Go. The exact supported Go toolchain must be pinned in `go.mod`, the container image, and CI. The reason for Go is a small deployable binary, strong concurrency support, mature S3 SDK support, reliable filesystem and process supervision, and low runtime overhead.

The required libraries should be minimal and maintained. AWS SDK for Go v2 is used for both R2 and Wasabi S3-compatible APIs with separate clients, endpoints, credentials, timeouts, and retry policies. SQLite uses a maintained driver with WAL support. Structured logging uses JSON and stable field names.

The agent exposes HTTP only on loopback/private network, exports Prometheus/OpenMetrics metrics, and supports graceful shutdown. Shutdown must stop accepting callbacks, persist in-flight state, stop new manifest commits, and allow bounded completion of active file operations.

## Local queue and filesystem

SQLite WAL is the node-local durable queue. It is not replaced by an in-memory queue. SRS staging and the Media Agent spool use a Linux filesystem with atomic rename, fsync, and hard-link support. Production storage should be mirrored NVMe. Keeping both paths on the same filesystem permits a completed SRS segment to be protected without duplicating all bytes. Container volumes must bind to explicit host paths.

## Object storage

Cloudflare R2 Standard is the live and hot-VOD object store. R2 is accessed with its S3-compatible API. Viewer delivery uses an R2 custom domain and Cloudflare cache. `r2.dev` is development-only.

Wasabi is the long-term archive store. It is accessed with a distinct S3-compatible client and credentials. Wasabi is not the normal HLS origin and is not placed directly in the live playback path.

## HLS player

The player uses native HLS where appropriate and a pinned hls.js release for browsers requiring Media Source Extensions. Player configuration must target standard HLS, not LL-HLS. The live sync target should normally remain several segments behind the latest published edge to absorb normal upload and network jitter.

Player telemetry must be asynchronous and privacy-conscious. Telemetry failure must not interrupt playback.

## FFmpeg

FFmpeg is used only for YouTube relay, media inspection, safe remuxing, and validation. V1 does not use FFmpeg for mandatory per-stream video transcoding. The FFmpeg build must be pinned by package version or container digest and must include required RTMP/RTMPS, HLS, MPEG-TS, H.264, AAC, and probing support.

All FFmpeg processes must be spawned without shell interpolation, use explicit argument arrays, have bounded logs, receive termination signals, and be supervised. Destination secrets must be redacted.

## Deployment runtime

A media node may use Docker Compose for SRS, Media Agent, and supporting agents, with systemd supervising the Compose application. Images must be pinned. Host directories, certificates, SQLite, and spool data must persist independently of containers.

Every SRS configuration change must be validated against the exact pinned image before rollout by checking startup/config parsing and exercising a real test publish plus callback. Documentation snippets are behavioral templates and are not a substitute for release-specific validation.

Production deployments must support an atomic configuration rollout and rollback. A new image is first deployed to a non-live canary node, then to one production node without assigned critical events, and only then to remaining nodes.

## Monitoring

Datadog Agent is the current operational monitoring choice because the project already uses it and it avoids operating a separate monitoring VM. It should collect host metrics, logs, Media Agent metrics, and SRS exporter metrics through OpenMetrics. The architecture remains vendor-neutral at the metric interface; moving to Prometheus/Grafana later does not change media behavior.

## Version policy

Every production dependency must be pinned through a lockfile, exact image tag plus digest, or explicit package version. Floating tags are forbidden. Security and bug-fix upgrades are tested on the same acceptance suite before rollout.

Architecture documents record behavior, not rapidly changing patch numbers, except where a version supplies a required media feature. The SRS V1 version is explicitly pinned because version 7 changes relevant HLS/RTMPS capabilities and is not the approved V1 baseline.
