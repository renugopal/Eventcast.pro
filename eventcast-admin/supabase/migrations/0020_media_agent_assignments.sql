-- ============================================================
-- Migration 0020: Media Agent control-plane assignment schema (narrow, reconciled)
--
-- Supersedes the narrow Media Agent assignment intent of migration 0019
-- (committed but never applied remotely). The active 0019 migration file
-- has since been replaced with an intentional no-op supersession marker
-- (see eventcast-admin/supabase/migrations/0019_livestream_control_plane.sql);
-- its original design is preserved only as historical documentation under
-- eventcast-admin/supabase/superseded-migrations/. This migration's
-- scope is exactly two tables: public.media_nodes and
-- public.media_event_assignments, plus the constraints/indexes/trigger/RLS
-- required for those two tables. No other object from 0019 (stream_sessions,
-- event_state_transitions, media_jobs, events lifecycle columns, retention
-- fields, VOD fields) is created here.
--
-- Wasabi is not part of this schema: no Wasabi table, column, enum value,
-- job type, error code, or comment appears anywhere below.
--
-- Scope boundary: this migration adds ZERO columns to the existing
-- public.events table. Every sensitive Media Agent assignment field lives
-- only in the new, separate, service-role-only public.media_event_assignments
-- table below - never on public.events, whose existing RLS policies are
-- row-level and would otherwise expose them to any studio member's direct
-- client query.
--
-- No data is inserted or backfilled by this migration. Both new tables
-- start empty: no media node is seeded, and no assignment row is created
-- for any existing event.
-- ============================================================

-- ============================================================
-- STEP 1: public.media_nodes
-- ============================================================

CREATE TABLE public.media_nodes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL UNIQUE,
  region              text NOT NULL,
  ingest_hostname     text NOT NULL UNIQUE,
  status              text NOT NULL DEFAULT 'provisioning'
                        CHECK (status IN ('provisioning', 'healthy', 'degraded', 'unavailable', 'retired')),
  maintenance_mode    boolean NOT NULL DEFAULT false,
  hard_stream_limit   integer NOT NULL DEFAULT 10 CHECK (hard_stream_limit > 0),
  active_stream_count integer NOT NULL DEFAULT 0 CHECK (active_stream_count >= 0),
  disk_free_bytes     bigint NULL,
  r2_queue_bytes      bigint NULL,
  last_heartbeat_at   timestamptz NULL,
  software_version    text NULL,
  config_version      text NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- status and maintenance_mode are scheduler and operational signals only —
-- inputs to a future scheduler deciding which node a new event should be
-- assigned to. They are NOT read or enforced by the internal assignments
-- endpoint (GET /internal/media/nodes/{node_id}/assignments): that
-- endpoint's authorization is controlled entirely by credential validity
-- (media_node_credentials, revocation) and per-assignment enablement
-- (media_event_assignments.enabled). A node in status = 'retired' or with
-- maintenance_mode = true will still be served its enabled assignments by
-- that endpoint if it presents a valid, non-revoked credential; do not
-- rely on status/maintenance_mode as an authentication or access-control
-- gate for that route.

-- No node credential column exists here by design; node authentication is
-- a deferred, separate slice with its own secret-boundary design.

-- ============================================================
-- STEP 2: public.media_event_assignments
--
-- Internal, service-role-only. This table - not public.events - is where
-- every sensitive Media Agent assignment field lives, so that events' own
-- row-level (not column-level) RLS policies can never expose them.
-- ============================================================

CREATE TABLE public.media_event_assignments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id                  uuid NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
  -- ON DELETE RESTRICT, not SET NULL: an enabled assignment's eligibility
  -- check requires assigned_media_node_id to stay non-null, so SET NULL
  -- could never actually succeed for an enabled row anyway. Media nodes
  -- should normally be retired via status (see media_nodes.status), and
  -- any assignment referencing a node must be explicitly disabled,
  -- reassigned, or cleared before that node row can be deleted.
  assigned_media_node_id    uuid NULL REFERENCES public.media_nodes(id) ON DELETE RESTRICT,
  ingest_id                 text NULL UNIQUE,
  playback_id                text NULL UNIQUE,
  stream_secret_hash         text NULL,
  enabled                    boolean NOT NULL DEFAULT false,
  publish_window_start_at    timestamptz NULL,
  publish_window_end_at      timestamptz NULL,
  youtube_enabled            boolean NOT NULL DEFAULT false,
  youtube_secret_reference   text NULL,
  config_version             bigint NOT NULL DEFAULT 1,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),

  -- Draft rows may leave either publish-window boundary null; once both are
  -- present, the end must be strictly later than the start.
  CONSTRAINT media_event_assignments_publish_window_order_chk CHECK (
    publish_window_start_at IS NULL
    OR publish_window_end_at IS NULL
    OR publish_window_end_at > publish_window_start_at
  ),

  -- Core eligibility: an incomplete draft is always allowed while
  -- enabled = false. The moment enabled = true, the row must already be
  -- routable to a real node and every core identity/secret/window field
  -- must be a genuinely non-empty value (IS NOT NULL alone would let an
  -- empty or whitespace-only string satisfy the check, which is wrong for
  -- an identifier or a hash). No 64-character hash-format regex is added
  -- here; the approved non-empty guard is used instead.
  CONSTRAINT media_event_assignments_core_eligibility_chk CHECK (
    enabled = false
    OR (
      assigned_media_node_id IS NOT NULL
      AND ingest_id IS NOT NULL AND length(btrim(ingest_id)) > 0
      AND playback_id IS NOT NULL AND length(btrim(playback_id)) > 0
      AND stream_secret_hash IS NOT NULL AND length(btrim(stream_secret_hash)) > 0
      AND publish_window_start_at IS NOT NULL
      AND publish_window_end_at IS NOT NULL
    )
  ),

  -- YouTube eligibility is independent of core eligibility: forwarding may
  -- stay disabled indefinitely, but once enabled a secret-store reference
  -- must already be present and non-empty.
  CONSTRAINT media_event_assignments_youtube_eligibility_chk CHECK (
    youtube_enabled = false
    OR (youtube_secret_reference IS NOT NULL AND length(btrim(youtube_secret_reference)) > 0)
  )
);

