# EventCast.pro Livestream Platform — Architecture Baseline v1.2

**Status:** Approved implementation baseline  
**Baseline version:** 1.2  
**Baseline date:** 2026-07-02  
**Primary audience:** Claude Code, maintainers, deployment operators  
**Scope:** EventCast.pro control plane, live media ingest, HLS delivery, DVR, VOD finalization, YouTube restreaming, and Wasabi archival

## Purpose

This documentation set is the authoritative technical contract for the EventCast.pro livestream platform. It replaces all older architecture notes and supersedes previous Restreamer-based, direct-origin HLS, single-long-MP4, and generic Cloudflare CDN assumptions.

The baseline is intentionally conservative. Version 1 launches with RTMP ingest, H.264/AAC passthrough, SRS packaging, a durable local media spool, ordered uploads to Cloudflare R2, HLS delivery through Cloudflare, fifteen-minute DVR, immediate HLS-based VOD, and verified archival to Wasabi. SRT, H.265, adaptive bitrate streaming, GPU transcoding, WebRTC, and seamless cross-node failover remain later phases and must not be introduced into V1 without a recorded architecture decision.

## Reading order and precedence

Claude Code must read the documents in the following order before making implementation changes:

1. `README.md`
2. `01_SYSTEM_ARCHITECTURE.md`
3. `02_V1_ARCHITECTURE_SPEC.md`
4. `03_DATA_MODEL_AND_API_CONTRACTS.md`
5. `04_TECH_STACK_AND_VERSION_POLICY.md`
6. `05_DECISIONS.md`
7. `06_IMPLEMENTATION_ROADMAP.md`
8. `07_TEST_AND_ACCEPTANCE_PLAN.md`
9. `08_OPERATIONS_RUNBOOK.md`
10. `09_CLAUDE_CODE_EXECUTION_RULES.md`
11. `10_OFFICIAL_REFERENCES.md`
12. `11_ARCHITECTURE_VALIDATION.md`

When two documents appear to conflict, `02_V1_ARCHITECTURE_SPEC.md` is normative for runtime behavior, `03_DATA_MODEL_AND_API_CONTRACTS.md` is normative for persisted state and interfaces, and `05_DECISIONS.md` is normative for accepted and deferred architectural choices. A conflict must be reported and resolved through a new decision record before code is changed.

## Frozen V1 architecture

The V1 media path is:

```text
Encoder
  -> RTMP/H.264/AAC
  -> Assigned SRS media node
  -> Local mirrored NVMe spool
  -> EventCast Media Agent durable queue
  -> Cloudflare R2 Standard
  -> Cloudflare cache/custom domain
  -> HLS player
```

The post-live path is:

```text
R2 HLS segments
  -> final VOD playlist with EXT-X-ENDLIST
  -> verified archive copy to Wasabi
  -> configurable R2 hot-retention period
  -> guarded R2 cleanup only after archive verification
```

YouTube restreaming is an independent side output. Its failure must never interrupt the primary EventCast HLS stream.

## Non-negotiable reliability rules

A public playlist must never reference a media segment that has not been successfully persisted in R2. The SRS-generated local playlist is not published directly. The Media Agent publishes the authoritative live playlist only after each referenced segment has completed upload and verification.

A local media file must never be deleted merely because an upload was attempted. It may be deleted only after R2 persistence is confirmed, the event has been finalized and validated, the configured local-retention rule has expired, and—when the event requires Wasabi archival—the archive has been verified. Emergency disk-pressure cleanup may override the archive condition only through an explicit operator-approved recovery procedure that preserves the verified R2 VOD copy and creates an audit record.

All segment object keys are immutable and unique. Reconnects create a new ingest session and are represented in HLS using discontinuities. Object keys must never contain a secret stream key.

Temporary failures must create retriable states, not data loss. R2, Wasabi, YouTube, control-plane, Media Agent, or network failures must be recoverable from durable local state.

V1 playback is public/unlisted at the media-object layer and protected primarily by an opaque, non-predictable `playback_id`, page-level controls, rate limiting, and abuse monitoring. The system must not claim strict private-media authorization while serving directly from a public R2 custom domain. Strict private playback, when required by a product package, must use an approved signed-access design that preserves segment cacheability and must be added through an ADR.

## Deployment gates

A single-node deployment is permitted for local development, proof-of-concept work, and controlled beta testing. Paid production must use at least two independently assigned media nodes to reduce blast radius. V1 does not promise seamless failover for an already-connected publisher; a failed publisher connection requires encoder reconnection or use of a configured backup destination.

The initial scheduling limit is ten concurrent pass-through streams per production media node. This is a safety limit, not a theoretical capacity claim. It may be increased only after the acceptance and soak tests in `07_TEST_AND_ACCEPTANCE_PLAN.md` pass on the exact production hardware and configuration.

## Change control

These documents are stable implementation contracts, not informal notes. Architecture changes require a new decision entry containing the reason, alternatives, impact, migration plan, rollback plan, and affected documents. Dependency upgrades and operational tuning that do not change externally observable behavior still require test evidence and version pin updates.
