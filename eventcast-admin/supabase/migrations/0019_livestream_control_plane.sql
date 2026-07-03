-- ============================================================
-- Migration 0019: Livestream control-plane schema (Phase 0, Task 5)
-- Adds: media_nodes, stream_sessions, media_jobs, event_state_transitions
--       and required livestream columns on the existing events table.
--
-- Source of truth: ../../../livestream-infra/03_DATA_MODEL_AND_API_CONTRACTS.md
-- ("Required control-plane entities"). Field names, enum values, and the
-- event lifecycle below are taken verbatim from that document and from
-- ../../../livestream-infra/02_V1_ARCHITECTURE_SPEC.md ("Event lifecycle").
--
-- Additive only: no DROP, no destructive ALTER, no renamed columns.
-- Supabase stores aggregate control-plane state only; per-HLS-segment
-- state stays in the media node's local SQLite database and is never
-- represented here as one row per segment.
-- ============================================================

-- ============================================================
-- STEP 1: media_nodes
-- ============================================================

CREATE TABLE IF NOT EXISTS media_nodes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  region              TEXT NOT NULL,
  ingest_hostname     TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'provisioning'
                        CHECK (status IN ('provisioning', 'healthy', 'degraded', 'unavailable', 'retired')),
  maintenance_mode    BOOLEAN NOT NULL DEFAULT FALSE,
  hard_stream_limit   INTEGER NOT NULL DEFAULT 10 CHECK (hard_stream_limit > 0),
  active_stream_count INTEGER NOT NULL DEFAULT 0 CHECK (active_stream_count >= 0),
  disk_free_bytes     BIGINT,
  r2_queue_bytes      BIGINT,
  last_heartbeat_at   TIMESTAMPTZ,
  software_version    TEXT,
  config_version      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name),
  UNIQUE (ingest_hostname)
);

COMMENT ON COLUMN media_nodes.status IS
  'Node lifecycle state (ADR-014/03_DATA_MODEL). Only healthy nodes outside maintenance_mode may receive new event assignments.';
COMMENT ON COLUMN media_nodes.maintenance_mode IS
  'Operator-controlled flag that blocks new assignments regardless of status.';
COMMENT ON COLUMN media_nodes.hard_stream_limit IS
  'Scheduler safety limit (ADR-014: 10 concurrent streams per node for V1).';

-- Supports the scheduler query "healthy nodes outside maintenance mode".
CREATE INDEX IF NOT EXISTS idx_media_nodes_assignable
  ON media_nodes (id)
  WHERE status = 'healthy' AND maintenance_mode = FALSE;

CREATE INDEX IF NOT EXISTS idx_media_nodes_status
  ON media_nodes (status);

-- ============================================================
-- STEP 2: Required livestream columns on the existing events table
-- ============================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS playback_id TEXT UNIQUE;

COMMENT ON COLUMN events.playback_id IS
  'Random opaque identifier used in media paths (ADR-020). Not an authorization secret; provides unlisted discovery resistance only.';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS scheduled_end_at TIMESTAMPTZ;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS auto_end_grace_seconds INTEGER NOT NULL DEFAULT 10800
    CHECK (auto_end_grace_seconds > 0);

COMMENT ON COLUMN events.auto_end_grace_seconds IS
  'Grace period after scheduled_end_at plus 120s of publisher silence before auto-finalization (08_OPERATIONS_RUNBOOK: default 3h, configurable 2-3h).';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS media_state TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (media_state IN (
      'scheduled', 'ready', 'live', 'interrupted',
      'ending', 'finalizing', 'vod_ready',
      'archiving', 'archived', 'cancelled'
    ));

COMMENT ON COLUMN events.media_state IS
  'Event media lifecycle state machine (02_V1_ARCHITECTURE_SPEC "Event lifecycle"): scheduled -> ready -> live -> interrupted -> live; live|interrupted -> ending -> finalizing -> vod_ready; vod_ready -> archiving -> archived; scheduled|ready -> cancelled. Changes must be appended to event_state_transitions.';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS assigned_media_node_id UUID REFERENCES media_nodes(id) ON DELETE SET NULL;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS ingest_id TEXT UNIQUE;

COMMENT ON COLUMN events.ingest_id IS
  'Non-secret ingest identifier carried in the SRS stream name (03_DATA_MODEL: on-publish callback).';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS stream_secret_hash TEXT;

