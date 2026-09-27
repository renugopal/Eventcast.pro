-- ============================================================
-- Migration 0044: Durable finalized-R2 replay pointer + relay/manifest
-- technical telemetry (Livestream Reliability & Operations Package)
--
-- Two independent, additive sections. Conventions follow 0036/0040
-- exactly: fixed safe search_path, fully-qualified object names, explicit
-- validation, SECURITY DEFINER sole-writer functions, EXECUTE revoked from
-- PUBLIC/anon/authenticated and granted only to service_role, no new
-- table privileges, no policies.
--
-- Verified remote baseline (read-only catalog audit before authoring):
-- apply_event_recording_transition and apply_media_stream_telemetry_report
-- each exist as exactly ONE overload, owned by postgres, SECURITY DEFINER,
-- search_path = public, pg_temp, EXECUTE held only by postgres and
-- service_role; both bodies are identical to migrations 0036 / 0040.
--
-- IMPORTANT - default privileges: this project's public schema grants
-- EXECUTE on every newly CREATED function to anon and authenticated by
-- default. Section 1 re-creates a function, so the REVOKE below it is
-- mandatory, not decorative.
-- ============================================================

-- =========================================================================
-- SECTION 1. event_recordings.r2_playback_id - durable finalized-R2 pointer
-- =========================================================================
--
-- Why: the render Worker could previously resolve R2 playback only through
-- an ENABLED media_event_assignments row, so finalized R2 VOD became
-- unreachable the moment Provider End disabled the assignment. The Media
-- Agent now reports the playback id its finalized R2 VOD playlist was
-- published under (parsed strictly from its durable vod_finalizations
-- r2_key). This column stores that id ONLY once it is proven, so the
-- Worker can serve finalized R2 VOD after End without inferring anything.
--
-- The pointer is accepted only when ALL of:
--   1. the EFFECTIVE recording state (after the single-node provenance
--      hold) is local_finalized, b2_finalizing or b2_finalized;
--   2. the id is a member of this report's covered_playback_ids;
--   3. the event's COMPLETE activation history is on the reporting node
--      AND contains exactly one distinct playback_id, equal to this id.
-- Rule 3 makes the pointer fully determined by provenance: an event with
-- more than one activation (every activation mints a new playback_id) or
-- with any foreign-node activation can never obtain a pointer, so a split
-- or multi-activation recording - whose single R2 VOD playlist covers only
-- part of the event - can never be served as finalized R2 replay merely
-- because an object exists. Such events rely on the B2 path, whose keys
-- are per event.
--
-- An unproven value is IGNORED (never written), never rejected: the
-- archival transition itself must not fail because of the optional
-- pointer.
--
-- Generation binding: the pointer always describes the CURRENT
-- finalization_generation.
--   - A report that changes the generation (pre-freeze regression, or the
--     post-freeze atomic replacement) sets the pointer to the newly proven
--     id or NULL - a stale pointer is never carried into a new generation.
--   - A same-generation report sets the pointer only when it is still NULL;
--     an existing value is preserved (rule 3 makes a conflicting proven
--     value impossible).
--   - A frozen-row report that does not pass the full replacement gate is a
--     no-op, exactly as in 0036, and leaves the pointer untouched.
--
-- No backfill: existing rows keep NULL, following 0036's rule that
-- provenance is never seeded from assumptions.
--
-- Future destructive R2 cleanup (not implemented anywhere today; the
-- cleanup surface is dry-run only) MUST, before deleting any object, null
-- this pointer and record a tombstone through its own reviewed SECURITY
-- DEFINER path, and must make this function refuse to re-set the pointer
-- once tombstoned. That belongs to the cleanup package's own migration.

ALTER TABLE public.event_recordings
  ADD COLUMN r2_playback_id text NULL;

