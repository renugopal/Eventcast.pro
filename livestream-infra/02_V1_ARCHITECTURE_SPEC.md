# 02 — V1 Architecture Specification

## Normative language

The words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are normative. V1 implementation is incomplete if any MUST requirement is absent.

## V1 scope

V1 MUST provide RTMP ingest, H.264/AAC passthrough, SRS HLS packaging, local durable media spooling, ordered R2 upload, Cloudflare-backed HLS delivery, a fifteen-minute DVR window, post-live VOD finalization, optional YouTube restream, verified Wasabi archival, event status reporting, and operational monitoring.

V1 MUST NOT require Cloudflare Stream. V1 MUST NOT add server-side ABR, GPU transcoding, WebRTC viewer delivery, LL-HLS, SRT production ingest, H.265 production delivery, active-active manifest generation, or direct Wasabi playback.

## Supported V1 media profile

The required video codec is H.264/AVC. The required audio codec is AAC-LC. Maximum supported input is 1920×1080 at 30 frames per second. The recommended encoder GOP is two seconds and MUST remain closed and regular. The recommended bitrate is 2.5–4 Mbps for 720p30 and 4–6 Mbps for 1080p30. AAC SHOULD be 48 kHz stereo at 128 kbps.

The platform performs remuxing, not normalization. It MUST report non-conforming codec, frame-rate, GOP, or bitrate values. It MAY reject inputs that exceed configured safety limits. It MUST NOT silently launch CPU-intensive transcoding as a fallback.

## Protocols

RTMP over TCP port 1935 is the V1 publishing protocol. The publishing credential MUST contain a non-secret opaque `ingest_id` and a separate random secret token. The encoder-facing stream key SHOULD use the form `<ingest_id>?token=<secret>`, allowing SRS filenames to use only the ingest identifier while authorization reads the secret from callback parameters. Native RTMPS is not assumed because the pinned SRS V1 release is 6.0-r0; RTMPS may be introduced only through a tested TLS proxy or a future approved SRS upgrade.

SRT is a future publishing protocol. When introduced, it MUST use caller/listener configuration, an authenticated stream ID mapping, tested latency settings, UDP firewall rules, and long-duration field validation. SRT must first pass with H.264/AAC before H.265 testing begins.

HLS over HTTPS is the V1 viewer protocol. Viewer playback MUST come from Cloudflare/R2 delivery, not directly from SRS or the media-node public IP.

## Pinned SRS baseline

Production V1 MUST pin the exact SRS `v6.0-r0` image or immutable image digest. Floating tags such as `latest`, `6`, or a development branch MUST NOT be used in production.

SRS MUST run as the packaging engine only. The following settings are the required behavioral baseline and an implementation template, not a copy-paste deployment guarantee. Exact directives and container paths MUST be validated against the pinned image using the release-specific `full.conf`, an SRS configuration test/startup check, and a real callback integration test before deployment:

```conf
listen 1935;
max_connections 1000;
daemon off;

http_api {
    enabled on;
    listen 1985;
}

exporter {
    enabled on;
    listen 9972;
}

vhost __defaultVhost__ {
    hls {
        enabled on;
        hls_fragment 4;
        hls_window 900;
        hls_wait_keyframe on;
        hls_cleanup off;
        hls_dispose 0;
        hls_on_error continue;
        hls_ctx off;
        hls_ts_ctx off;
        hls_path /var/lib/eventcast/srs-output;
        hls_m3u8_file [app]/[stream]/local.m3u8;
        hls_ts_file [app]/[stream]/[timestamp]-[seq].ts;
        hls_vcodec h264;
        hls_acodec aac;
    }

    http_hooks {
        enabled on;
        on_publish   http://127.0.0.1:8085/internal/srs/on-publish;
        on_unpublish http://127.0.0.1:8085/internal/srs/on-unpublish;
        on_hls       http://127.0.0.1:8085/internal/srs/on-hls;
    }
}
```

SRS HTTP API, exporter, and local HLS HTTP service MUST NOT be exposed publicly. The Media Agent and monitoring agent access them through loopback or a private container network.

## Local staging and durable spool

Both the SRS staging directory and Media Agent durable spool MUST live on persistent host storage, not a container writable layer and not tmpfs. Production SHOULD use mirrored NVMe or equivalent redundant local storage. They SHOULD be on the same filesystem so a completed file can be hard-linked in constant time. The filesystem MUST support atomic rename, fsync, hard links, and sufficient inode capacity.

