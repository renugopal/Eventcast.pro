-- ============================================================
-- Migration 0019: INTENTIONAL NO-OP — supersession marker.
--
-- The original design of this migration (media_nodes, stream_sessions,
-- media_jobs, event_state_transitions, and additive columns on events)
-- was never applied to the production remote database — see
-- `livestream-infra/supabase/migrations/README.md`, "Validation commands":
-- runtime execution was deferred at the time, and only static SQL review
-- was performed.
--
-- That original design has since been superseded by the narrower,
-- reconciled schema in `0020_media_agent_assignments.sql` (which creates
-- its own `public.media_nodes`) and `0021_media_node_auth.sql` (node
-- credentials and replay-nonce tables). Applying the original 0019 SQL
-- would create a `media_nodes` table before 0020 runs, and 0020's own
-- `CREATE TABLE public.media_nodes` (deliberately not `IF NOT EXISTS`,
-- so it fails loudly rather than silently reusing an incompatible shape)
-- would then error with "relation already exists" and block the entire
-- Media Agent rollout.
--
-- To keep a standard sequential migration runner safe (it must record
-- version 0019 before it will apply 0020/0021), this file intentionally
-- makes NO schema or data changes. It must never create media_nodes,
-- stream_sessions, media_jobs, or event_state_transitions, and must never
-- ALTER TABLE events.
--
-- The complete original SQL is preserved, byte-for-byte, as historical
-- design documentation at:
--   eventcast-admin/supabase/superseded-migrations/0019_livestream_control_plane.original.sql
-- Operators must NOT apply that archived file. It exists only for
-- historical reference.
--
-- Operator note: if any environment is found to already contain
-- stream_sessions, media_jobs, event_state_transitions, or a media_nodes
-- table matching the original (wider) 0019 shape, STOP migration
-- application immediately and reconcile manually before proceeding to
-- 0020/0021 — do not attempt to auto-resolve this by applying either
-- version of 0019.
-- ============================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 0019 is an intentional no-op: superseded by 0020/0021. See eventcast-admin/supabase/superseded-migrations/0019_livestream_control_plane.original.sql for the archived original design.';
END $$;
