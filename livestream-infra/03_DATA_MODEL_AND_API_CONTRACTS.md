# 03 — Data Model and API Contracts

## Data ownership

Supabase PostgreSQL stores durable business and aggregate media state. The media node's SQLite database stores high-frequency per-segment work state. R2 and Wasabi store media objects and the finalized per-object archive manifest. No component may create a second authoritative copy of the same state without an explicit reconciliation rule.

## Required control-plane entities

### `media_nodes`

Required fields are `id`, `name`, `region`, `ingest_hostname`, `status`, `maintenance_mode`, `hard_stream_limit`, `active_stream_count`, `disk_free_bytes`, `r2_queue_bytes`, `last_heartbeat_at`, `software_version`, `config_version`, `created_at`, and `updated_at`.

Valid node status values are `provisioning`, `healthy`, `degraded`, `unavailable`, and `retired`. Only healthy nodes outside maintenance mode may receive new assignments.

### `events`

The existing event record must include or reference `id`, `playback_id`, `scheduled_start_at`, `scheduled_end_at`, `auto_end_grace_seconds`, `media_state`, `assigned_media_node_id`, `ingest_id`, `stream_secret_hash`, `stream_key_enabled`, `publish_window_start_at`, `publish_window_end_at`, `youtube_enabled`, `youtube_secret_reference`, `vod_ready_at`, `archive_verified_at`, `r2_delete_eligible_at`, and retention policy identifiers.

`playback_id` is a random opaque identifier used in media paths. It is not an authorization secret, must not be predictable, and provides unlisted discovery resistance only. Strict private playback requires a separate approved signed-access contract.

### `stream_sessions`

Each accepted publisher connection creates a session with `id`, `event_id`, `media_node_id`, `protocol`, `video_codec`, `audio_codec`, `width`, `height`, `fps`, `declared_bitrate`, `started_at`, `disconnected_at`, `end_reason`, `first_segment_at`, `last_segment_at`, `segment_count`, `r2_confirmed_count`, `bytes_received`, and `status`.

Session status values are `starting`, `active`, `disconnected`, `finalized`, and `failed`. A reconnect creates a new row rather than reopening and mutating the old session identity.

### `media_jobs`

Control-plane media jobs are aggregate jobs, not one row per segment. Required job types are `finalize_vod`, `create_mp4`, `archive_to_wasabi`, `restore_to_r2`, and `delete_r2_hot_copy`. Required fields are `id`, `event_id`, `type`, `status`, `attempt`, `progress`, `worker_node_id`, `created_at`, `started_at`, `completed_at`, `last_error_code`, and `last_error_summary`.

Job status values are `queued`, `running`, `paused`, `retry_wait`, `succeeded`, `failed_recoverable`, and `cancelled`.

### `event_state_transitions`

Every media-state change must append an audit row containing `event_id`, `from_state`, `to_state`, `actor_type`, `actor_id`, `reason_code`, `details`, and `created_at`. State history is append-only.

## Local SQLite schema responsibilities

The local database MUST contain tables equivalent to `cached_event_assignments`, `ingest_sessions`, `segment_jobs`, `manifest_generations`, `youtube_relays`, `archive_jobs`, and `agent_outbox`.

`segment_jobs` MUST enforce a unique idempotency key. `manifest_generations` MUST record which exact ordered segment set produced each R2 playlist generation. `agent_outbox` MUST persist control-plane status messages until acknowledged, allowing the media plane to operate during a temporary control-plane outage.

SQLite MUST use WAL mode, foreign keys, busy timeout, periodic checkpointing, and regular integrity checks. Database files MUST be on persistent storage and backed up together with the spool's recovery metadata.

## Internal control-plane API

All node-to-control-plane requests MUST be authenticated with a rotatable node credential. Requests MUST include a unique request ID, node ID, timestamp, and idempotency key. The API MUST reject stale or replayed requests outside the accepted clock window.

Required logical operations are:

```text
POST /internal/media/nodes/heartbeat
POST /internal/media/events/{eventId}/sessions
PATCH /internal/media/sessions/{sessionId}
POST /internal/media/events/{eventId}/state-transitions
POST /internal/media/events/{eventId}/metrics-summary
POST /internal/media/jobs/{jobId}/progress
POST /internal/media/events/{eventId}/vod-ready
POST /internal/media/events/{eventId}/archive-verified
GET  /internal/media/nodes/{nodeId}/assignments
GET  /internal/media/events/by-stream-key/{keyFingerprint}
```

