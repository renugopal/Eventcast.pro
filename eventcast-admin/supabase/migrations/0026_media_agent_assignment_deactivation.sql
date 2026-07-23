-- ============================================================
-- Migration 0026: idempotent assignment deactivation / capacity release
--
-- Adds exactly one function: public.deactivate_media_event_assignment.
-- No new tables, no new columns, no changes to existing RLS policies.
--
-- This is the release-side counterpart to migration 0024's
-- activate_media_event_assignment: the previous gap was that nothing in
-- this codebase ever set media_event_assignments.enabled back to false,
-- so an ended event's assignment permanently occupied one unit of its
-- node's hard_stream_limit forever. Capacity has always been a live count
-- of `enabled = true` rows (see 0024's own comment: media_nodes.
-- active_stream_count is never read or written anywhere) — so releasing
-- capacity requires nothing more than flipping enabled to false; there is
-- no separate counter to decrement, in either direction.
--
-- Unlike activate_media_event_assignment, this function does NOT need a
-- `SELECT ... FOR UPDATE` loop over media_nodes: activation needed that
-- lock because two different events could race to claim the same node's
-- last unit of capacity (a cross-row check-then-act race). Deactivation
-- performs no cross-row capacity computation at all — it is a single
-- guarded UPDATE keyed by event_id, and Postgres's own row-level locking
-- during that UPDATE is already sufficient: a second concurrent caller
-- targeting the same row blocks until the first transaction commits or
-- rolls back, then re-evaluates its own WHERE clause against the
-- now-current state. This is the exact same mechanism
-- activate_media_event_assignment's guarded UPDATE already relies on for
-- its own already_activated idempotency.
--
-- Deliberately does NOT delete the assignment row, clear ingest_id /
-- playback_id / assigned_media_node_id / stream_secret_hash / either
-- publish-window bound, or touch publish_window_end_at — historical
-- assignment information is preserved, not erased, on deactivation (per
-- 02_V1_ARCHITECTURE_SPEC.md: "Deletion actions MUST be auditable and must
-- not be inferred from an event merely becoming inactive"). Deliberately
-- does NOT read or write media_nodes.active_stream_count, for the same
-- reason 0024 never does.
--
-- Learning from this repo's own 0024 -> 0025 history: 0024 alone revoked
-- only PUBLIC's EXECUTE grant, missing Supabase's separate project-level
-- default privileges that auto-attach EXECUTE grants to anon and
-- authenticated on any newly-created public-schema function; 0025 had to
-- fix that as a follow-up. This migration revokes PUBLIC, anon, AND
-- authenticated by name from the very first migration that creates this
-- function, so no follow-up correction is needed here.
-- ============================================================

CREATE OR REPLACE FUNCTION public.deactivate_media_event_assignment(
  p_event_id uuid
)
RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_event_id uuid;
BEGIN
  -- Guarded UPDATE: only ever transitions enabled true -> false for this
  -- exact event_id. A retry (or a concurrent second caller) simply finds
  -- zero rows matching once the first call has committed, and the caller
  -- classifies that as already_inactive rather than an error.
  UPDATE public.media_event_assignments
  SET enabled = false
  WHERE event_id = p_event_id AND enabled = true
  RETURNING event_id INTO v_updated_event_id;

  IF v_updated_event_id IS NOT NULL THEN
    RETURN QUERY SELECT 'deactivated'::text;
  ELSE
    -- Not gating anything further here — the caller's own diagnostic
    -- SELECT (mirroring activate's classifyNoRowMatched) distinguishes
    -- already_inactive from no_assignment from event_not_found.
    RETURN QUERY SELECT 'no_row_matched'::text;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.deactivate_media_event_assignment IS
  'Idempotent capacity release: performs the guarded UPDATE ... SET enabled = false WHERE event_id = $1 AND enabled = true. Never deletes the row, never clears historical fields, never touches media_nodes.active_stream_count. Returns one of: deactivated, no_row_matched (caller classifies further into already_inactive / no_assignment / error).';

-- SECURITY DEFINER bypasses RLS on media_event_assignments (service-role-only
-- per migration 0020) regardless of caller, so EXECUTE must be restricted
-- explicitly, from PUBLIC, anon, and authenticated by name — not left at
-- the PostgreSQL default (GRANT EXECUTE TO PUBLIC on function creation) and
-- not left to a follow-up migration, per the 0024/0025 lesson above.
REVOKE ALL ON FUNCTION public.deactivate_media_event_assignment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deactivate_media_event_assignment(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.deactivate_media_event_assignment(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_media_event_assignment(uuid) TO service_role;
