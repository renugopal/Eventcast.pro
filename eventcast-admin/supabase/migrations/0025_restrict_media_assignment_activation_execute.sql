-- ============================================================
-- Migration 0025: restrict activate_media_event_assignment EXECUTE to
-- service_role only
--
-- Root cause (confirmed via post-0024 production catalog verification):
-- migration 0024's `REVOKE ALL ON FUNCTION ... FROM PUBLIC` only revokes
-- the PUBLIC pseudo-role's grant. No `ALTER DEFAULT PRIVILEGES` statement
-- exists anywhere in this repository's migration history - the anon and
-- authenticated EXECUTE grants observed in production came from
-- Supabase's own project-level default privileges (configured at project
-- initialization, outside this repo's migration files), which
-- automatically attach a separate, NAMED EXECUTE grant to anon and
-- authenticated on any newly-created function in the public schema.
-- `REVOKE ALL ... FROM PUBLIC` never touches those named grants, which is
-- exactly why the verified state after 0024 was public_grant_count = 0
-- (PUBLIC correctly revoked) alongside anon_execute = true and
-- authenticated_execute = true (their own separate grants untouched).
--
-- This migration explicitly revokes EXECUTE from PUBLIC, anon, and
-- authenticated by name (the PUBLIC revoke is repeated here defensively -
-- REVOKE is idempotent, so re-stating it is a safe no-op, not an error -
-- so this migration is self-sufficient and doesn't depend on 0024 having
-- run first to reach the correct end state), and re-grants only to
-- service_role. It does not recreate or alter the function body, and it
-- does not touch any table, RLS policy, node row, assignment, or
-- credential.
-- ============================================================

REVOKE ALL ON FUNCTION public.activate_media_event_assignment(
  uuid,
  text,
  text,
  text,
  timestamptz,
  timestamptz
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.activate_media_event_assignment(
  uuid,
  text,
  text,
  text,
  timestamptz,
  timestamptz
) FROM anon;

REVOKE ALL ON FUNCTION public.activate_media_event_assignment(
  uuid,
  text,
  text,
  text,
  timestamptz,
  timestamptz
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.activate_media_event_assignment(
  uuid,
  text,
  text,
  text,
  timestamptz,
  timestamptz
) TO service_role;