SRS writes to `/var/lib/eventcast/srs-output`. The Media Agent owns `/var/lib/eventcast/spool`. On every valid `on_hls` callback, the agent MUST create a protected hard link from the completed SRS file into an event/session-specific spool path before returning success and MUST fsync the containing spool directory so the directory entry survives a crash. If hard linking is unavailable, it MUST copy to a temporary file, fsync the file, atomically rename it, and fsync the containing directory. The durable path MUST use internal event/session identifiers and MUST NOT expose the publishing secret.

SRS automatic HLS cleanup MUST be disabled as defense in depth, but the implementation MUST NOT rely on SRS-owned files surviving a graceful stop or restart. The Media Agent exclusively controls deletion from its durable spool. A reconciliation process MUST scan both staging and durable-spool paths at startup and periodically to recover completed files that lack a queue row.

Disk reservations MUST account for at least the maximum configured simultaneous streams, maximum expected bitrate, event duration, upload outage buffer, staging overhead, and safety margin. New events MUST NOT be assigned when predicted free space would fall below the hard safety threshold.

## SRS callback handling

The Media Agent MUST expose loopback-only endpoints for `on_publish`, `on_unpublish`, and `on_hls`.

`on_publish` MUST validate the ingest identifier and secret token against locally cached assignment data, publishing window, enabled status, and existing active publisher. It MUST map the credential to internal `event_id`, opaque `playback_id`, and a new `session_id`. It MUST reject unauthorized or conflicting publishers with a non-zero callback result.

`on_hls` MUST validate that the SRS file path is inside the configured staging root. It MUST use the callback's duration and sequence values. Before returning success, it MUST capture the completed file into the Media Agent durable spool and persist an idempotent segment job. The filesystem operation and SQLite transaction cannot be perfectly atomic across crash boundaries, so reconciliation MUST recover either a durable file without a row or a row whose file operation was incomplete. The unique job identity is `(event_id, session_id, local_file_identity)`; repeated callbacks MUST not create duplicate durable copies or published segments. If durable capture cannot be completed, the callback MUST fail loudly and the event MUST enter a degraded or recoverable-failure state rather than acknowledging media that is not protected.

`on_unpublish` MUST mark the session disconnected but MUST NOT finalize the event. Reconnection creates a new session and later inserts an HLS discontinuity.

## Durable Media Agent queue

The Media Agent MUST use SQLite in WAL mode for local durable jobs. The SQLite database and durable spool MUST be recoverable together. Queue state MUST survive process and host restarts. Each segment job MUST track local path, event, session, SRS sequence, duration, creation time, byte size, SHA-256, R2 object key, attempt count, last error, next attempt time, upload status, and manifest-commit status.

Upload retries MUST use exponential backoff with jitter and a maximum interval. Retriable provider, network, timeout, and 5xx errors MUST not become terminal merely because a retry count was exceeded. Permanently invalid credentials, missing local files, or corrupted files MUST raise a critical incident and place the event in a recoverable failed state.

Per-event manifest commitment MUST preserve media order. Different events MAY upload concurrently. Segment uploads within an event MAY be pipelined only when manifest commitment still occurs in sequence.

## R2 object layout

Public object paths MUST use an opaque `playback_id`, not a stream key, customer email, or predictable database identifier.

The required logical layout is:

```text
events/{playback_id}/media/{session_id}/{timestamp}-{sequence}.ts
events/{playback_id}/live/index.m3u8
events/{playback_id}/vod/index.m3u8
events/{playback_id}/metadata/event.json
events/{playback_id}/metadata/archive-manifest.json
```

Segment keys MUST be immutable. A segment object MUST NOT be overwritten. Live playlist keys are mutable and MUST be written by a single event owner. Final VOD and archive-manifest objects MAY use versioned temporary keys and an atomic final publication step.

Every segment upload MUST set the correct `video/MP2T` content type and SHOULD set custom metadata containing SHA-256, event ID, session ID, sequence, and duration. Playlist objects MUST use an HLS-compatible MIME type.

## Segment upload and verification

Before upload, the Media Agent MUST read from its protected durable-spool path, verify that the file is stable and readable, and compute SHA-256. It MUST upload through R2's S3-compatible API using least-privilege credentials restricted to the media bucket.

A segment becomes `R2_CONFIRMED` only after the upload request succeeds and a HEAD check confirms the expected key, size, and metadata. The implementation MUST NOT depend on multipart ETag as a universal content checksum.

