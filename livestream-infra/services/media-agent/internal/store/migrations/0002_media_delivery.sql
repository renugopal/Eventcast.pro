-- Media delivery: R2 upload, live/DVR/VOD manifests, retention, and
-- YouTube relay (v1.2 "Media Delivery, DVR/VOD, and Relay").
--
-- segment_jobs gains the upload-tracking columns
-- 03_DATA_MODEL_AND_API_CONTRACTS.md "Local SQLite schema
-- responsibilities" already specifies ("R2 object key, attempt count,
-- last error, next attempt time, upload status, and manifest-commit
-- status"), kept distinct from the existing "status" column, which
-- reflects local durable *capture* only, not remote persistence: a row
-- can be status='queued' (safely captured) while independently
-- progressing through upload_status. manifest_generations,
-- vod_finalizations, and youtube_relays are the remaining tables the
-- same document lists as belonging to this phase.

-- Segments and manifests are addressed by the event's opaque
-- playback_id (02_V1_ARCHITECTURE_SPEC.md "R2 object layout": "Public
-- object paths MUST use an opaque playback_id"). It is resolved on
-- demand from the existing cached_event_assignments table via
-- GetAssignmentByEventID rather than duplicated onto ingest_sessions,
-- since within one process lifetime an event's cached assignment is
-- stable once its session exists.
CREATE INDEX idx_cached_event_assignments_event_id
    ON cached_event_assignments(event_id);

-- Non-secret YouTube relay authorization (ADR-012). The raw stream key
-- deliberately has no column here: it is resolved from the same seed
-- file directly into an in-memory-only lookup the relay supervisor
-- consults, so it is never durably persisted, logged, or exposed
-- through GetAssignment/GetAssignmentByEventID.
ALTER TABLE cached_event_assignments ADD COLUMN youtube_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cached_event_assignments ADD COLUMN youtube_destination_base_url TEXT NOT NULL DEFAULT '';

ALTER TABLE segment_jobs ADD COLUMN r2_key TEXT NOT NULL DEFAULT '';
ALTER TABLE segment_jobs ADD COLUMN upload_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (upload_status IN ('pending', 'leased', 'confirmed', 'dead_letter'));
ALTER TABLE segment_jobs ADD COLUMN upload_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE segment_jobs ADD COLUMN upload_last_error TEXT NOT NULL DEFAULT '';
ALTER TABLE segment_jobs ADD COLUMN upload_next_attempt_at TEXT NOT NULL DEFAULT '';
ALTER TABLE segment_jobs ADD COLUMN upload_lease_owner TEXT NOT NULL DEFAULT '';
ALTER TABLE segment_jobs ADD COLUMN upload_lease_expires_at TEXT NOT NULL DEFAULT '';
ALTER TABLE segment_jobs ADD COLUMN uploaded_at TEXT NOT NULL DEFAULT '';
ALTER TABLE segment_jobs ADD COLUMN manifest_commit_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (manifest_commit_status IN ('pending', 'committed'));
ALTER TABLE segment_jobs ADD COLUMN local_deleted_at TEXT NOT NULL DEFAULT '';

-- Supports the upload worker's atomic claim-or-steal-expired-lease
-- query (status must be 'queued' - durably captured - before a segment
-- is eligible for upload at all).
CREATE INDEX idx_segment_jobs_upload_claim
    ON segment_jobs(status, upload_status, upload_next_attempt_at);

-- Supports manifest generation's per-event confirmed-segment scan.
CREATE INDEX idx_segment_jobs_event_upload_status
    ON segment_jobs(event_id, upload_status, id);

-- One row per (event, manifest_type, generation): the exact ordered
-- segment id set that produced that manifest object, so republishing an
-- unchanged set is detectable and skippable, and every publish is
-- auditable (03_DATA_MODEL_AND_API_CONTRACTS.md "manifest_generations
-- MUST record which exact ordered segment set produced each R2
-- playlist generation").
CREATE TABLE manifest_generations (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id       TEXT NOT NULL,
    manifest_type  TEXT NOT NULL CHECK (manifest_type IN ('live', 'vod')),
    generation     INTEGER NOT NULL,
    segment_ids    TEXT NOT NULL,
    media_sequence INTEGER NOT NULL DEFAULT 0,
    segment_count  INTEGER NOT NULL DEFAULT 0,
    r2_key         TEXT NOT NULL DEFAULT '',
    published_at   TEXT NOT NULL,
    UNIQUE (event_id, manifest_type, generation)
);

CREATE INDEX idx_manifest_generations_latest
    ON manifest_generations(event_id, manifest_type, generation DESC);

-- One row per event: the durable record of VOD finalization
-- (02_V1_ARCHITECTURE_SPEC.md "VOD finalization").
CREATE TABLE vod_finalizations (
    event_id      TEXT PRIMARY KEY,
    status        TEXT NOT NULL CHECK (status IN ('pending', 'finalized', 'failed')),
    segment_ids   TEXT NOT NULL DEFAULT '',
    session_count INTEGER NOT NULL DEFAULT 0,
    r2_key        TEXT NOT NULL DEFAULT '',
    last_error    TEXT NOT NULL DEFAULT '',
    finalized_at  TEXT NOT NULL DEFAULT '',
    updated_at    TEXT NOT NULL
);

-- One row per ingest session that had YouTube relay enabled
-- (02_V1_ARCHITECTURE_SPEC.md "YouTube relay", ADR-012: relay is an
-- independent failure domain and never affects primary event status).
CREATE TABLE youtube_relays (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id      TEXT NOT NULL,
    session_id    TEXT NOT NULL UNIQUE,
    status        TEXT NOT NULL CHECK (status IN ('starting', 'running', 'stopped', 'failed')),
    restart_count INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT NOT NULL DEFAULT '',
    started_at    TEXT NOT NULL DEFAULT '',
    stopped_at    TEXT NOT NULL DEFAULT '',
    updated_at    TEXT NOT NULL
);

CREATE INDEX idx_youtube_relays_event
    ON youtube_relays(event_id);
