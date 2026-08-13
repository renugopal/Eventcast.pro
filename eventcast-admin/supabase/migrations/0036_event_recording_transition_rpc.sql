-- Event recording transition RPC + durable activation history.
--
-- LOCAL DESIGN ONLY as of this commit - NOT applied to the linked Supabase
-- project. Migration 0035 (applied, post-apply verified) is not modified.
--
-- Purpose: let the Media Agent report authoritative B2 archival evidence
-- into public.event_recordings without ever holding direct write access to
-- that table. 0035 deliberately granted service_role SELECT only there and
-- stated that a future writer must add its own explicit path; this is that
-- path, and it is a narrow SECURITY DEFINER state machine rather than a
-- table grant, because the rules below (evidence completeness, allowed
-- transitions, single-node provenance, server-owned timestamps, frozen
-- retention protection) cannot be expressed as a privilege.
--
-- Conventions follow 0035 exactly: fixed safe search_path, fully-qualified
-- object names, explicit validation, FOR UPDATE row locking, EXECUTE
-- revoked from PUBLIC/anon/authenticated and granted only to service_role.

-- =========================================================================
-- 1. Additive columns on event_recordings
-- =========================================================================

-- The finalization generation the stored B2 evidence describes. A
-- deterministic fingerprint of the finalized segment set computed by the
-- Media Agent (internal/upload.FinalizationGeneration) over every
-- playlist-defining field plus the integrity ledger, so any change able to
-- alter the authoritative playlist necessarily changes this value.
ALTER TABLE public.event_recordings ADD COLUMN finalization_generation text;

-- Gap evidence, mirroring the Media Agent's own authoritative
-- vod_finalizations semantics exactly. No new gap vocabulary is invented:
-- 'acknowledged' is an operator's explicit acceptance of a documented gap,
-- 'pending_review' is unresolved, 'rejected' is a refused gap.
--
-- The defaults exist only so a lazily-created 'not_started' row is valid.
-- They are NOT a fallback for a real finalization report: the RPC below
-- requires gap facts to be supplied explicitly for any finalization-bearing
-- transition, so an omitted gap_count can never be read as "no gaps".
ALTER TABLE public.event_recordings ADD COLUMN gap_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.event_recordings ADD COLUMN gap_status text NOT NULL DEFAULT 'none'
  CHECK (gap_status IN ('none', 'pending_review', 'acknowledged', 'rejected'));

-- No new table privileges. service_role keeps SELECT only on
-- event_recordings, exactly as 0035 intended; every write goes through the
-- SECURITY DEFINER function below, which executes as the function owner.

-- =========================================================================
-- 2. media_event_assignment_activations - durable producing-node provenance
-- =========================================================================
--
-- Why this table has to exist: media_event_assignments.assigned_media_node_id
-- is NOT durable producing-node evidence. activate_media_event_assignment
-- (migration 0024) performs scheduler-driven node selection and OVERWRITES
-- assigned_media_node_id, ingest_id and playback_id on the event's single
-- row every time it runs. So after a reassignment, the node that actually
-- produced an earlier recording no longer appears anywhere, while a newly
-- assigned node that produced none of those bytes would appear to own it.
-- Authorizing recording reports from that mutable field would therefore
-- both reject legitimate reports and accept illegitimate ones.
--
-- No existing table preserved this: only media_event_assignments and
-- media_node_credentials reference media_nodes at all, and 0020
-- deliberately did not create stream_sessions/event_state_transitions.
-- This append-only record is the minimum durable evidence that closes it,
-- and the data already flows through the activation function - it was
-- simply being discarded.
CREATE TABLE public.media_event_assignment_activations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  media_node_id uuid NOT NULL REFERENCES public.media_nodes(id),
  -- NOT NULL: a row is only ever inserted AFTER the guarded assignment
  -- update has already produced both values, so a nullable playback
  -- identity could serve no purpose and would weaken the playback-coverage
  -- gate below (a NULL could never be "covered").
  ingest_id     text NOT NULL,
  playback_id   text NOT NULL,
  activated_at  timestamptz NOT NULL DEFAULT now()
);