ALTER TABLE public.event_recordings
  ADD CONSTRAINT event_recordings_r2_playback_id_format_chk
  CHECK (r2_playback_id IS NULL OR r2_playback_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$');

COMMENT ON COLUMN public.event_recordings.r2_playback_id IS
  'Playback id of the finalized R2 VOD playlist for the CURRENT finalization_generation, written only by apply_event_recording_transition once proven (eligible effective state, member of covered_playback_ids, entire activation history single-node with exactly this one playback id). NULL when unproven or after a generation change without new proof. Private identifier: server-side use only, never returned to provider/client responses. Must be nulled (with a tombstone) before any future destructive R2 cleanup.';

-- The 12-argument signature is DROPPED, not left beside the new one: two
-- overloads that both accept the 12 named arguments would make every
-- existing PostgREST RPC call ambiguous. DROP + CREATE run atomically
-- inside this migration's transaction.
DROP FUNCTION public.apply_event_recording_transition(
  uuid, text, text, timestamptz, text, text, integer, text, boolean, text, uuid, text[]
);

CREATE FUNCTION public.apply_event_recording_transition(
  p_event_id uuid,
  p_target_state text,
  p_finalization_generation text DEFAULT NULL,
  p_local_finalized_at timestamptz DEFAULT NULL,
  p_b2_object_key text DEFAULT NULL,
  p_b2_bucket text DEFAULT NULL,
  p_gap_count integer DEFAULT NULL,
  p_gap_status text DEFAULT NULL,
  p_strong_integrity_verified boolean DEFAULT false,
  p_failure_reason text DEFAULT NULL,
  p_reporting_media_node_id uuid DEFAULT NULL,
  p_covered_playback_ids text[] DEFAULT NULL,
  p_r2_playback_id text DEFAULT NULL
)
RETURNS public.event_recordings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.event_recordings%ROWTYPE;
  v_current_rank integer;
  v_target_rank integer;
  v_is_finalization boolean;
  v_covered text[];
  v_activation_count integer;
  v_foreign_node_count integer;
  v_uncovered_count integer;
  v_provenance_ok boolean := false;
  v_frozen boolean;
  v_same_generation boolean;
  v_grant_integrity boolean := false;
  v_gap_eligible boolean;
  v_effective_state text;
  -- 0044: finalized-R2 pointer proof.
  v_r2_proven text := NULL;
  v_ptr_activation_count integer;
  v_ptr_foreign_node_count integer;
  v_ptr_distinct_playback_count integer;
  v_ptr_single_playback_id text;
BEGIN
  IF p_target_state IS NULL OR p_target_state NOT IN
     ('not_started', 'recording', 'local_finalized', 'b2_finalizing', 'b2_finalized', 'failed') THEN
    RAISE EXCEPTION 'invalid target recording state: %', p_target_state;
  END IF;

  -- Finalization-bearing states are the ones that assert real evidence
  -- about a recording, so they carry the strict input requirements.
  v_is_finalization := p_target_state IN ('local_finalized', 'b2_finalizing', 'b2_finalized');

  IF v_is_finalization THEN
    IF p_finalization_generation IS NULL OR btrim(p_finalization_generation) = '' THEN
      RAISE EXCEPTION 'finalization_generation is required for state %', p_target_state;
    END IF;
    -- Explicit gap facts, always. An omitted gap_count must never be
    -- silently read as a gap-free recording.
    IF p_gap_count IS NULL THEN
      RAISE EXCEPTION 'gap_count must be supplied explicitly for state %', p_target_state;
    END IF;
    IF p_gap_count < 0 THEN
      RAISE EXCEPTION 'gap_count must be >= 0';
    END IF;
    IF p_gap_status IS NULL OR p_gap_status NOT IN ('none', 'pending_review', 'acknowledged', 'rejected') THEN
      RAISE EXCEPTION 'gap_status must be supplied explicitly and be one of none/pending_review/acknowledged/rejected';
    END IF;
    IF p_reporting_media_node_id IS NULL THEN
      RAISE EXCEPTION 'reporting media node is required for state %', p_target_state;
    END IF;

    -- Distinct, non-blank playback coverage. Duplicates are canonicalized
    -- so the comparison below is against a true set.
    SELECT array_agg(DISTINCT c) INTO v_covered
    FROM unnest(coalesce(p_covered_playback_ids, ARRAY[]::text[])) AS c
    WHERE c IS NOT NULL AND btrim(c) <> '';

    IF v_covered IS NULL OR array_length(v_covered, 1) IS NULL THEN
      RAISE EXCEPTION 'covered_playback_ids must be a non-empty set of playback ids for state %', p_target_state;
    END IF;
  END IF;

  -- Lazily create the single row, so the node never needs INSERT on
  -- event_recordings. event_id is already UNIQUE (0035).
  INSERT INTO public.event_recordings (event_id, recording_state)
  VALUES (p_event_id, 'not_started')
  ON CONFLICT (event_id) DO NOTHING;

  SELECT er.* INTO v_row
  FROM public.event_recordings er
  WHERE er.event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_recordings row not found for event %', p_event_id;
  END IF;

  v_frozen := v_row.retention_frozen_at IS NOT NULL;
  v_same_generation := p_finalization_generation IS NOT NULL
                       AND v_row.finalization_generation IS NOT DISTINCT FROM p_finalization_generation;

  -- ---------------------------------------------------------------------
  -- Single-node provenance (Event-authoritative b2_finalized only).
  --
  -- A finalization can only describe the WHOLE event if every activation of
  -- that event happened on the reporting node. Otherwise the recording is
  -- split across nodes, and this node's local finalization - which can only
  -- ever see its own segments - is partial by construction. Such a report
  -- is still accepted as archival evidence, but must never be promoted to
  -- Event-authoritative, or a partial recording could replace a complete
  -- one.
  -- ---------------------------------------------------------------------
  IF p_target_state = 'b2_finalized' THEN
    SELECT count(*),
           count(*) FILTER (WHERE a.media_node_id IS DISTINCT FROM p_reporting_media_node_id),
           count(*) FILTER (WHERE NOT (a.playback_id = ANY (v_covered)))
      INTO v_activation_count, v_foreign_node_count, v_uncovered_count
    FROM public.media_event_assignment_activations a
    WHERE a.event_id = p_event_id;

    -- No null-history exception: an event with no trusted activation
    -- evidence cannot be proven single-node, so it fails closed.
    v_provenance_ok := v_activation_count > 0
                       AND v_foreign_node_count = 0
                       AND v_uncovered_count = 0;
  END IF;

  -- A report that fails the provenance gate is still accepted as archival
  -- evidence, but is held at b2_finalizing rather than reaching
  -- b2_finalized. Letting it reach the finalized state would publish a
  -- b2_object_key pointing at a playlist that covers only this node's
  -- share of a split recording - a partial archive wearing the
  -- authoritative label. Holding it one state short keeps the durable
  -- record honest and leaves every downstream gate (retention freeze, R2
  -- cleanup eligibility, provider replay status) correctly closed.
  v_effective_state := p_target_state;
  IF p_target_state = 'b2_finalized' AND NOT v_provenance_ok THEN
    v_effective_state := 'b2_finalizing';
  END IF;

  -- ---------------------------------------------------------------------
  -- 0044: finalized-R2 pointer proof (see the section header above).
  -- Computed once, from the EFFECTIVE state, before any branch writes. A
  -- value that fails any rule leaves v_r2_proven NULL: ignored, never
  -- rejected.
  -- ---------------------------------------------------------------------
  IF p_r2_playback_id IS NOT NULL
     AND p_r2_playback_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
     AND v_effective_state IN ('local_finalized', 'b2_finalizing', 'b2_finalized')
     AND p_r2_playback_id = ANY (v_covered) THEN
    SELECT count(*),
           count(*) FILTER (WHERE a.media_node_id IS DISTINCT FROM p_reporting_media_node_id),
           count(DISTINCT a.playback_id),
           min(a.playback_id)
      INTO v_ptr_activation_count, v_ptr_foreign_node_count,
           v_ptr_distinct_playback_count, v_ptr_single_playback_id
    FROM public.media_event_assignment_activations a
    WHERE a.event_id = p_event_id;

    IF v_ptr_activation_count > 0
       AND v_ptr_foreign_node_count = 0
       AND v_ptr_distinct_playback_count = 1
       AND v_ptr_single_playback_id = p_r2_playback_id THEN
      v_r2_proven := p_r2_playback_id;
    END IF;
  END IF;

  v_current_rank := public.event_recording_state_rank(v_row.recording_state);
  v_target_rank := public.event_recording_state_rank(v_effective_state);

  -- ---------------------------------------------------------------------
  -- Post-freeze protection.
  --
  -- Once retention has frozen, the verified generation is the authoritative
  -- replay evidence and must not be displaced by an in-progress or
  -- unverified replacement. A newer generation may be archived and retried
  -- locally; it only becomes authoritative through ONE atomic, fully
  -- verified b2_finalized transition. Anything weaker is accepted as a
  -- no-op so the reporting node can settle rather than retry forever.
  -- ---------------------------------------------------------------------
  IF v_frozen AND NOT v_same_generation THEN
    IF NOT (p_target_state = 'b2_finalized'
            AND p_strong_integrity_verified
            AND (p_gap_count = 0 OR p_gap_status = 'acknowledged')
            AND v_provenance_ok
            AND p_b2_object_key IS NOT NULL AND btrim(p_b2_object_key) <> ''
            AND p_b2_bucket IS NOT NULL AND btrim(p_b2_bucket) <> '') THEN
      RETURN v_row;
    END IF;

    -- Atomic replacement. Retention fields are deliberately absent from
    -- this UPDATE: a later generation must never restart, shorten, or
    -- recompute an already-promised retention window. The replacement
    -- generation gets its own proven pointer or NULL - never the replaced
    -- generation's pointer.
    UPDATE public.event_recordings
    SET finalization_generation = p_finalization_generation,
        b2_object_key           = p_b2_object_key,
        b2_bucket               = p_b2_bucket,
        b2_finalized_at         = now(),
        integrity_verified_at   = now(),
        gap_count               = p_gap_count,
        gap_status              = p_gap_status,
        r2_playback_id          = v_r2_proven,
        updated_at              = now()
    WHERE event_id = p_event_id
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  -- ---------------------------------------------------------------------
  -- Ordinary transition rules.
  --
  -- Monotonic by rank rather than strict adjacency, because the node's
  -- report outbox holds only the latest state and the transport gives no
  -- ordering guarantee - so an intermediate 'recording' or 'b2_finalizing'
  -- report can legitimately be lost while a later, stronger one arrives. A
  -- truthful local_finalized must not become impossible for that reason.
  -- Regression protection is preserved: a forward jump is allowed only
  -- because every evidence requirement for the target state was already
  -- enforced above.
  -- ---------------------------------------------------------------------
  IF v_effective_state = 'failed' THEN
    -- Orthogonal and recoverable from any active state.
    NULL;
  ELSIF v_row.recording_state = 'failed' THEN
    -- Recovery out of failed into any real state is allowed.
    NULL;
  ELSIF v_target_rank < v_current_rank THEN
    -- One guarded exception: a genuinely NEW generation pre-freeze may
    -- reopen archival, because the previous evidence describes a superseded
    -- segment set.
    IF NOT (v_effective_state = 'b2_finalizing' AND NOT v_same_generation AND NOT v_frozen) THEN
      RAISE EXCEPTION 'invalid recording state regression: % -> %', v_row.recording_state, v_effective_state;
    END IF;
  END IF;

  -- Strong byte-integrity verification is granted only from explicit
  -- evidence AND an eligible gap state. 'pending_review' and 'rejected'
  -- remain ineligible: an unresolved gap means the recording is known to be
  -- incomplete, and retention must not freeze on it.
  v_gap_eligible := coalesce(p_gap_count, v_row.gap_count) = 0
                    OR coalesce(p_gap_status, v_row.gap_status) = 'acknowledged';
  IF v_effective_state = 'b2_finalized' AND p_strong_integrity_verified AND v_gap_eligible THEN
    v_grant_integrity := true;
  END IF;

  IF v_effective_state = 'b2_finalized' THEN
    IF p_b2_object_key IS NULL OR btrim(p_b2_object_key) = ''
       OR p_b2_bucket IS NULL OR btrim(p_b2_bucket) = '' THEN
      RAISE EXCEPTION 'b2_finalized requires a B2 object key and bucket';
    END IF;
  END IF;

  -- Gap evidence may only STRENGTHEN within the same generation, mirroring
  -- the Media Agent's own ResolveVODGap semantics: pending_review may
  -- resolve to acknowledged or rejected, an already-resolved value may be
  -- replayed identically, but re-resolving it differently is refused rather
  -- than silently overwriting a recorded operator decision.
  IF v_is_finalization AND v_same_generation
     AND v_row.gap_status IN ('acknowledged', 'rejected')
     AND p_gap_status <> v_row.gap_status THEN
    RAISE EXCEPTION 'gap already resolved as % for this generation; refusing to re-resolve as %',
      v_row.gap_status, p_gap_status;
  END IF;

  UPDATE public.event_recordings
  SET recording_state = v_effective_state,
      finalization_generation = CASE
        WHEN p_finalization_generation IS NOT NULL THEN p_finalization_generation
        ELSE finalization_generation END,
      local_finalized_at = CASE
        WHEN p_local_finalized_at IS NOT NULL THEN p_local_finalized_at
        ELSE local_finalized_at END,
      -- Never cleared by a weaker retry: previously accepted B2 evidence
      -- survives a report that happens to omit it.
      -- Only written once the archive is genuinely Event-authoritative, so
      -- a partial (multi-node) archive never publishes a key that would
      -- later be mistaken for the whole recording.
      b2_object_key = CASE
        WHEN v_effective_state = 'b2_finalized'
          AND p_b2_object_key IS NOT NULL AND btrim(p_b2_object_key) <> '' THEN p_b2_object_key
        ELSE b2_object_key END,
      b2_bucket = CASE
        WHEN v_effective_state = 'b2_finalized'
          AND p_b2_bucket IS NOT NULL AND btrim(p_b2_bucket) <> '' THEN p_b2_bucket
        ELSE b2_bucket END,
      -- Server-owned, set once, never regressed by a later weaker report.
      b2_finalized_at = CASE
        WHEN v_effective_state = 'b2_finalized' AND b2_finalized_at IS NULL THEN now()
        ELSE b2_finalized_at END,
      -- Monotonic promotion: an unverified b2_finalized row can later be
      -- promoted by a same-generation report carrying real verification.
      -- This is what allows retention to freeze at all once the strong
      -- verification mechanism is proven. It is never cleared.
      integrity_verified_at = CASE
        WHEN v_grant_integrity AND integrity_verified_at IS NULL THEN now()
        ELSE integrity_verified_at END,
      gap_count = CASE WHEN p_gap_count IS NOT NULL THEN p_gap_count ELSE gap_count END,
      gap_status = CASE WHEN p_gap_status IS NOT NULL THEN p_gap_status ELSE gap_status END,
      finalization_failure_reason = CASE
        WHEN v_effective_state = 'failed' THEN p_failure_reason
        ELSE NULL END,
      -- 0044: the pointer is bound to the generation. A report that
      -- changes the generation gets the newly proven id or NULL (never the
      -- previous generation's pointer); a same-generation report may only
      -- fill a still-NULL pointer; anything else preserves it.
      r2_playback_id = CASE
        WHEN p_finalization_generation IS NOT NULL
          AND p_finalization_generation IS DISTINCT FROM finalization_generation THEN v_r2_proven
        WHEN r2_playback_id IS NULL AND v_r2_proven IS NOT NULL THEN v_r2_proven
        ELSE r2_playback_id END,
      updated_at = now()
  WHERE event_id = p_event_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_event_recording_transition(uuid, text, text, timestamptz, text, text, integer, text, boolean, text, uuid, text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_event_recording_transition(uuid, text, text, timestamptz, text, text, integer, text, boolean, text, uuid, text[], text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_event_recording_transition(uuid, text, text, timestamptz, text, text, integer, text, boolean, text, uuid, text[], text) TO service_role;

COMMENT ON FUNCTION public.apply_event_recording_transition IS
  'Sole write path into event_recordings. Idempotent, monotonic-by-rank transitions with explicit gap evidence; server-owned b2_finalized_at/integrity_verified_at; single-node activation provenance required for Event-authoritative b2_finalized; frozen retention fields never written here - freeze_event_retention() (migration 0035) remains the only retention writer. 0044: optional p_r2_playback_id is stored as r2_playback_id only when proven (eligible effective state, member of covered_playback_ids, entire activation history single-node with exactly this one playback id), is bound to finalization_generation (reset to the new proof or NULL on any generation change), and is ignored - never rejected - when unproven.';

-- =========================================================================
-- SECTION 2. media_stream_telemetry relay + manifest-age fields
-- =========================================================================
--
-- Source of truth: the Media Agent wire type internal/telemetry.
-- StreamTelemetry (relay_status/relay_restart_count/relay_error_category
-- from the node-local youtube_relays row; manifest_age_seconds from the
-- event's latest live manifest generation). All four are optional on the
-- wire (omitted when unmeasured) and never carry a stream key, destination
-- URL, or raw error text.
--   relay_status          youtube_relays.status CHECK vocabulary
--                         (starting|running|stopped|failed)
--   relay_restart_count   youtube_relays.restart_count, non-negative
--   relay_error_category  telemetry.RelayErrorCategory fixed vocabulary
--   manifest_age_seconds  telemetry.NonNegativeSeconds, >= 0 and finite
-- The Media Agent always sends relay_status and relay_restart_count
-- together (or neither); relay_error_category only accompanies a status.

ALTER TABLE public.media_stream_telemetry
  ADD COLUMN relay_status text NULL,
  ADD COLUMN relay_restart_count integer NULL,
  ADD COLUMN relay_error_category text NULL,
  ADD COLUMN manifest_age_seconds double precision NULL;

ALTER TABLE public.media_stream_telemetry
  ADD CONSTRAINT media_stream_telemetry_relay_status_chk
    CHECK (relay_status IS NULL OR relay_status IN ('starting', 'running', 'stopped', 'failed')),
  ADD CONSTRAINT media_stream_telemetry_relay_restart_count_chk
    CHECK (relay_restart_count IS NULL OR relay_restart_count >= 0),
  ADD CONSTRAINT media_stream_telemetry_relay_error_category_chk
    CHECK (relay_error_category IS NULL OR relay_error_category IN (
      'restart_budget_exhausted', 'ffmpeg_start_failed', 'ffmpeg_exited', 'agent_restarted', 'other'
    )),
  -- `< 'Infinity'` also excludes NaN, which PostgreSQL sorts above every
  -- other double precision value.
  ADD CONSTRAINT media_stream_telemetry_manifest_age_seconds_chk
    CHECK (manifest_age_seconds IS NULL
           OR (manifest_age_seconds >= 0 AND manifest_age_seconds < 'Infinity'::double precision)),
  ADD CONSTRAINT media_stream_telemetry_relay_fields_consistent_chk
    CHECK ((relay_status IS NULL) = (relay_restart_count IS NULL)
           AND (relay_error_category IS NULL OR relay_status IS NOT NULL));

COMMENT ON COLUMN public.media_stream_telemetry.relay_status IS
  'YouTube relay runtime status for the current session (starting|running|stopped|failed). NULL when relay was never enabled or the reported value was invalid.';
COMMENT ON COLUMN public.media_stream_telemetry.relay_restart_count IS
  'Relay restart count for the current session. NULL exactly when relay_status is NULL.';
COMMENT ON COLUMN public.media_stream_telemetry.relay_error_category IS
  'Fixed relay error category (restart_budget_exhausted|ffmpeg_start_failed|ffmpeg_exited|agent_restarted|other). Never raw error text.';
COMMENT ON COLUMN public.media_stream_telemetry.manifest_age_seconds IS
  'max(0, sampled time - published_at) of the event''s latest live manifest generation - a delivery-freshness signal. NULL when no live manifest was ever published or the value was invalid.';

-- Same signature as 0040, so CREATE OR REPLACE preserves the existing ACL;
-- the grants are nevertheless restated explicitly below. The body is 0040
-- verbatim plus per-field validation of the four new optional fields: an
-- invalid optional value is normalized to NULL inside its own guarded
-- block and can never skip the otherwise-valid core telemetry element,
-- abort the batch, or violate a CHECK constraint. Current-assignment
-- authorization and the sampled_at freshness guard are unchanged.
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
  -- 0044: optional relay/manifest fields, normalized to NULL when invalid.
  v_relay_status text;
  v_relay_restart_count integer;
  v_relay_error_category text;
  v_manifest_age_seconds double precision;
  v_num numeric;
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

      -- 0044: optional relay/manifest fields. Each is validated in its own
      -- guarded block and normalized to NULL when absent, mistyped, out of
      -- range, or outside its fixed vocabulary - never allowed to skip
      -- this element or abort the batch.
      v_relay_status := NULL;
      v_relay_restart_count := NULL;
      v_relay_error_category := NULL;
      v_manifest_age_seconds := NULL;

      BEGIN
        IF jsonb_typeof(v_stream->'relay_status') = 'string'
           AND (v_stream->>'relay_status') IN ('starting', 'running', 'stopped', 'failed') THEN
          v_relay_status := v_stream->>'relay_status';
        END IF;
        IF v_relay_status IS NOT NULL AND jsonb_typeof(v_stream->'relay_restart_count') = 'number' THEN
          v_num := (v_stream->>'relay_restart_count')::numeric;
          IF v_num >= 0 AND v_num <= 2147483647 AND v_num = trunc(v_num) THEN
            v_relay_restart_count := v_num::integer;
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_relay_status := NULL;
        v_relay_restart_count := NULL;
      END;
      -- Status and restart count are reported together; if either is
      -- unusable, neither (nor the category) is stored.
      IF v_relay_status IS NULL OR v_relay_restart_count IS NULL THEN
        v_relay_status := NULL;
        v_relay_restart_count := NULL;
      END IF;

      IF v_relay_status IS NOT NULL
         AND jsonb_typeof(v_stream->'relay_error_category') = 'string'
         AND (v_stream->>'relay_error_category') IN (
           'restart_budget_exhausted', 'ffmpeg_start_failed', 'ffmpeg_exited', 'agent_restarted', 'other'
         ) THEN
        v_relay_error_category := v_stream->>'relay_error_category';
      END IF;

      BEGIN
        IF jsonb_typeof(v_stream->'manifest_age_seconds') = 'number' THEN
          v_manifest_age_seconds := (v_stream->>'manifest_age_seconds')::double precision;
          IF NOT (v_manifest_age_seconds >= 0 AND v_manifest_age_seconds < 'Infinity'::double precision) THEN
            v_manifest_age_seconds := NULL;
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        v_manifest_age_seconds := NULL;
      END;

      INSERT INTO public.media_stream_telemetry (
        event_id, reporting_media_node_id, sampled_at, connected,
        srs_publish_active, video_width, video_height, video_codec,
        audio_codec, audio_present, ingest_kbps_recv_30s, recv_bytes,
        captured_segment_bitrate_kbps, publish_duration_seconds,
        session_count, reconnect_count, segment_freshness_seconds,
        relay_status, relay_restart_count, relay_error_category,
        manifest_age_seconds, updated_at
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
        v_relay_status,
        v_relay_restart_count,
        v_relay_error_category,
        v_manifest_age_seconds,
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
        relay_status                  = EXCLUDED.relay_status,
        relay_restart_count           = EXCLUDED.relay_restart_count,
        relay_error_category          = EXCLUDED.relay_error_category,
        manifest_age_seconds          = EXCLUDED.manifest_age_seconds,
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
  'Sole write path for Livestream Technical Telemetry + Media Node Health Reporting. Updates media_nodes heartbeat/capacity columns (migration 0020) with per-field optionality - never a fabricated zero. Upserts current-state media_stream_telemetry per event, authorized against the event''s CURRENT enabled media_event_assignments node, with a sampled_at freshness guard. Durably appends media_stream_sessions, authorized against media_event_assignment_activations history, with session_id UNIQUE + ON CONFLICT DO NOTHING idempotency and identity-safe re-acknowledgement (event_id, reporting_media_node_id, started_at, disconnected_at, segment_count must all match); duration_seconds is server-derived, never client-trusted. Every entry is processed in its own exception-isolated block - a malformed or unauthorized entry is skipped, never written or acknowledged, and never aborts the rest of the batch. 0044: optional relay_status/relay_restart_count/relay_error_category/manifest_age_seconds are validated against their fixed vocabularies/ranges and normalized to NULL when invalid, never skipping otherwise-valid core telemetry. No FPS field, no viewer/audience metric anywhere. Returns the session ids now durably confirmed to belong to this node/event with matching facts, for the caller to echo as AcceptedSessionIDs.';