Exact route placement may follow the existing application convention, but request and response semantics must remain equivalent.

## Assignment synchronization

Before `publish_window_start_at`, the control plane sends or makes available the event assignment to the selected node. The node periodically pulls assignments and stores a local cache. A valid cached assignment contains the event ID, playback ID, hashed or verifiable stream credential, publish window, scheduled end, grace period, YouTube configuration reference, retention policy, and configuration version.

If the control plane is unreachable during `on_publish`, the Media Agent MAY accept a publisher only when an unexpired, cryptographically valid cached assignment exists for that node. It MUST reject unknown or revoked keys. Revocation propagation target is under one minute while connectivity is healthy.

## SRS callback contracts

### `POST /internal/srs/on-publish`

The request is the SRS callback payload. The Media Agent extracts the non-secret ingest identifier from the SRS stream name and the secret token from callback parameters, validates both, and creates a session. Success returns HTTP 200 with `{"code":0}`. Rejection returns HTTP 200 with a non-zero code or another SRS-compatible rejection response.

The handler MUST be fast and MUST not perform R2 or Wasabi operations. It may use the local cache and SQLite transaction only.

### `POST /internal/srs/on-hls`

The handler receives `file`, `url`, `m3u8`, `duration`, `seq_no`, `stream`, `app`, and SRS identifiers. It validates the active session and resolves the file under the SRS staging root. It then hard-links the completed file into the protected Media Agent spool and fsyncs the spool directory, or performs an atomic copy/rename/fsync fallback, writes an idempotent segment job, and returns success. Reconciliation covers the crash boundary between filesystem persistence and the SQLite transaction. The upload happens asynchronously.

A callback success means “durably captured and queued,” not “already present in R2.”

### `POST /internal/srs/on-unpublish`

The handler closes the current session, records the disconnect reason when known, and emits an outbox status update. It does not delete files, close the event, or publish `ENDLIST`.

## Manifest data model

The Media Agent internally represents each committed segment with `event_id`, `session_id`, `sequence`, `program_time`, `duration`, `r2_key`, `size`, `sha256`, and `discontinuity_before`.

The live manifest is a projection of the newest committed segments whose combined duration is approximately 900 seconds. The VOD manifest is a projection of all committed segments. The same media object may be referenced by both manifests without duplication.

Only one active manifest writer lease may exist per event. In V1 the lease is implied by the event's node assignment and local session ownership. A future distributed lease must be an explicit architecture change.

## Archive manifest contract

`archive-manifest.json` MUST include a schema version, event ID, playback ID, creation time, source R2 bucket, Wasabi destination, media profile summary, session list, total bytes, total duration, object count, and one record per archived object.

Each payload object record MUST include source key, destination key, size, content type, SHA-256, upload status, and verification time. `archive-manifest.json` itself MUST be excluded from this payload-object array so its checksum is not recursively self-referential. After the completed manifest is uploaded, its SHA-256 digest MUST be stored separately in the control plane or immutable destination metadata.

An event is archive-verified only when the stored manifest is complete, all required records are verified, and the manifest digest has been recorded.

## Error model

Internal APIs and Media Agent jobs MUST use stable machine-readable error codes. Required categories include `AUTH_INVALID`, `ASSIGNMENT_MISMATCH`, `PUBLISH_WINDOW_CLOSED`, `DUPLICATE_PUBLISHER`, `SPOOL_FILE_MISSING`, `SPOOL_FILE_UNSTABLE`, `R2_AUTH`, `R2_RETRYABLE`, `R2_OBJECT_MISMATCH`, `MANIFEST_GAP`, `MANIFEST_PUBLISH_FAILED`, `YOUTUBE_RELAY_FAILED`, `WASABI_AUTH`, `WASABI_RETRYABLE`, `ARCHIVE_MISMATCH`, `DISK_PRESSURE`, and `STATE_CONFLICT`.

User-facing messages must not expose provider credentials, stream keys, local paths, or raw FFmpeg command lines.

## Idempotency and concurrency

All state-changing API calls MUST be idempotent. Repeating a callback, upload completion, VOD-ready notification, or archive completion must produce the same result without duplicate rows or playlist entries.

Database state transitions MUST use compare-and-set semantics against the expected prior state or an equivalent transactional guard. A stale worker must not overwrite a newer event state.