Local segment deletion MUST NOT occur during live operation merely because R2 confirmation succeeded. Local retention provides restart and recovery protection. Cleanup follows the rules in the retention section.

## Authoritative live manifest

The Media Agent, not SRS, MUST build the public live manifest. The SRS `local.m3u8` MAY be used for diagnostics but MUST NOT be copied as the public playlist.

The public playlist MUST contain only `R2_CONFIRMED` segments. It MUST retain approximately 900 seconds of media, use correct target duration, monotonically advance media sequence, include absolute or correctly resolvable segment URLs, and add `#EXT-X-DISCONTINUITY` between ingest sessions or timestamp discontinuities.

Each manifest update MUST be generated from durable state, written to a temporary object or buffer, and published as one complete object. Partial playlists MUST never become visible.

If R2 upload stalls, the playlist MUST stop advancing at the last confirmed segment. It MUST NOT reference a pending object. This may cause viewer playback to stall, but it protects correctness and permits recovery.

## Cloudflare delivery and cache policy

Production MUST use an R2 custom domain. The `r2.dev` development endpoint MUST NOT be used for production playback.

Immutable segment responses MUST use a long cache lifetime, preferably `Cache-Control: public, max-age=31536000, immutable`. Live manifests MUST use `Cache-Control: no-store` or an explicitly tested edge TTL no greater than one second. Cloudflare Cache Rules MUST bypass caching for live manifest paths and MUST prevent cached 404 responses for those paths. A live manifest key SHOULD be created before the player URL is exposed. Final VOD manifests MAY use a moderate public cache after finalization.

Cloudflare Cache Rules MUST distinguish playlists from media segments. Smart Tiered Cache SHOULD be enabled. CORS MUST allow the approved EventCast playback origins and required request methods. Cache rules MUST be tested to confirm that mutable manifests do not remain stale and immutable segment cache keys are not fragmented by unnecessary query parameters.

The architecture relies on R2 as a Cloudflare Developer Platform paid service for media storage and delivery. A Cloudflare support enquiry before broad commercial launch is recommended documentation hygiene but is not a development blocker.


## Playback authorization boundary

V1 MUST treat media delivery as public/unlisted at the object layer. The `playback_id` MUST be cryptographically random and non-enumerable, but it MUST NOT be described as an authorization secret. Page access controls, Cloudflare rate limiting, WAF rules, and telemetry provide the V1 abuse boundary.

A requirement for strict private playback MUST trigger an ADR and a tested signed-access design. Such a design MUST preserve CDN cache efficiency for immutable segments, MUST avoid long-lived reusable tokens in logs or object keys, and MUST define revocation behavior. Direct public R2 custom-domain delivery MUST NOT be documented as per-viewer authenticated delivery.

## Event lifecycle

The canonical event media states are:

```text
SCHEDULED -> READY -> LIVE -> INTERRUPTED -> LIVE
LIVE|INTERRUPTED -> ENDING -> FINALIZING -> VOD_READY
VOD_READY -> ARCHIVING -> ARCHIVED
Any state -> FAILED_RECOVERABLE
SCHEDULED|READY -> CANCELLED
```

`INTERRUPTED` is not terminal. A disconnect MUST NOT erase the event or close VOD. Manual End Live may transition an active or interrupted event to `ENDING`.

Automatic ending occurs only after the scheduled end plus a default three-hour grace period and after no publisher has been active for at least 120 seconds. The grace period MAY be configured between two and three hours per product policy. The platform MUST not auto-finalize solely because a field connection dropped briefly.

State transitions MUST be idempotent, timestamped, attributable to system or operator, and guarded against stale updates.

## VOD finalization

Finalization MUST wait until all discovered local segment jobs for the event are resolved or an operator explicitly accepts a documented gap. It MUST construct a full playlist from all R2-confirmed segments in chronological order, include discontinuities, and append `#EXT-X-ENDLIST`.

The VOD playlist MUST be validated by parsing and by fetching every referenced object through the production delivery path. The event becomes `VOD_READY` only after validation succeeds.

MP4 creation is optional. Remux MUST use `-c copy` only when source compatibility is proven. If the event contains incompatible codec changes, the implementation MUST preserve multiple MP4 parts or leave HLS as the canonical VOD; it MUST NOT silently re-encode on a CPU media node.

## YouTube relay

YouTube relay is optional per event and MUST be isolated from the primary pipeline. For V1 H.264/AAC, FFmpeg SHOULD pull from the local SRS stream and publish RTMPS to YouTube using stream copy. Relay restart policy MUST be bounded and observable. Relay stderr MUST redact destination keys.

