# 01 — System Architecture

## Architecture goals

EventCast.pro must deliver long wedding and event livestreams reliably over variable field networks while keeping viewer delivery cost predictable. The platform must protect recordings from process crashes and temporary storage-provider failures, support ten to fifteen minutes of live DVR, produce VOD immediately after the event, restream to YouTube without coupling YouTube availability to the primary stream, and scale by adding media nodes instead of redesigning the system.

The architecture separates the control plane from the media plane. The control plane handles users, events, billing, stream credentials, scheduling, node assignment, status, and playback authorization. The media plane handles live packets, segment creation, durable local buffering, object-storage upload, playlist publication, and archive transfer.

## System context

```mermaid
flowchart LR
    E[OBS / Kiloview Encoder] -->|RTMP H.264 + AAC| SRS[SRS Media Node]
    SRS -->|Completed MPEG-TS staging files| ST[SRS output directory]
    SRS -->|on_publish / on_hls / on_unpublish| MA[EventCast Media Agent]
    ST -->|Hard-link or atomic copy| SP[Media Agent durable spool]
    MA <--> SP
    MA -->|Durable ordered upload| R2[Cloudflare R2 Standard]
    MA -->|State and aggregate metrics| CP[EventCast Control Plane]
    CP <--> DB[(Supabase PostgreSQL)]
    R2 -->|Immutable segments via cache| CDN[Cloudflare edge]
    CDN --> P[Web HLS Player]
    MA -->|Independent RTMP relay| YT[YouTube Live]
    R2 -->|Verified post-live copy| WA[Wasabi Archive]
    MON[Datadog Agent / OpenMetrics] <-- SRS
    MON <-- MA
    MON <-- SP
```

## Control plane

The existing EventCast web and admin application remains the control plane. It is responsible for creating events, issuing and rotating stream keys, assigning events to media nodes, recording scheduled start and end times, accepting manual End Live actions, publishing player configuration, and displaying operational status.

Supabase PostgreSQL stores event-level and session-level metadata. It does not store media bytes and does not receive one row per HLS segment. Per-segment durable queue state lives in the media node's local SQLite database, while a finalized archive manifest containing per-object checksums is stored as an object in R2 and Wasabi.

The control plane must not be in the synchronous packet path. A temporary Supabase or web application outage must not stop an already-authorized stream. Before the event's publishing window, the assigned media node receives and caches the minimum authorization and event configuration required to operate independently for the event duration.

## Media node

A media node is a Linux dedicated server with a dedicated public network interface and mirrored local storage. It runs a pinned SRS container, the EventCast Media Agent, FFmpeg for optional YouTube relay and post-live remuxing, a Datadog Agent, and standard host monitoring.

SRS is the protocol and packaging engine. V1 accepts RTMP, validates publishing through a local callback, and remuxes H.264/AAC into MPEG-TS HLS without video transcoding. SRS writes completed HLS output to a host-mounted staging directory. It does not publish the public R2 playlist. Although automatic SRS cleanup is disabled, EventCast does not treat SRS-owned filenames as the only durable copy because SRS shutdown behavior may remove its HLS files.

The EventCast Media Agent is the orchestration and durability component. It is implemented as a Go service with a local SQLite WAL database. It handles SRS callbacks, validates publishers against the node's local event cache, captures every completed segment into its own protected spool using a same-filesystem hard link or an atomic copy-and-fsync fallback, records immutable upload jobs, uploads segments to R2, verifies persistence, builds the authoritative live playlist, finalizes VOD, supervises YouTube relay processes, archives to Wasabi, reports aggregate status, and reconciles disk state after restarts.

## Live ingest flow

The control plane assigns an event to a specific media node and provides a primary ingest URL. The encoder publishes using a non-secret opaque ingest identifier plus a random, revocable secret token in the encoder stream-key value. SRS calls the local Media Agent `on_publish` endpoint. The Media Agent rejects expired, disabled, incorrectly assigned, or already-active keys and returns success for a valid event.

On successful publication, the Media Agent creates a new ingest session identifier. Reconnects create additional sessions under the same event. Session identifiers ensure that segments created after a reconnect or process restart cannot overwrite earlier objects.

SRS creates a complete MPEG-TS staging file and invokes `on_hls` with its path, duration, and sequence number. Before acknowledging the callback, the Media Agent creates a protected hard link on the same filesystem or copies the file to a temporary destination, fsyncs it, and atomically renames it into the durable spool. It then writes an idempotent upload job to SQLite. This protects pending media even if SRS later removes its own staging files during shutdown. A reconciliation scanner also discovers completed staging and durable-spool files, so a lost callback cannot permanently lose a segment while the staging file remains available.

## Ordered R2 publication flow

For each event, upload jobs are processed in media order. The Media Agent computes a SHA-256 digest, uploads the immutable segment to R2 Standard through the S3-compatible API, and records the returned object metadata. A successful upload is confirmed using the API response and a HEAD check for object size and expected metadata.

Only then does the Media Agent append the segment to its authoritative manifest state and publish a new live playlist generation. The playlist is written atomically and includes only R2-confirmed segments. This prevents the common race in which an `.m3u8` file becomes visible before one of its referenced media objects.

All event segments remain in R2 during the live event even after they leave the public fifteen-minute live window. The live playlist contains only the most recent DVR window. The final VOD playlist references all successfully persisted event segments.

