-- ============================================================
-- Migration 0043: Lock down the legacy public.stream_alerts table
--
-- A read-only remote audit (Supabase CLI `db query --linked` against
-- pg_class.relacl, pg_policies, information_schema.role_table_grants, and
-- aggregate-only row counts; no row content was read) established the
-- effective production state of this table, which exactly matches
-- migration 0008 (no out-of-band policies were found):
--
--   - RLS enabled, not forced.
--   - Table ACL: anon and authenticated each hold every table privilege
--     (arwdDxtm), granted by the public schema's default privileges -
--     0008 never revoked them.
--   - stream_alerts_service_insert: FOR INSERT WITH CHECK (true) with
--     roles={public}. Its own comment ("anon/user inserts are blocked by
--     default") was wrong: service_role bypasses RLS anyway, so this policy
--     only ever applied to anon/authenticated, letting anyone holding the
--     public anon key insert arbitrary alert rows - including spoofed
--     'critical' alerts against any published event id (event ids are
--     publicly readable), which the studio SELECT policy then surfaced to
--     that studio's members.
--   - TRUNCATE (held by anon/authenticated) is not governed by RLS at all.
--   - stream_alerts_studio_select / stream_alerts_studio_delete: studio-
--     scoped SELECT for members and DELETE for owners.
--
-- Application review: no application route, Worker, Media Agent, or
-- browser code reads or writes this table. Its only writer, the legacy
-- /api/cron/stream-health-monitor route, no longer exists. The 165
-- existing rows (all stream_not_found, 2026-06-04..2026-08-15) are
-- consistent with that retired cron and are intentionally preserved.
--
-- Final posture (the same server-only convention as migrations
-- 0035/0036/0040): RLS stays enabled with zero policies; PUBLIC, anon and
-- authenticated hold no privileges; service_role holds SELECT only. The
-- studio SELECT/DELETE policies are removed too rather than preserved,
-- because no consumer uses them and least privilege applies - a future
-- studio-facing alert surface must add its own reviewed access path.
--
-- Scope: DROP POLICY, REVOKE, GRANT, and a documenting COMMENT only. No
-- row is deleted, the table is not dropped, RLS is not disabled, and no
-- other table's policies or grants change. REVOKE and DROP POLICY IF
-- EXISTS are idempotent.
-- ============================================================

DROP POLICY IF EXISTS stream_alerts_service_insert ON public.stream_alerts;
DROP POLICY IF EXISTS stream_alerts_studio_select ON public.stream_alerts;
DROP POLICY IF EXISTS stream_alerts_studio_delete ON public.stream_alerts;

REVOKE ALL ON TABLE public.stream_alerts FROM PUBLIC;
REVOKE ALL ON TABLE public.stream_alerts FROM anon;
REVOKE ALL ON TABLE public.stream_alerts FROM authenticated;
REVOKE ALL ON TABLE public.stream_alerts FROM service_role;
GRANT SELECT ON TABLE public.stream_alerts TO service_role;

COMMENT ON TABLE public.stream_alerts IS
  'LEGACY (migration 0043 lockdown). Written only by the retired /api/cron/stream-health-monitor route, which no longer exists. Historical rows preserved. RLS enabled with zero policies; no anon/authenticated privileges; service_role SELECT only. Never expose to browser/client code.';
