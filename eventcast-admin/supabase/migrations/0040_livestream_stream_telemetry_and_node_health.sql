-- Livestream Technical Telemetry + Media Node Health Reporting.
--
-- LOCAL DESIGN ONLY as of this commit - NOT applied to the linked Supabase
-- project.
--
-- Purpose: let the Media Agent report authoritative per-stream technical
-- telemetry (resolution, codecs, audio presence, SRS-reported ingest
-- bitrate evidence, a derived local captured-segment bitrate estimate,
-- reconnect/session information), durable ended-session summaries, and
-- node heartbeat/capacity facts into the control plane - closing the gap
-- where media_nodes' own heartbeat/disk/queue columns (migration 0020)
-- have never had a writer. This migration does NOT add a frame-rate
-- (FPS) field anywhere: isolated Step 0 evidence proved the pinned SRS
-- build's GET /api/v1/streams/ does not report one, and it must never be
-- fabricated here or anywhere downstream. Follows 0036/0037's
-- conventions: fixed safe search_path, fully-qualified object names,
-- explicit validation, EXECUTE revoked from PUBLIC/anon/authenticated and
-- granted only to service_role, RLS enabled with zero ordinary-user
-- policies on both new tables.
--
-- Design constraints this migration encodes (see the project's read-only
-- telemetry audit and isolated Step 0 SRS evidence):
--   - Technical telemetry and audience/viewer analytics (current/peak/
--     total viewers, watch time) are explicitly separate concerns; this
--     migration carries no viewer-count field of any kind (ANA-003
--     requires player-side sessions/heartbeats, a different source).
--   - media_stream_telemetry is CURRENT STATE, replaced in place - no
--     per-second time series is stored, and a stale/delayed/retried
--     report can never overwrite a newer snapshot (sampled_at freshness
--     guard below).
--   - media_stream_sessions is DURABLE, append-only, one row per session
--     - deduplicated by the session's own durable identity
--     (session_id UNIQUE + ON CONFLICT DO NOTHING), never by the
--     transport-level request id, which legitimately rotates on every
--     retry - and re-acknowledgement is identity-safe: event_id,
--     reporting_media_node_id, started_at, disconnected_at, and
--     segment_count must all match the existing row, not merely the
--     session_id. duration_seconds is a GENERATED column derived from
--     started_at/disconnected_at, never trusted from the client payload,
--     so it can never disagree with them and needs no separate
--     (fragile, floating-point) comparison during re-acknowledgement.
--   - media_nodes gains no new column: its existing
--     last_heartbeat_at/disk_free_bytes/r2_queue_bytes/software_version/
--     config_version/active_stream_count columns (migration 0020) simply
--     get their first writer.
--   - Authorization is deliberately DIFFERENT for the two tables. A valid
--     node credential proves WHICH node is calling, never THAT it may
--     write for an arbitrary event - the same principle
--     apply_event_recording_transition's caller (recordings route)
--     already enforces via nodeHasEventActivation. media_stream_telemetry
--     is CURRENT state, so only the event's presently assigned, enabled
--     media node (media_event_assignments) may write it - a node with
--     only an old activation-history row must not be able to replace
--     current telemetry after the event has moved to another node.
--     media_stream_sessions is HISTORY, so activation history
--     (media_event_assignment_activations, migration 0036) is the
--     correct authority - a past producer legitimately reports the
--     session it actually hosted even after later reassignment.

-- =========================================================================
-- 1. media_stream_telemetry - current per-event technical telemetry
-- =========================================================================