COMMENT ON COLUMN events.stream_secret_hash IS
  'Hash of the publisher stream credential. Never stores the raw secret.';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS stream_key_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS publish_window_start_at TIMESTAMPTZ;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS publish_window_end_at TIMESTAMPTZ;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS youtube_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS youtube_secret_reference TEXT;

COMMENT ON COLUMN events.youtube_secret_reference IS
  'Reference to the encrypted YouTube credential in the approved secret store, never the credential itself (ADR-012).';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS vod_ready_at TIMESTAMPTZ;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS archive_verified_at TIMESTAMPTZ;

COMMENT ON COLUMN events.archive_verified_at IS
  'Set only when the Wasabi archive manifest is complete, all records verified, and the manifest digest recorded (ADR-023/ADR-024). Gates routine local-spool and R2 cleanup.';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS r2_delete_eligible_at TIMESTAMPTZ;

COMMENT ON COLUMN events.r2_delete_eligible_at IS
  'Earliest time the R2 hot copy may be deleted; must never be acted on before archive_verified_at is present (ADR-010).';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS retention_policy_id TEXT;

COMMENT ON COLUMN events.retention_policy_id IS
  'Identifier for the retention/business policy governing R2 hot-period length and Wasabi archival for this event (08_OPERATIONS_RUNBOOK: configurable by package/business policy).';

-- Cross-column ordering constraints (added via DO block: ALTER TABLE ADD
-- CONSTRAINT has no IF NOT EXISTS in PostgreSQL, so duplicate_object is
-- caught explicitly rather than masking unrelated failures).
DO $$
BEGIN
  ALTER TABLE events ADD CONSTRAINT events_scheduled_window_order_chk
    CHECK (scheduled_end_at IS NULL OR scheduled_start_at IS NULL OR scheduled_end_at > scheduled_start_at);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE events ADD CONSTRAINT events_publish_window_order_chk
    CHECK (publish_window_end_at IS NULL OR publish_window_start_at IS NULL OR publish_window_end_at > publish_window_start_at);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_media_state
  ON events (media_state);

CREATE INDEX IF NOT EXISTS idx_events_assigned_media_node_id
  ON events (assigned_media_node_id)
  WHERE assigned_media_node_id IS NOT NULL;

-- Supports GET /internal/media/events/by-stream-key/{keyFingerprint}
CREATE INDEX IF NOT EXISTS idx_events_stream_secret_hash
  ON events (stream_secret_hash)
  WHERE stream_secret_hash IS NOT NULL;

-- ============================================================
-- STEP 3: stream_sessions
-- One row per accepted publisher connection. A reconnect creates a new
-- row rather than reopening/mutating the old session identity.
-- ============================================================

CREATE TABLE IF NOT EXISTS stream_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  media_node_id      UUID NOT NULL REFERENCES media_nodes(id) ON DELETE RESTRICT,
  protocol           TEXT NOT NULL,
  video_codec        TEXT,
  audio_codec        TEXT,
  width              INTEGER,
  height             INTEGER,
  fps                NUMERIC,
  declared_bitrate   INTEGER,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at    TIMESTAMPTZ,
  end_reason         TEXT,
  first_segment_at   TIMESTAMPTZ,
  last_segment_at    TIMESTAMPTZ,
  segment_count      INTEGER NOT NULL DEFAULT 0 CHECK (segment_count >= 0),
  r2_confirmed_count INTEGER NOT NULL DEFAULT 0 CHECK (r2_confirmed_count >= 0),
  bytes_received     BIGINT NOT NULL DEFAULT 0 CHECK (bytes_received >= 0),
  status             TEXT NOT NULL DEFAULT 'starting'
                       CHECK (status IN ('starting', 'active', 'disconnected', 'finalized', 'failed')),
  CHECK (r2_confirmed_count <= segment_count)
);

COMMENT ON COLUMN stream_sessions.status IS
  'Session lifecycle (03_DATA_MODEL). A reconnect always creates a new row; it never reopens a prior session id.';
COMMENT ON COLUMN stream_sessions.end_reason IS
  'Free-form machine-readable reason for disconnect/finalization, set by the Media Agent; not a fixed enum in the approved data model.';

CREATE INDEX IF NOT EXISTS idx_stream_sessions_event_id
  ON stream_sessions (event_id);

CREATE INDEX IF NOT EXISTS idx_stream_sessions_media_node_id_status
  ON stream_sessions (media_node_id, status);

-- ============================================================
-- STEP 4: media_jobs
-- Aggregate per-event jobs only; never one row per HLS segment.
-- ============================================================

