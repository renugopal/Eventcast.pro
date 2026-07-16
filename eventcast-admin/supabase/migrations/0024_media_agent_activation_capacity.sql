-- ============================================================
-- Migration 0024: concurrency-safe, capacity-aware assignment activation
--
-- Adds exactly one function: public.activate_media_event_assignment.
-- No new tables, no new columns, no changes to existing RLS policies.
--
-- Why a function instead of application-code select-then-update: the
-- previous activation path (Slice 4, assignmentActivation.ts) selected an
-- eligible node with a plain SELECT and then activated the draft row with a
-- separately-guarded UPDATE. That is safe against double-activating the same
-- event (the UPDATE's own WHERE clause handles that), but it is NOT safe
-- against two concurrent activations for two DIFFERENT events both reading
-- "this node has capacity" before either one commits its UPDATE - a classic
-- read-committed check-then-act race that could oversubscribe a node past
-- its hard_stream_limit. A single SQL statement's WHERE clause cannot
-- express "and the node I'm about to assign still has spare capacity" as a
-- correlated subquery through the Supabase JS query builder, and even if it
-- could, evaluating that subquery and performing the UPDATE as two separate
-- round trips would not close the race. `SELECT ... FOR UPDATE` on the
-- candidate media_nodes row inside a single function invocation (one
-- Postgres transaction) is the standard, minimal mechanism that actually
-- closes it: a second concurrent caller targeting the same node blocks on
-- the row lock until the first caller's transaction commits or rolls back,
-- at which point it re-reads the now-current enabled count.
--
-- Node eligibility inside this function is status = 'healthy' AND
-- maintenance_mode = false, per 03_DATA_MODEL_AND_API_CONTRACTS.md's
-- documented intent ("Only healthy nodes outside maintenance mode may
-- receive new assignments") - tightened from the previous
-- `status != 'retired'` filter.
--
-- This function does not generate ingest_id/playback_id/token/publish
-- window - the caller (assignmentActivation.ts) still generates those and
-- passes them in, and still owns the ingest_id/playback_id collision-retry
-- loop (a 23505 from this function's UPDATE is surfaced to the caller
-- exactly as before). This function's sole added responsibility is safe
-- node selection under concurrency and capacity enforcement.
-- ============================================================

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
  -- Oldest-first, exactly matching the previous single-node-deployment
  -- selection order. FOR UPDATE locks each candidate row as it is visited,
  -- so a second concurrent invocation targeting the same node blocks here
  -- until this transaction ends, rather than racing past this check.
  FOR v_node IN
    SELECT mn.id, mn.ingest_hostname, mn.hard_stream_limit
    FROM public.media_nodes mn
    WHERE mn.status = 'healthy' AND mn.maintenance_mode = false
    ORDER BY mn.created_at ASC
    FOR UPDATE OF mn
  LOOP
    v_any_eligible := true;

    -- Authoritative capacity source is this live count of the node's
    -- currently-enabled assignments - NOT media_nodes.active_stream_count,
    -- which nothing writes to and which this function deliberately never
    -- reads. event_id <> p_event_id excludes the requested event's own row:
    -- without this, a retry of an already-activated event would count
    -- itself against the node's capacity and be misclassified as
    -- node_at_capacity instead of reaching the guarded UPDATE below and
    -- being classified already_activated. A genuinely new event is never
    -- affected by this exclusion, since its own row does not exist yet (or
    -- is enabled = false and so was never counted in the first place).
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

COMMENT ON FUNCTION public.activate_media_event_assignment IS
  'Concurrency-safe activation: locks eligible (status=healthy, maintenance_mode=false) media_nodes rows FOR UPDATE, oldest first, enforces hard_stream_limit against the live count of that node''s currently-enabled assignments, and performs the same guarded UPDATE ... WHERE event_id = $1 AND enabled = false the previous application-code path used. Returns one of: activated, no_row_matched (caller classifies further), node_at_capacity, no_eligible_node.';

-- SECURITY DEFINER bypasses RLS on media_nodes/media_event_assignments (both
-- service-role-only per migration 0020) regardless of caller, so EXECUTE
-- must be restricted explicitly rather than left at the PostgreSQL default
-- (GRANT EXECUTE TO PUBLIC on function creation).
REVOKE ALL ON FUNCTION public.activate_media_event_assignment(uuid, text, text, text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_media_event_assignment(uuid, text, text, text, timestamptz, timestamptz) TO service_role;