CREATE TABLE public.media_stream_telemetry (
  event_id                     uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  reporting_media_node_id      uuid NOT NULL REFERENCES public.media_nodes(id),
  sampled_at                   timestamptz NOT NULL,
  connected                    boolean NOT NULL,
  srs_publish_active           boolean NULL,
  video_width                  integer NULL,
  video_height                 integer NULL,
  video_codec                  text NULL,
  audio_codec                  text NULL,
  audio_present                boolean NULL,
  ingest_kbps_recv_30s         integer NULL,
  recv_bytes                   bigint NULL,
  -- Local-capture average only - never proof of R2/CDN/viewer delivery.
  -- See internal/telemetry.StreamTelemetry.CapturedSegmentBitrateKbps.
  captured_segment_bitrate_kbps double precision NULL,
  publish_duration_seconds     double precision NULL,
  session_count                integer NULL,
  reconnect_count              integer NULL,
  segment_freshness_seconds    double precision NULL,
  updated_at                   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.media_stream_telemetry IS
  'Current-state technical telemetry, one row per event, replaced in place on every report - a stale/out-of-order report (older sampled_at than the row already stored) is silently ignored, never applied. No per-second time series. Never a viewer/audience metric. No FPS field. Writer authorization requires the reporting node to be the event''s current enabled media_event_assignments node, not merely a historical activation.';

CREATE INDEX media_stream_telemetry_node_idx ON public.media_stream_telemetry (reporting_media_node_id);

ALTER TABLE public.media_stream_telemetry ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: RLS enabled with zero policies denies all
-- client row access, matching 0035/0036's convention for
-- server/service-role-mediated surfaces. This is infrastructure-adjacent
-- technical telemetry and must never be reachable from a raw client query
-- - the provider/Super Admin projections are always served through their
-- own authenticated API routes, never a direct table read.
REVOKE ALL ON TABLE public.media_stream_telemetry FROM PUBLIC;
REVOKE ALL ON TABLE public.media_stream_telemetry FROM anon;
REVOKE ALL ON TABLE public.media_stream_telemetry FROM authenticated;
REVOKE ALL ON TABLE public.media_stream_telemetry FROM service_role;
-- SELECT only: the provider/Super Admin API routes read this directly.
-- The sole writer is the SECURITY DEFINER function below, which writes as
-- the function owner - never as service_role - so no INSERT/UPDATE/DELETE
-- grant is required or given.
GRANT SELECT ON TABLE public.media_stream_telemetry TO service_role;

-- =========================================================================
-- 2. media_stream_sessions - durable, append-only ended-session summaries
-- =========================================================================

CREATE TABLE public.media_stream_sessions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The Media Agent's own durable session identity (ingest_sessions.id,
  -- e.g. "sess_<32 hex>"), NOT a UUID - this is the natural key session-
  -- level idempotency is built on. A bare UNIQUE constraint is sufficient:
  -- it is a 128-bit CSPRNG value minted once, locally, by the reporting
  -- node, the same collision-risk profile this schema already trusts for
  -- media_event_assignments.ingest_id/playback_id (migration 0020).
  session_id                text NOT NULL UNIQUE,
  event_id                  uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  reporting_media_node_id   uuid NOT NULL REFERENCES public.media_nodes(id),
  started_at                timestamptz NOT NULL,
  disconnected_at           timestamptz NOT NULL,
  end_reason                text NOT NULL DEFAULT '',
  segment_count             integer NOT NULL DEFAULT 0,
  -- Deterministically derived from started_at/disconnected_at, never
  -- accepted from the client payload - it can never disagree with the
  -- two timestamps it comes from, and re-acknowledgement never needs a
  -- fragile floating-point comparison against it (see apply_media_stream_
  -- telemetry_report's doc below).
  duration_seconds          double precision GENERATED ALWAYS AS (
                               EXTRACT(EPOCH FROM (disconnected_at - started_at))
                             ) STORED,
  reported_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.media_stream_sessions IS
  'Durable, append-only, one row per ended ingest session (session_id UNIQUE). The sole writer inserts with ON CONFLICT (session_id) DO NOTHING, so a retried report of the same session_id - under any number of new HTTP request ids - never creates a duplicate row. Re-acknowledgement additionally verifies the existing row''s event_id, reporting_media_node_id, started_at, disconnected_at, and segment_count all match the retry before treating it as successfully delivered, so a session_id collision carrying conflicting durable facts is never falsely acknowledged. Writer authorization is activation-history based (media_event_assignment_activations), since a past producer may legitimately report a session after later reassignment.';

CREATE INDEX media_stream_sessions_event_idx ON public.media_stream_sessions (event_id, started_at);

ALTER TABLE public.media_stream_sessions ENABLE ROW LEVEL SECURITY;
-- Same posture as media_stream_telemetry above.
REVOKE ALL ON TABLE public.media_stream_sessions FROM PUBLIC;
REVOKE ALL ON TABLE public.media_stream_sessions FROM anon;
REVOKE ALL ON TABLE public.media_stream_sessions FROM authenticated;
REVOKE ALL ON TABLE public.media_stream_sessions FROM service_role;
GRANT SELECT ON TABLE public.media_stream_sessions TO service_role;

-- =========================================================================
-- 3. apply_media_stream_telemetry_report - the sole write path
-- =========================================================================
--
-- p_reporting_media_node_id is supplied by the trusted server route from
-- node AUTHENTICATION - never from the request body - exactly like
-- apply_event_recording_transition's p_reporting_media_node_id. The route
-- has already verified the node credential before calling this function.
--
-- p_streams and p_ended_sessions are jsonb arrays (the wire shapes are
-- variable-length, unlike every fixed-arity scalar-parameter RPC
-- elsewhere in this schema) - each element's shape mirrors
-- internal/controlplane.TelemetryReport's Streams/EndedSessions fields.
-- Every element is processed inside its own nested BEGIN/EXCEPTION
-- block, so a single malformed field (a bad timestamp, a non-numeric
-- value cast to integer/bigint/double precision, anything) can only skip
-- THAT element - it can never abort the rest of the batch or the
-- node-heartbeat update already applied above it.
--
-- Authorization differs by table on purpose (see the migration header):
--   - p_streams:        current, enabled media_event_assignments node.
--   - p_ended_sessions:  media_event_assignment_activations history.
--
-- No fallback/fabricated values for required durable facts: sampled_at
-- and connected (media_stream_telemetry), and started_at,
-- disconnected_at, and segment_count (media_stream_sessions) must each
-- be present and parse successfully, or the whole element is skipped -
-- never defaulted to now()/false/0, which would misrepresent an
-- actually-unmeasured fact as a real one. duration_seconds is never read
-- from the client payload at all - it is a GENERATED column.
CREATE OR REPLACE FUNCTION public.apply_media_stream_telemetry_report(
  p_reporting_media_node_id uuid,
  p_disk_free_bytes bigint DEFAULT NULL,
  p_r2_queue_bytes bigint DEFAULT NULL,
  p_software_version text DEFAULT NULL,
  p_config_version text DEFAULT NULL,
  p_active_stream_count integer DEFAULT NULL,
  p_streams jsonb DEFAULT '[]'::jsonb,
  p_ended_sessions jsonb DEFAULT '[]'::jsonb
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stream jsonb;
  v_session jsonb;
  v_event_id uuid;
  v_session_id text;
  v_accepted text[] := ARRAY[]::text[];
  v_existing_event_id uuid;
  v_existing_node_id uuid;
  v_existing_started_at timestamptz;
  v_existing_disconnected_at timestamptz;
  v_existing_segment_count integer;
  v_sampled_at timestamptz;
  v_connected boolean;
  v_started_at timestamptz;
  v_disconnected_at timestamptz;
  v_segment_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.media_nodes mn WHERE mn.id = p_reporting_media_node_id) THEN
    RAISE EXCEPTION 'unknown reporting media node %', p_reporting_media_node_id;
  END IF;

  -- Node heartbeat: every field is independently optional (see
  -- internal/telemetry.NodeHeartbeat's doc - a failed local measurement
  -- must stay unavailable, never a fabricated value), so each column is
  -- only overwritten when the caller actually supplied it. Server-owned
  -- updated_at/last_heartbeat_at always advance on any accepted report,
  -- proving this node is alive regardless of which individual facts it
  -- could measure this tick.
  UPDATE public.media_nodes
  SET last_heartbeat_at    = now(),
      disk_free_bytes      = COALESCE(p_disk_free_bytes, disk_free_bytes),
      r2_queue_bytes       = COALESCE(p_r2_queue_bytes, r2_queue_bytes),
      software_version     = COALESCE(p_software_version, software_version),
      config_version       = COALESCE(p_config_version, config_version),
      active_stream_count  = COALESCE(p_active_stream_count, active_stream_count)
  WHERE id = p_reporting_media_node_id;

  -- Current-state technical telemetry: one row per event, replaced in
  -- place, only when this node is the event's CURRENT enabled assigned
  -- node and every required field parses cleanly.
  FOR v_stream IN SELECT * FROM jsonb_array_elements(COALESCE(p_streams, '[]'::jsonb))
  LOOP
    BEGIN
      v_event_id := (v_stream->>'event_id')::uuid;
      IF v_event_id IS NULL THEN
        CONTINUE;
      END IF;

      -- Current-assignment authorization, deliberately NOT activation
      -- history: only the event's presently assigned, enabled media node
      -- may write current telemetry. A node that only has an old
      -- activation-history row (e.g. the event was later reassigned)
      -- must not be able to replace current telemetry it no longer
      -- actually produces.
      IF NOT EXISTS (
        SELECT 1 FROM public.media_event_assignments mea
        WHERE mea.event_id = v_event_id
          AND mea.assigned_media_node_id = p_reporting_media_node_id
          AND mea.enabled = true
      ) THEN
        CONTINUE;
      END IF;

      v_sampled_at := (v_stream->>'sampled_at')::timestamptz;
      IF v_sampled_at IS NULL THEN
        CONTINUE;
      END IF;

      v_connected := (v_stream->>'connected')::boolean;
      IF v_connected IS NULL THEN
        CONTINUE;
      END IF;

      INSERT INTO public.media_stream_telemetry (
        event_id, reporting_media_node_id, sampled_at, connected,
        srs_publish_active, video_width, video_height, video_codec,
        audio_codec, audio_present, ingest_kbps_recv_30s, recv_bytes,
        captured_segment_bitrate_kbps, publish_duration_seconds,
        session_count, reconnect_count, segment_freshness_seconds, updated_at
      ) VALUES (
        v_event_id, p_reporting_media_node_id, v_sampled_at, v_connected,
        (v_stream->>'srs_publish_active')::boolean,
        (v_stream->>'video_width')::integer,
        (v_stream->>'video_height')::integer,
        NULLIF(v_stream->>'video_codec', ''),
        NULLIF(v_stream->>'audio_codec', ''),
        (v_stream->>'audio_present')::boolean,
        (v_stream->>'ingest_kbps_recv_30s')::integer,
        (v_stream->>'recv_bytes')::bigint,
        (v_stream->>'captured_segment_bitrate_kbps')::double precision,
        (v_stream->>'publish_duration_seconds')::double precision,
        (v_stream->>'session_count')::integer,
        (v_stream->>'reconnect_count')::integer,
        (v_stream->>'segment_freshness_seconds')::double precision,
        now()
      )
      -- Freshness guard: an older/delayed/retried sample must never
      -- overwrite a newer one already stored. The comparison is against
      -- the telemetry's OWN sampled_at, never server-side updated_at.
      ON CONFLICT (event_id) DO UPDATE SET
        reporting_media_node_id       = EXCLUDED.reporting_media_node_id,
        sampled_at                    = EXCLUDED.sampled_at,
        connected                     = EXCLUDED.connected,
        srs_publish_active            = EXCLUDED.srs_publish_active,
        video_width                   = EXCLUDED.video_width,
        video_height                  = EXCLUDED.video_height,
        video_codec                   = EXCLUDED.video_codec,
        audio_codec                   = EXCLUDED.audio_codec,
        audio_present                 = EXCLUDED.audio_present,
        ingest_kbps_recv_30s          = EXCLUDED.ingest_kbps_recv_30s,
        recv_bytes                    = EXCLUDED.recv_bytes,
        captured_segment_bitrate_kbps = EXCLUDED.captured_segment_bitrate_kbps,
        publish_duration_seconds      = EXCLUDED.publish_duration_seconds,
        session_count                 = EXCLUDED.session_count,
        reconnect_count               = EXCLUDED.reconnect_count,
        segment_freshness_seconds     = EXCLUDED.segment_freshness_seconds,
        updated_at                    = now()
      WHERE public.media_stream_telemetry.sampled_at <= EXCLUDED.sampled_at;
    EXCEPTION WHEN OTHERS THEN
      -- Any parse/cast/write failure for this one element must never
      -- abort the rest of the batch.
      CONTINUE;
    END;
  END LOOP;

  -- Durable ended-session summaries: session_id UNIQUE + ON CONFLICT DO
  -- NOTHING is the entire idempotency mechanism, gated by activation
  -- history (a past producer legitimately reports its own ended
  -- session). A session_id is added to v_accepted only after confirming
  -- the durably-present row (whether freshly inserted or pre-existing
  -- from an earlier retry) genuinely matches this event, this reporting
  -- node, and the immutable session-identity facts - never merely
  -- because a row with that session_id exists.
  FOR v_session IN SELECT * FROM jsonb_array_elements(COALESCE(p_ended_sessions, '[]'::jsonb))
  LOOP
    BEGIN
      v_session_id := v_session->>'session_id';
      IF v_session_id IS NULL OR btrim(v_session_id) = '' THEN
        CONTINUE;
      END IF;

      v_event_id := (v_session->>'event_id')::uuid;
      IF v_event_id IS NULL THEN
        CONTINUE;
      END IF;

      -- Activation-history authorization (not current assignment): an
      -- ended session legitimately belongs to whichever node actually
      -- hosted it at the time, which may no longer be the event's
      -- current assigned node after a later reassignment.
      IF NOT EXISTS (
        SELECT 1 FROM public.media_event_assignment_activations a
        WHERE a.event_id = v_event_id AND a.media_node_id = p_reporting_media_node_id
      ) THEN
        CONTINUE;
      END IF;

      v_started_at := (v_session->>'started_at')::timestamptz;
      IF v_started_at IS NULL THEN
        CONTINUE;
      END IF;

      v_disconnected_at := (v_session->>'disconnected_at')::timestamptz;
      IF v_disconnected_at IS NULL THEN
        CONTINUE;
      END IF;

      v_segment_count := (v_session->>'segment_count')::integer;
      IF v_segment_count IS NULL THEN
        CONTINUE;
      END IF;

      -- duration_seconds is NOT accepted from the client payload: it is a
      -- GENERATED ALWAYS column derived from started_at/disconnected_at,
      -- so it can never disagree with them and needs no separate
      -- (fragile, floating-point) comparison during re-acknowledgement -
      -- comparing the two exact timestamptz values below already proves
      -- duration agreement.
      INSERT INTO public.media_stream_sessions (
        session_id, event_id, reporting_media_node_id, started_at,
        disconnected_at, end_reason, segment_count
      ) VALUES (
        v_session_id, v_event_id, p_reporting_media_node_id, v_started_at,
        v_disconnected_at, COALESCE(v_session->>'end_reason', ''),
        v_segment_count
      )
      ON CONFLICT (session_id) DO NOTHING;

      -- Identity-safe re-acknowledgement: the durably present row (new or
      -- pre-existing) must match event_id, reporting_media_node_id, the
      -- immutable session-identity timestamps (exact timestamptz
      -- equality - not floating point, no fragility), and segment_count
      -- (exact integer equality). A retry that reuses the same
      -- session_id but carries conflicting durable facts is left
      -- unacknowledged rather than accepted, so the Media Agent keeps
      -- retrying rather than a mismatched record being silently treated
      -- as confirmed delivery.
      SELECT s.event_id, s.reporting_media_node_id, s.started_at, s.disconnected_at, s.segment_count
        INTO v_existing_event_id, v_existing_node_id, v_existing_started_at, v_existing_disconnected_at, v_existing_segment_count
      FROM public.media_stream_sessions s
      WHERE s.session_id = v_session_id;

      IF v_existing_event_id = v_event_id
         AND v_existing_node_id = p_reporting_media_node_id
         AND v_existing_started_at = v_started_at
         AND v_existing_disconnected_at = v_disconnected_at
         AND v_existing_segment_count = v_segment_count THEN
        v_accepted := array_append(v_accepted, v_session_id);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;
    END;
  END LOOP;

  RETURN v_accepted;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_media_stream_telemetry_report(uuid, bigint, bigint, text, text, integer, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_media_stream_telemetry_report(uuid, bigint, bigint, text, text, integer, jsonb, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_media_stream_telemetry_report(uuid, bigint, bigint, text, text, integer, jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION public.apply_media_stream_telemetry_report IS
  'Sole write path for Livestream Technical Telemetry + Media Node Health Reporting. Updates media_nodes heartbeat/capacity columns (migration 0020) with per-field optionality - never a fabricated zero. Upserts current-state media_stream_telemetry per event, authorized against the event''s CURRENT enabled media_event_assignments node, with a sampled_at freshness guard. Durably appends media_stream_sessions, authorized against media_event_assignment_activations history, with session_id UNIQUE + ON CONFLICT DO NOTHING idempotency and identity-safe re-acknowledgement (event_id, reporting_media_node_id, started_at, disconnected_at, segment_count must all match); duration_seconds is server-derived, never client-trusted. Every entry is processed in its own exception-isolated block - a malformed or unauthorized entry is skipped, never written or acknowledged, and never aborts the rest of the batch. No FPS field, no viewer/audience metric anywhere. Returns the session ids now durably confirmed to belong to this node/event with matching facts, for the caller to echo as AcceptedSessionIDs.';