-- stream_secret_hash is a hash only, never the raw publish token.
COMMENT ON COLUMN public.media_event_assignments.stream_secret_hash IS
  'Hash of the publisher stream credential. Never stores the raw token.';

-- youtube_secret_reference is an opaque secret-store reference, never a
-- raw YouTube key. No raw-key column exists in this table by design.
COMMENT ON COLUMN public.media_event_assignments.youtube_secret_reference IS
  'Opaque reference into the approved secret store. Never the raw YouTube stream key itself.';

-- youtube_destination_base_url is intentionally not a column on this table:
-- it is supplied as server-side configuration (e.g. an environment
-- variable) at assignment-serve time, not persisted per event or per row.
COMMENT ON TABLE public.media_event_assignments IS
  'Internal, service-role-only Media Agent assignment data. No anon/authenticated policy exists or is planned without an explicit future ADR. youtube_destination_base_url is deliberately absent: it is supplied as server-side configuration, not persisted here.';

-- Supports the future assignment endpoint's exact query shape:
-- WHERE assigned_media_node_id = :node_id AND enabled = true.
CREATE INDEX idx_media_event_assignments_node_enabled
  ON public.media_event_assignments (assigned_media_node_id)
  WHERE enabled = true;

-- ============================================================
-- STEP 3: config_version / updated_at bookkeeping trigger
--
-- Sole authoritative writer of both columns. A caller's INSERT/UPDATE can
-- never set either column directly - this function always overwrites them.
-- ============================================================

CREATE OR REPLACE FUNCTION set_media_event_assignment_bookkeeping()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Ignore any caller-supplied config_version/updated_at entirely.
    NEW.config_version := 1;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- event_id is immutable: reject any attempt to change it outright rather
  -- than silently ignoring or restoring it. Excluded from the
  -- config-version comparison below for the same reason - a change here
  -- must be rejected entirely, not treated as a normal assignment-data
  -- change.
  IF NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    RAISE EXCEPTION 'media_event_assignments.event_id is immutable';
  END IF;

  -- TG_OP = 'UPDATE': restore both from OLD first, discarding whatever the
  -- caller's UPDATE statement tried to set on these two columns, before any
  -- other logic runs.
  NEW.config_version := OLD.config_version;
  NEW.updated_at := OLD.updated_at;

  -- IS DISTINCT FROM (not <>/!=) because these columns are nullable and
  -- plain inequality returns NULL - neither true nor false - whenever
  -- either side is NULL, which would silently miss a change into/out of
  -- NULL. id, event_id, created_at, config_version, and updated_at are
  -- deliberately excluded from this comparison.
  IF (NEW.assigned_media_node_id IS DISTINCT FROM OLD.assigned_media_node_id)
     OR (NEW.ingest_id IS DISTINCT FROM OLD.ingest_id)
     OR (NEW.playback_id IS DISTINCT FROM OLD.playback_id)
     OR (NEW.stream_secret_hash IS DISTINCT FROM OLD.stream_secret_hash)
     OR (NEW.enabled IS DISTINCT FROM OLD.enabled)
     OR (NEW.publish_window_start_at IS DISTINCT FROM OLD.publish_window_start_at)
     OR (NEW.publish_window_end_at IS DISTINCT FROM OLD.publish_window_end_at)
     OR (NEW.youtube_enabled IS DISTINCT FROM OLD.youtube_enabled)
     OR (NEW.youtube_secret_reference IS DISTINCT FROM OLD.youtube_secret_reference)
  THEN
    NEW.config_version := OLD.config_version + 1;
    NEW.updated_at := now();
  END IF;
  -- Otherwise both stay exactly at OLD's values: a direct attempt to
  -- update only config_version or updated_at has no effect.

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS media_event_assignments_set_bookkeeping ON public.media_event_assignments;
CREATE TRIGGER media_event_assignments_set_bookkeeping
  BEFORE INSERT OR UPDATE ON public.media_event_assignments
  FOR EACH ROW
  EXECUTE FUNCTION set_media_event_assignment_bookkeeping();

-- ============================================================
-- STEP 4: Row Level Security
--
-- Both tables are internal Media Agent control-plane state, written by a
-- future authenticated, service-role-only internal API - not by end users.
-- No studio-facing read/write permission model is defined here; RLS is
-- enabled with zero anon/authenticated policies so only the service role
-- (which bypasses RLS) can access these tables until an explicit future
-- ADR defines a studio-facing view. public.events' own existing RLS
-- policies are not altered by this migration.
-- ============================================================

ALTER TABLE public.media_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_event_assignments ENABLE ROW LEVEL SECURITY;