## Viewer delivery flow

The HLS player loads a manifest through the Cloudflare delivery layer. Mutable live manifests receive `no-store` behavior or an explicitly tested edge TTL no greater than one second. Cloudflare rules must bypass cache for live `.m3u8` responses and must not cache 404 responses for manifest paths. Immutable `.ts` segments are served from the R2 custom domain through Cloudflare cache with a long immutable TTL. Production never uses the rate-limited `r2.dev` endpoint.

V1 has one source-quality rendition and therefore no adaptive bitrate ladder. The player uses hls.js where Media Source Extensions are required and native HLS where appropriate. Playback telemetry reports startup failure, fatal HLS errors, buffering, live-edge distance, and segment HTTP errors without blocking playback.


## Playback access model

V1 media delivery is public/unlisted rather than cryptographically private. The opaque `playback_id` prevents easy enumeration, while the application controls discovery of the event page and Cloudflare provides rate limiting, WAF rules, and abuse controls. A public R2 custom domain cannot simultaneously be described as enforcing per-viewer authorization unless an additional signed-access layer is implemented.

If a customer package later requires strict private playback, EventCast must add a separately approved design such as a Worker-based signed-cookie or token gateway that keeps immutable segment URLs cache-friendly. Query-string authorization that fragments the CDN cache or exposes reusable secrets in logs must not be introduced informally.

## DVR and reconnect behavior

The public live playlist retains fifteen minutes of completed media. Reconnection gaps are represented by `#EXT-X-DISCONTINUITY`. The platform does not invent media for a missing interval. When the encoder returns, the playlist continues with the new session.

A publisher disconnect does not finalize the event. The state becomes interrupted while the event remains within its allowed live period. Finalization begins only after a manual End Live action or after the scheduled end plus the configured auto-end grace period, followed by a quiet period with no active publisher.

## VOD finalization

At finalization, the Media Agent stops accepting new playlist mutations for the final generation, verifies that every acknowledged segment job has either succeeded or is explicitly marked unrecoverable, writes the full VOD playlist, inserts discontinuities between sessions, and appends `#EXT-X-ENDLIST`. This makes the same R2 media immediately replayable without waiting for a large MP4 upload.

A downloadable MP4 is a secondary derivative. If all sessions use compatible codecs and timestamps, FFmpeg may remux them without re-encoding. If codec changes or discontinuities prevent safe single-file remuxing, the system preserves multiple playable parts rather than silently producing a corrupt file. GPU transcoding and forced single-file normalization are outside V1.

## Wasabi archival

After VOD finalization, a low-priority archive job copies the finalized event objects from R2 to Wasabi using S3-compatible APIs. Cross-provider transfer streams through the archive worker; it is not assumed to be a provider-side copy. The job pauses or throttles when live workload or node network utilization exceeds the configured safety threshold.

The archive contains the VOD playlist, all referenced media segments, event metadata, and an archive manifest listing key, size, content type, session, sequence, duration, and SHA-256 digest for every required payload object. The archive manifest MUST NOT include itself in that per-object list, avoiding a recursive checksum definition. Its own SHA-256 digest is recorded separately in the control plane and/or immutable destination metadata after the manifest upload. An optional MP4 derivative is archived when available. The event is marked archived only after destination object counts, sizes, metadata, payload manifest, and separately stored manifest digest checks pass.

R2 cleanup is never part of the archive copy transaction. A separate guarded cleanup job removes hot objects only after archive verification and the configured R2 retention period. When archival is required, the protected local spool also remains until archive verification and its local retention period have both completed, except under an explicitly audited emergency disk-pressure procedure. Wasabi is archive storage, not the normal viewer origin. An archived event must be restored to R2 before normal playback is re-enabled.

## YouTube restream

For V1 H.264/AAC streams, the Media Agent may start an FFmpeg process that reads the local SRS stream and publishes to YouTube using stream copy. The relay has independent restart and health logic. YouTube errors, key problems, or rate limits must not stop SRS packaging, R2 upload, or EventCast playback.

Future H.265 ingest cannot be assumed to restream to YouTube without transcoding or a separate H.264 encoder output. That requirement is deferred with the H.265 premium workflow.

## Scaling and failure domains

Each event is assigned to one primary node. Adding nodes increases capacity and limits the number of events affected by one server failure. V1 does not implement a shared writable HLS origin or split-brain playlist writer. At any time, exactly one Media Agent owns the public manifest for an event.

A production account must use at least two nodes and distribute events between them. This is sharding and blast-radius reduction, not seamless active-active ingest. Premium workflows may provide a backup ingest destination or encoder dual-publish later.

Viewer traffic never traverses the media node during normal operation. Therefore, node bandwidth is dominated by ingest, R2 upload, YouTube relay, and archive traffic rather than viewer count.

## Reliability boundaries

The architecture protects against Media Agent restart, SRS restart, short R2 write failures, control-plane outage, YouTube failure, and temporary archive failure without losing already completed local segments. It cannot provide uninterrupted playback during a prolonged R2/CDN outage, complete media-node hardware loss before local segments reach R2, encoder failure, or field-network failure. Those risks require independent origins, dual publishing, or additional providers and are not hidden by the V1 design.