A YouTube failure MUST update relay status and alert operations but MUST NOT change primary EventCast stream status to failed.

## Wasabi archive

Archive begins only after `VOD_READY`. The copy job MUST include the VOD playlist, all media it references, metadata, and archive manifest. It MAY include the live playlist for diagnostics and any valid MP4 derivative.

The archive worker MUST compute or reuse trusted SHA-256 values and preserve them as destination metadata. It MUST verify destination object count, key set, byte size, and metadata. The per-object payload list MUST exclude `archive-manifest.json` itself; after uploading the completed manifest, the worker MUST compute its digest and store that digest separately in the control plane and/or immutable destination metadata. It SHOULD perform periodic restore sampling because metadata equality alone is not an end-to-end readback proof.

An archive job MUST be resumable and idempotent. Existing matching destination objects SHOULD be skipped. Mismatched objects MUST be replaced only after a new verified upload succeeds.

Wasabi Pay-as-You-Go objects are normally subject to a 90-day minimum storage duration. Archive retention policy MUST therefore be at least 90 days unless the account contract explicitly provides different terms.

## Retention and deletion

Local spool cleanup is allowed only when the segment is R2-confirmed, the event is VOD-ready and validated, the local safety period has elapsed, and no active recovery process needs the file. If the event policy requires Wasabi archival, `archive_verified_at` MUST also be present before routine local-spool deletion. The default local safety period after VOD finalization is 24 hours. An emergency disk-pressure override MAY delete an otherwise eligible local copy before Wasabi verification only through an explicit operator-approved procedure, only after the complete R2 VOD has been validated, and only with an audit record and critical alert.

R2 is hot storage for live and recent VOD. The default R2 cleanup eligibility is seven days after archive verification, configurable by package and business policy. Cleanup MUST be application-driven and guarded by `archive_verified_at`. An R2 lifecycle rule MAY act as a delayed backstop but MUST NOT be the only archive-safety check.

Wasabi deletion follows customer retention and minimum-duration billing constraints. Deletion actions MUST be auditable and must not be inferred from an event merely becoming inactive.

## Node assignment and capacity

The control plane MUST assign each event to exactly one primary media node before publishing begins. A node MUST advertise health, available disk, active stream count, upload lag, and maintenance status.

The initial hard scheduling limit is ten concurrent live pass-through events per production node. The scheduler MUST use the lower of the configured hard limit and resource-based capacity. A node with critical disk, R2 backlog, or unhealthy Media Agent MUST not receive new events.

Paid production MUST have at least two nodes so events can be distributed. V1 does not automatically migrate an active RTMP connection. Backup ingest is a separate feature.

## Security requirements

Stream secret tokens MUST contain at least 128 bits of cryptographic randomness, be stored hashed where verification permits, be revocable, and never appear in filesystem paths, public object paths, or application logs. The non-secret `ingest_id` may appear in SRS staging paths but must remain distinct from the public `playback_id`. Publishing windows MUST limit when a key is accepted.

R2 and Wasabi credentials MUST be separate, least-privilege, stored outside source control, and rotated. Supabase service credentials MUST never be exposed to clients. Internal callback endpoints MUST bind to loopback or a private network only.

Production firewall rules SHOULD expose only required publishing ports, HTTPS, and restricted administration access. SSH SHOULD be limited to trusted IPs or a secure access layer. Metrics, SQLite, SRS API, and spool directories MUST not be public.

## Observability requirements

SRS exporter metrics, host metrics, Media Agent metrics, structured logs, and player telemetry MUST be available. Required metrics include active streams, ingest bitrate, latest local segment age, latest R2-confirmed segment age, upload queue age and bytes, upload error rate, manifest age, disk free space, YouTube relay state, archive backlog, and event-state transition failures.

Warning alerts SHOULD fire when R2 confirmation lag exceeds 20 seconds, disk free space falls below 25%, or a live stream has no new local segment for three expected segment durations. Critical alerts MUST fire when lag exceeds 60 seconds, disk free space falls below 15%, a manifest references a missing object, the Media Agent queue database is unhealthy, or a scheduled paid event's assigned node is unavailable.

## Production acceptance

The platform MUST pass the complete gate in `07_TEST_AND_ACCEPTANCE_PLAN.md`. Documentation review, successful demo playback, or a short single-stream test is not sufficient for production approval.
