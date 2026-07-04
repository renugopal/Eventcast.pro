-- Initial Media Agent durable schema (v1.2 ingest control and durability).
--
-- Tables correspond to the local SQLite schema responsibilities in
-- 03_DATA_MODEL_AND_API_CONTRACTS.md: cached_event_assignments and
-- ingest_sessions (stream_sessions equivalent) here, plus segment_jobs,
-- the durable queue of captured-but-not-yet-uploaded HLS segments.
-- manifest_generations, youtube_relays, archive_jobs, and agent_outbox
-- belong to later phases (ordered R2 upload, manifest generation,
-- relay, archive) and are intentionally not created yet.

CREATE TABLE cached_event_assignments (
    ingest_id                TEXT PRIMARY KEY,
    event_id                 TEXT NOT NULL,
    playback_id              TEXT NOT NULL,
    secret_token_hash        TEXT NOT NULL,
    enabled                  INTEGER NOT NULL DEFAULT 1,
    publish_window_start_at  TEXT NOT NULL,
    publish_window_end_at    TEXT NOT NULL,
    config_version           TEXT NOT NULL DEFAULT '',
    updated_at                TEXT NOT NULL
);

CREATE TABLE ingest_sessions (
    id                 TEXT PRIMARY KEY,
    event_id           TEXT NOT NULL,
    ingest_id          TEXT NOT NULL,
    status             TEXT NOT NULL CHECK (status IN ('starting', 'active', 'disconnected', 'finalized', 'failed')),
    started_at         TEXT NOT NULL,
    disconnected_at    TEXT,
    end_reason         TEXT NOT NULL DEFAULT '',
    last_activity_at   TEXT NOT NULL,
    segment_count      INTEGER NOT NULL DEFAULT 0
);

-- At most one starting/active session per event at a time. This is the
-- authoritative, concurrency-safe guard against a conflicting active
-- publisher: a second concurrent on_publish for the same event fails
-- this constraint rather than racing an application-level check.
CREATE UNIQUE INDEX idx_ingest_sessions_one_active_per_event
    ON ingest_sessions(event_id)
    WHERE status IN ('starting', 'active');

CREATE INDEX idx_ingest_sessions_ingest_id
    ON ingest_sessions(ingest_id, started_at);

CREATE TABLE segment_jobs (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    idempotency_key       TEXT NOT NULL UNIQUE,
    event_id              TEXT NOT NULL,
    session_id            TEXT NOT NULL,
    local_file_identity   TEXT NOT NULL,
    seq_no                INTEGER NOT NULL,
    duration_seconds      REAL NOT NULL,
    spool_path            TEXT NOT NULL DEFAULT '',
    byte_size             INTEGER NOT NULL DEFAULT 0,
    sha256                TEXT NOT NULL DEFAULT '',
    status                TEXT NOT NULL DEFAULT 'capturing' CHECK (status IN ('capturing', 'queued', 'missing', 'failed')),
    attempt_count         INTEGER NOT NULL DEFAULT 1,
    last_error            TEXT NOT NULL DEFAULT '',
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);

CREATE INDEX idx_segment_jobs_event_session
    ON segment_jobs(event_id, session_id);

CREATE INDEX idx_segment_jobs_status
    ON segment_jobs(status);