CREATE TABLE IF NOT EXISTS media_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  type               TEXT NOT NULL
                       CHECK (type IN ('finalize_vod', 'create_mp4', 'archive_to_wasabi', 'restore_to_r2', 'delete_r2_hot_copy')),
  status             TEXT NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued', 'running', 'paused', 'retry_wait', 'succeeded', 'failed_recoverable', 'cancelled')),
  attempt            INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  progress           NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  worker_node_id     UUID REFERENCES media_nodes(id) ON DELETE RESTRICT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  last_error_code    TEXT
                       CHECK (last_error_code IS NULL OR last_error_code IN (
                         'AUTH_INVALID', 'ASSIGNMENT_MISMATCH', 'PUBLISH_WINDOW_CLOSED', 'DUPLICATE_PUBLISHER',
                         'SPOOL_FILE_MISSING', 'SPOOL_FILE_UNSTABLE', 'R2_AUTH', 'R2_RETRYABLE', 'R2_OBJECT_MISMATCH',
                         'MANIFEST_GAP', 'MANIFEST_PUBLISH_FAILED', 'YOUTUBE_RELAY_FAILED', 'WASABI_AUTH',
                         'WASABI_RETRYABLE', 'ARCHIVE_MISMATCH', 'DISK_PRESSURE', 'STATE_CONFLICT'
                       )),
  last_error_summary TEXT
);

COMMENT ON COLUMN media_jobs.type IS
  'Aggregate job type (03_DATA_MODEL). Never one row per HLS segment; per-segment work stays in the media node local SQLite database.';
COMMENT ON COLUMN media_jobs.last_error_code IS
  'Stable machine-readable error code from the required category list (03_DATA_MODEL "Error model").';

CREATE INDEX IF NOT EXISTS idx_media_jobs_event_id
  ON media_jobs (event_id);

CREATE INDEX IF NOT EXISTS idx_media_jobs_type_status
  ON media_jobs (type, status);

CREATE INDEX IF NOT EXISTS idx_media_jobs_worker_node_id
  ON media_jobs (worker_node_id)
  WHERE worker_node_id IS NOT NULL;

-- ============================================================
-- STEP 5: event_state_transitions
-- Append-only audit trail of every media_state change.
-- ============================================================

CREATE TABLE IF NOT EXISTS event_state_transitions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  from_state TEXT
               CHECK (from_state IS NULL OR from_state IN (
                 'scheduled', 'ready', 'live', 'interrupted',
                 'ending', 'finalizing', 'vod_ready',
                 'archiving', 'archived', 'cancelled'
               )),
  to_state   TEXT NOT NULL
               CHECK (to_state IN (
                 'scheduled', 'ready', 'live', 'interrupted',
                 'ending', 'finalizing', 'vod_ready',
                 'archiving', 'archived', 'cancelled'
               )),
  actor_type TEXT NOT NULL,
  actor_id   TEXT,
  reason_code TEXT,
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE event_state_transitions IS
  'Append-only audit log of media_state changes (03_DATA_MODEL). Rows are never updated or deleted; enforced by trigger below.';
COMMENT ON COLUMN event_state_transitions.actor_type IS
  'Free-form category of the actor that caused the transition (e.g. system, operator, media_agent); no fixed enum is defined in the approved data model.';

CREATE INDEX IF NOT EXISTS idx_event_state_transitions_event_id_created_at
  ON event_state_transitions (event_id, created_at);

-- Enforce "State history is append-only" at the database level.
CREATE OR REPLACE FUNCTION event_state_transitions_block_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'event_state_transitions is append-only; % is not permitted', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_state_transitions_no_update ON event_state_transitions;
CREATE TRIGGER trg_event_state_transitions_no_update
  BEFORE UPDATE OR DELETE ON event_state_transitions
  FOR EACH ROW EXECUTE FUNCTION event_state_transitions_block_mutation();

-- ============================================================
-- STEP 6: Row Level Security
--
-- These four tables are internal control-plane state written by the
-- Media Agent / internal API (service role, per 03_DATA_MODEL "Internal
-- control-plane API"), not by end users. The governing documents do not
-- define a studio-facing read/write permission model for node internals,
-- session telemetry, job state, or the state-transition audit log, so no
-- anon/authenticated policies are added here (09_CLAUDE_CODE_EXECUTION_RULES:
-- "do not invent user-facing permissions"). RLS is enabled so only the
-- service role (which bypasses RLS) can access these tables until an
-- explicit ADR defines a studio-facing view.
-- ============================================================

ALTER TABLE media_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_state_transitions ENABLE ROW LEVEL SECURITY;
