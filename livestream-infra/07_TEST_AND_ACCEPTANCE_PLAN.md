# 07 — Test and Acceptance Plan

## Test principles

Production approval requires evidence from the exact pinned software and production-equivalent hardware. Tests must verify media correctness, data durability, recovery, and operational visibility. A test passes only when its logs, metrics, object inventory, and playback results are retained in a validation report.


## Configuration compatibility test

Start the exact pinned SRS image with the generated production configuration and fail the build or deployment if parsing/startup fails. Publish a real H.264/AAC stream and verify the actual `on_publish`, `on_hls`, and `on_unpublish` payloads and response behavior. A configuration copied from documentation without this exact-image test is not accepted.

## Manifest cache and negative-cache test

Request a live manifest before and after creation, update it repeatedly, and verify through the production custom domain that Cloudflare does not retain a stale manifest or a cached 404. Verify response headers and effective edge behavior, not only origin headers. Immutable segments must still achieve the intended cache behavior.

## Playback access-boundary test

Confirm that V1 is documented and presented as public/unlisted media delivery. Verify that playback identifiers are non-enumerable, secrets never appear in URLs or logs, rate limits and abuse controls are active, and no UI claims strict private-media authorization unless the signed-access feature has been separately implemented and accepted.

## Functional acceptance

A valid RTMP publisher must be accepted only on its assigned node and within its publishing window. Invalid, revoked, expired, and duplicate publishers must be rejected. H.264/AAC input must create playable four-second-target MPEG-TS segments and a live playlist with a fifteen-minute DVR window.

Every public segment reference must resolve successfully. The final VOD must contain all confirmed segments in chronological order, preserve reconnect gaps as discontinuities, include ENDLIST, and play from beginning to end.

YouTube relay must start and stop per event without affecting primary playback. Wasabi archive and restore must preserve the complete object set.

## Long-duration soak

Run at least one uninterrupted eight-hour stream and one eight-hour stream with controlled reconnects. During the test, monitor SRS memory, Media Agent memory, file descriptors, SQLite size, queue latency, disk growth, R2 upload latency, playlist age, and player behavior.

Acceptance requires no unexplained process restart, no missing confirmed segment, no duplicate playlist entry, no steadily growing unreclaimed memory, and no corruption in the final VOD.

## Ordered-publication test

Artificially delay and fail selected R2 uploads while SRS continues creating segments. The live playlist must stop before the delayed object and must never reference it early. When the upload succeeds, the playlist must advance in correct order. Segment HTTP 404 caused by publication order is a P0 failure.

## Callback and reconciliation test

Drop selected `on_hls` callbacks and restart the Media Agent. The reconciliation scanner must discover available staging files and protected spool files, create jobs once, upload them, and include them in the correct manifest order. Duplicate callbacks must not create duplicate hard links, copies, jobs, or playlist entries. Stop SRS after completed callbacks and confirm that the protected Media Agent copies remain available even if SRS removes its own output.

## R2 outage simulation

Block R2 access for at least fifteen minutes while ingest continues. Local spool and SQLite queue must preserve all segments. Disk and backlog alerts must fire. After access returns, the queue must drain without duplicate objects or missing media, and VOD must include the outage interval.

Viewer playback may stall during the outage because the playlist cannot safely advance. The test evaluates data preservation and recovery, not impossible uninterrupted delivery from a failed single origin.

## Process restart tests

Restart the Media Agent during live ingest. It must recover its queue, ownership, manifest state, and outbox. Restart SRS and reconnect the encoder. The new ingest session must not overwrite prior objects and must produce a discontinuity. Reboot the host and validate complete recovery from persistent storage.

## Control-plane outage test

Disable access to Supabase/control APIs after the node has cached a valid assignment. An already-running event must continue. A valid cached publisher within its window may reconnect. Status updates must accumulate in the outbox and synchronize after recovery. Unknown publishers must remain rejected.

## Disk-pressure test

Drive free space below warning and critical thresholds in a controlled environment. Alerts must fire, the scheduler must stop assigning new events, archival and nonessential jobs must throttle or pause, and active media must not be deleted unsafely. At the emergency threshold, the system must prefer explicit degraded state over silent corruption.

## YouTube isolation test

Use an invalid key, block YouTube, and kill the FFmpeg relay. EventCast HLS must remain live and VOD must remain complete. Relay state and alerts must accurately reflect failure.

## Archive failure and restore test

Interrupt the R2-to-Wasabi transfer at multiple points, restart the worker, and verify resume behavior. Corrupt or replace one destination object and ensure archive verification fails. After a successful archive, restore the event into an empty R2 prefix and validate playback through Cloudflare.


## Archive-manifest integrity test

Build an archive whose payload manifest excludes `archive-manifest.json` itself, upload the completed manifest, and verify that its own digest is stored separately. Alter one payload object and then alter the manifest object independently; each corruption must be detected by the appropriate verification path.

## Local-spool deletion-gate test

For an event requiring Wasabi archival, confirm that routine local cleanup remains blocked after VOD readiness and the local safety period until `archive_verified_at` is recorded. Verify that the emergency disk-pressure override requires explicit operator authorization, retains a validated complete R2 VOD, emits a critical alert, and writes an audit record.

## Load qualification

Run the exact production node at one, five, and ten simultaneous streams using the expected maximum V1 bitrate. Each stream must also upload to R2; a representative subset should relay to YouTube. Archive jobs must be paused during the peak portion and resumed later.

At the ten-stream safety limit, CPU, memory, disk latency, network utilization, queue delay, and SRS responsiveness must retain at least a 30% operational safety margin under normal conditions. If the margin is not met, the hard scheduler limit must be reduced.

## Viewer delivery test

Use distributed clients or a load-testing method that requests the real manifest and segment sequence through the production custom domain. Verify cache behavior, CORS, MIME types, Range behavior where relevant, and absence of stale live manifests. Because viewer bytes are served by Cloudflare, this test focuses on CDN/R2 behavior and player correctness rather than media-node outbound capacity.

## Target service indicators

Under a healthy provider and controlled client network, live manifest age should remain below twelve seconds, R2 confirmation lag should normally remain below twenty seconds, and practical glass-to-glass HLS latency should normally remain in the approximate twelve-to-twenty-five-second range.

The acceptable platform-caused missing-segment rate is zero. The acceptable rate of public playlists referencing unavailable objects is zero. Archive verification must cover one hundred percent of required objects.

## Release gate

Production is blocked by any unresolved data-loss path, manifest-before-segment race, secret exposure, non-idempotent state transition, archive false-positive, spool cleanup before safety conditions, or inability to recover after Media Agent restart.

A release is approved only when all required tests pass, operational alerts are active, rollback has been rehearsed, capacity limits are configured, and the validation report identifies the exact image digests and configuration versions tested.