-- Serves the report-authorization lookup (this event, this node) and the
-- per-event activation scan the provenance gate performs.
CREATE INDEX media_event_assignment_activations_event_node_idx
  ON public.media_event_assignment_activations (event_id, media_node_id);

ALTER TABLE public.media_event_assignment_activations ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies at all, matching 0035's convention for
-- server/service-role-mediated surfaces: RLS enabled with zero policies
-- denies all client row access. This is infrastructure provenance and must
-- never be reachable from a browser session.

REVOKE ALL ON TABLE public.media_event_assignment_activations FROM PUBLIC;
REVOKE ALL ON TABLE public.media_event_assignment_activations FROM anon;
REVOKE ALL ON TABLE public.media_event_assignment_activations FROM authenticated;
REVOKE ALL ON TABLE public.media_event_assignment_activations FROM service_role;
-- SELECT only: the server-side recording-report route reads this to
-- authorize a node. The sole writer is the SECURITY DEFINER activation
-- function below, which inserts as the function owner - never as
-- service_role - so no INSERT/UPDATE/DELETE grant is required or given.
GRANT SELECT ON TABLE public.media_event_assignment_activations TO service_role;

-- =========================================================================
-- 3. activate_media_event_assignment - additive activation record
-- =========================================================================
--
-- Reproduced from migration 0024 with exactly ONE behavioral addition: an
-- append-only activation row inserted inside the same transaction,
-- immediately after the guarded UPDATE has succeeded. Node selection,
-- ordering, FOR UPDATE locking, the live capacity count and its
-- event_id <> p_event_id exclusion, every outcome classification, the
-- return signature, SECURITY DEFINER configuration, and the ACLs are all
-- unchanged.
--
-- The insert is deliberately inside the success branch only: a failed,
-- at-capacity, or no-row-matched activation produces no activation history,
-- because no node was actually given the event.
CREATE OR REPLACE FUNCTION public.activate_media_event_assignment(
  p_event_id uuid,
  p_ingest_id text,
  p_playback_id text,
  p_stream_secret_hash text,
  p_publish_window_start_at timestamptz,
  p_publish_window_end_at timestamptz
)
RETURNS TABLE(outcome text, node_id uuid, ingest_hostname text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_node record;
  v_updated_event_id uuid;
  v_any_eligible boolean := false;
BEGIN
  FOR v_node IN
    SELECT mn.id, mn.ingest_hostname, mn.hard_stream_limit
    FROM public.media_nodes mn
    WHERE mn.status = 'healthy' AND mn.maintenance_mode = false
    ORDER BY mn.created_at ASC
    FOR UPDATE OF mn
  LOOP
    v_any_eligible := true;

    IF (
      SELECT count(*) FROM public.media_event_assignments mea
      WHERE mea.assigned_media_node_id = v_node.id
        AND mea.enabled = true
        AND mea.event_id <> p_event_id
    ) < v_node.hard_stream_limit THEN
      UPDATE public.media_event_assignments
      SET assigned_media_node_id = v_node.id,
          ingest_id = p_ingest_id,
          playback_id = p_playback_id,
          stream_secret_hash = p_stream_secret_hash,
          publish_window_start_at = p_publish_window_start_at,
          publish_window_end_at = p_publish_window_end_at,
          enabled = true
      WHERE event_id = p_event_id AND enabled = false
      RETURNING event_id INTO v_updated_event_id;

      IF v_updated_event_id IS NOT NULL THEN
        -- Durable producing-node provenance, atomic with the activation it
        -- describes. Append-only: a later reassignment adds another row and
        -- never rewrites this one, which is precisely the property
        -- assigned_media_node_id lacks.
        INSERT INTO public.media_event_assignment_activations
          (event_id, media_node_id, ingest_id, playback_id)
        VALUES (p_event_id, v_node.id, p_ingest_id, p_playback_id);

        RETURN QUERY SELECT 'activated'::text, v_node.id, v_node.ingest_hostname;
        RETURN;
      ELSE
        -- The guarded UPDATE matched zero rows: not a capacity problem (this
        -- node had room) - the draft row is already active, doesn't exist,
        -- or is in an unexpected state. Let the caller's existing post-hoc
        -- diagnostic SELECT classify which, exactly as it did before this
        -- function existed.
        RETURN QUERY SELECT 'no_row_matched'::text, NULL::uuid, NULL::text;
        RETURN;
      END IF;
    END IF;
    -- This node is at capacity; loop continues to the next-oldest eligible
    -- node, still holding this node's row lock until the transaction ends.
  END LOOP;

  IF v_any_eligible THEN
    RETURN QUERY SELECT 'node_at_capacity'::text, NULL::uuid, NULL::text;
  ELSE
    RETURN QUERY SELECT 'no_eligible_node'::text, NULL::uuid, NULL::text;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_media_event_assignment(uuid, text, text, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_media_event_assignment(uuid, text, text, text, timestamptz, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_media_event_assignment(uuid, text, text, text, timestamptz, timestamptz) TO service_role;

-- No backfill. Events activated before this migration have no trusted
-- activation history and therefore gain no recording-report authorization.
-- Seeding rows from the current mutable assigned_media_node_id would record
-- an assumption as provenance - and would be wrong for exactly the
-- reassigned events this table exists to handle correctly.

-- =========================================================================
-- 4. apply_event_recording_transition
-- =========================================================================
--
-- Rank helper first: the monotonic ordering the transition rules use.
-- Separate, IMMUTABLE, and trivially testable rather than inlined twice.
CREATE OR REPLACE FUNCTION public.event_recording_state_rank(p_state text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_state
    WHEN 'not_started'     THEN 0
    WHEN 'recording'       THEN 1
    WHEN 'local_finalized' THEN 2
    WHEN 'b2_finalizing'   THEN 3
    WHEN 'b2_finalized'    THEN 4
    WHEN 'failed'          THEN -1
    ELSE -2
  END;
$$;

REVOKE ALL ON FUNCTION public.event_recording_state_rank(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_recording_state_rank(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_recording_state_rank(text) TO service_role;

--
-- The single write path into event_recordings.
--
-- Authoritative timestamps are SERVER-OWNED: there is deliberately no
-- p_b2_finalized_at or p_integrity_verified_at parameter. Both are assigned
-- now() on acceptance, so a delayed, replayed, or clock-skewed node report
-- can start a retention window later than reality but never earlier.
-- p_local_finalized_at is accepted purely as the node's own source evidence
-- and never drives retention.
--
-- p_reporting_media_node_id is supplied by the trusted server route from
-- node AUTHENTICATION - never from the request body - and the route has
-- already verified the node's activation row before calling. The provenance
-- checks here are defense in depth, not a replacement for that.
CREATE OR REPLACE FUNCTION public.apply_event_recording_transition(
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
  p_covered_playback_ids text[] DEFAULT NULL
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
    -- recompute an already-promised retention window.
    UPDATE public.event_recordings
    SET finalization_generation = p_finalization_generation,
        b2_object_key           = p_b2_object_key,
        b2_bucket               = p_b2_bucket,
        b2_finalized_at         = now(),
        integrity_verified_at   = now(),
        gap_count               = p_gap_count,
        gap_status              = p_gap_status,
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
      updated_at = now()
  WHERE event_id = p_event_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_event_recording_transition(uuid, text, text, timestamptz, text, text, integer, text, boolean, text, uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_event_recording_transition(uuid, text, text, timestamptz, text, text, integer, text, boolean, text, uuid, text[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_event_recording_transition(uuid, text, text, timestamptz, text, text, integer, text, boolean, text, uuid, text[]) TO service_role;

COMMENT ON FUNCTION public.apply_event_recording_transition IS
  'Sole write path into event_recordings. Idempotent, monotonic-by-rank transitions with explicit gap evidence; server-owned b2_finalized_at/integrity_verified_at; single-node activation provenance required for Event-authoritative b2_finalized; frozen retention fields never written here - freeze_event_retention() (migration 0035) remains the only retention writer.';

-- Note: this migration writes no platform_audit_log row and does not alter
-- platform_audit_log.actor_user_id. That column's NOT NULL reference to
-- auth.users encodes a real invariant for human, high-risk Platform
-- Operations actions, and weakening it so an automated node transition
-- could be logged would trade a genuine guarantee for redundancy - the
-- durable event_recordings row and the node's own b2_archives outbox
-- already record this evidence.
