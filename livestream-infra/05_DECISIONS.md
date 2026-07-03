# 05 — Architecture Decisions

## ADR-001 — Use SRS instead of datarhei Restreamer

**Status:** Accepted.

EventCast uses SRS as the core media server. Restreamer remains useful for manually managed relay workflows, but EventCast requires multi-tenant stream authorization, callbacks, HLS packaging, metrics, protocol control, and custom automation. SRS integrates directly with the Media Agent and provides a cleaner path to later SRT and HEVC support.

## ADR-002 — Launch with RTMP and H.264/AAC

**Status:** Accepted.

RTMP has the broadest encoder compatibility and is mature in SRS. H.264/AAC has the broadest viewer compatibility. SRT and H.265 are deferred until the baseline pipeline passes production tests. This avoids combining new transport, new codec, and new storage behavior in the first release.

## ADR-003 — Use MPEG-TS HLS with four-second target segments

**Status:** Accepted.

The pinned SRS 6 release uses MPEG-TS for the V1 HLS path. Four-second segments with a two-second GOP provide a practical balance between latency, request count, recovery granularity, and player stability. V1 does not use fMP4 or LL-HLS.

## ADR-004 — Use a fifteen-minute DVR window

**Status:** Accepted.

The public live playlist retains approximately 900 seconds. All event segments remain stored for VOD even after they leave the live playlist.

## ADR-005 — R2 is the live and hot-VOD origin

**Status:** Accepted.

Completed HLS segments are uploaded to Cloudflare R2 Standard and delivered through a custom domain and Cloudflare cache. The generic pattern of serving video from an external Hetzner origin through ordinary Cloudflare CDN is not used. Cloudflare Stream is explicitly not selected because its delivered-minute pricing does not fit long-duration event economics.

## ADR-006 — The Media Agent owns the public playlist

**Status:** Accepted and critical.

SRS's local playlist is not public. The Media Agent publishes a segment reference only after the object is R2-confirmed. This eliminates playlist-before-segment races and provides a durable source of truth across restarts.

## ADR-007 — Preserve a durable local spool

**Status:** Accepted.

SRS writes to a persistent staging directory, automatic HLS deletion is disabled, and the Media Agent immediately hard-links or atomically copies each completed segment into its own protected spool. The agent performs guarded cleanup. This avoids relying on SRS file-retention behavior during shutdown and protects against temporary R2 failure and process restarts. RAM-only HLS is rejected for V1.

## ADR-008 — VOD is finalized from the same HLS segments

**Status:** Accepted.

The final VOD playlist references the live event's immutable R2 media objects and adds `EXT-X-ENDLIST`. A large MP4 upload is not required before replay becomes available. MP4 is a secondary derivative and never the sole recording.

## ADR-009 — Wasabi is archive storage, not live delivery

**Status:** Accepted.

Finalized event assets are copied from R2 to Wasabi using a resumable verified archive job. Wasabi objects are retained in accordance with its minimum-duration policy. Old VOD is restored to R2 before standard playback.

## ADR-010 — Copy, verify, retain, then delete

**Status:** Accepted and critical.

R2-to-Wasabi transfer is never implemented as an unsafe move. The system copies, verifies a complete archive manifest, retains the R2 copy for a hot period, and deletes only through a later guarded job.

## ADR-011 — No mandatory server-side transcoding or ABR in V1

**Status:** Accepted.

V1 is source-quality passthrough. Server-side ABR would introduce significant CPU/GPU cost, GOP-alignment complexity, and new failure modes. It may be introduced later on dedicated transcoding workers.

## ADR-012 — YouTube relay is independent

**Status:** Accepted.

YouTube is a secondary destination. Relay failure does not fail EventCast HLS. V1 relay uses H.264/AAC stream copy when possible.

## ADR-013 — Separate control plane and media plane

**Status:** Accepted.

Supabase and the web application manage business state. Media nodes manage packets and local durability. Existing authorized streams continue through temporary control-plane outages using cached assignments and an outbox.

## ADR-014 — Start with ten concurrent streams per node

**Status:** Accepted as a safety limit.

The initial hard scheduler limit is ten pass-through streams per production node. This number is increased only after exact-hardware load and soak evidence. No document claims an untested forty- or fifty-stream capacity.

## ADR-015 — Two nodes are required before broad paid production

**Status:** Accepted.

One node is permitted for development and controlled beta. Paid production uses at least two nodes and shards events across them. V1 does not claim seamless failover for an active RTMP publisher.

## ADR-016 — SRT and H.265 are staged premium features

**Status:** Deferred.

The order is RTMP/H.264 baseline, then SRT/H.264 laboratory and field tests, then SRT/H.265 ingest tests, then a decision about compatible-device HEVC delivery versus GPU H.264 transcoding. H.265 is not enabled merely because SRS supports it.

## ADR-017 — Cloudflare support confirmation is non-blocking

**Status:** Accepted.

R2 is a paid Developer Platform service and the architecture uses an R2 custom domain. Development and validation proceed without waiting for a support response. A concise written enquiry before broad commercial launch is recommended to document the account's intended R2-hosted HLS use.

## ADR-018 — Use Datadog without a dedicated monitoring VM

**Status:** Accepted for V1.

Each media node runs an agent and exports standard metrics. This satisfies observability without adding a separate monitoring server. The metric surface remains compatible with another collector later.

## ADR-019 — Pin SRS v6.0-r0 for V1

**Status:** Accepted.

The latest tagged stable release identified during this review is v6.0-r0. V1 does not adopt SRS 7/8 development capabilities such as native RTMPS or fMP4 merely to gain features. Upgrade only after a dedicated regression decision.


## ADR-020 — V1 playback is public/unlisted, not strictly private

**Status:** Accepted.

Direct R2 custom-domain HLS delivery is cache-efficient and suitable for EventCast's initial event-page model, but it does not enforce per-viewer authorization by itself. V1 therefore uses a cryptographically random opaque playback identifier, page-level discovery controls, Cloudflare rate limiting/WAF, and abuse monitoring. Strict private playback requires a later ADR and a signed-access layer that preserves immutable segment cacheability.

## ADR-021 — Cloudflare must bypass live-manifest and manifest-404 caching

**Status:** Accepted and critical.

Live `.m3u8` objects are mutable and must not be served stale. Cloudflare rules bypass cache or enforce an explicitly tested TTL no greater than one second for live manifests, and cached 404 responses are disabled for manifest paths. Immutable media segments retain long cache lifetimes.

## ADR-022 — SRS configuration snippets require exact-image validation

**Status:** Accepted.

The documented SRS configuration expresses required behavior but is not assumed valid merely because directives exist in another documentation branch. CI or deployment validation must parse/start the exact pinned image and run a real publish, HLS, and callback smoke test before rollout.

## ADR-023 — Required archives gate routine local-spool deletion

**Status:** Accepted and critical.

When an event policy requires Wasabi archival, routine deletion of its protected local spool is blocked until the event is VOD-ready, the R2 VOD has passed validation, the configured local safety period has elapsed, and `archive_verified_at` is present. This aligns the README and normative specification and preserves two verified durable copies before local cleanup. A disk-pressure exception requires an explicit operator-approved, audited recovery action and may proceed only while the complete validated R2 copy remains intact.

## ADR-024 — Archive manifest cannot checksum itself

**Status:** Accepted.

`archive-manifest.json` lists and verifies required archive payload objects but excludes itself from that object array. After upload, the manifest's own SHA-256 digest is stored separately in control-plane state or immutable destination metadata. This avoids an impossible recursive checksum definition while preserving verifiable archive integrity.
