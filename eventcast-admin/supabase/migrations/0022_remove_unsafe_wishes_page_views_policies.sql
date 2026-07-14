-- ============================================================
-- Migration 0022: Remove unsafe out-of-band RLS policies on
-- public.wishes and public.page_views
--
-- A read-only remote audit (Supabase Dashboard SQL Editor, pg_policies +
-- information_schema.role_table_grants) found policies on these two tables
-- that were never part of any migration in this repository (0001-0021).
-- They are hand-applied, out-of-band additions, and confirmed to be either
-- exact duplicates of the canonical 0003 policies or genuine tenant-
-- isolation bypasses:
--
--   - "Authenticated users can delete wishes" (DELETE) and
--     "Authenticated users can read wishes" (SELECT) on public.wishes both
--     had USING (auth.role() = 'authenticated' OR true) with roles={public}
--     and anon/authenticated both holding table-level DELETE/SELECT
--     privilege. `x OR true` is unconditionally true, so these two policies
--     let ANY caller (any studio, and per the table-level grants,
--     potentially unauthenticated ones too) delete or read ANY row in
--     wishes, completely bypassing the studio-scoped canonical
--     wishes_delete_policy from 0003.
--   - "Admin can delete wishes" and "Admin can update and delete wishes" on
--     public.wishes only checked auth.role() = 'authenticated' - despite
--     their names, they enforce neither studio ownership
--     (studio_members.role) nor platform admin status
--     (platform_users.platform_role = 'super_admin'), so any logged-in
--     user from any studio could delete or update any other studio's
--     wishes.
--   - "Anyone can read page views" on public.page_views had USING (true)
--     with roles={public} and anon/authenticated holding table-level
--     SELECT privilege, making studio-private analytics data (referrer,
--     device_type, user_agent, country per event) fully public - directly
--     contradicting 0003's own intent ("Studio members can read page views
--     for their own studio's events").
--   - "Admin full access on page_views" (ALL commands) only checked
--     auth.role() = 'authenticated', granting any logged-in user
--     unrestricted SELECT/INSERT/UPDATE/DELETE on page_views regardless of
--     studio.
--   - "Anyone can insert wishes" / "Public can insert wishes" and
--     "Anyone can insert page views" / "Public can insert page_views" were
--     exact-duplicate INSERT policies functionally redundant with the
--     canonical wishes_insert_policy / page_views_insert_policy from 0003.
--   - "Public can view wishes" was a redundant duplicate SELECT policy:
--     0003's own wishes_select_policy already makes wishes readable by
--     anyone for any event with a non-null studio_id (virtually all
--     events), so this extra granted no meaningful additional access, but
--     is removed anyway for a single, auditable source of truth.
--
-- Local application-code review (browser guest script, studio dashboard,
-- moderation panel, analytics dashboard) confirmed no code path depends on
-- any of the policies dropped below - every legitimate flow (guest wish
-- submission/display, guest page-view tracking, studio-scoped analytics
-- reads, owner/admin wish moderation) is already fully served by the
-- canonical 0003 policies, which this migration does not touch.
--
-- Canonical 0003 policies remain the sole source of truth after this
-- migration and are intentionally left untouched:
--   - wishes_insert_policy   - public wishes INSERT remains supported
--   - wishes_select_policy   - public wishes SELECT remains supported
--   - wishes_delete_policy   - wishes DELETE remains owner/admin, studio-scoped
--   - page_views_insert_policy - page_views INSERT remains public
--   - page_views_select_policy - page_views SELECT remains studio-scoped (private)
--
-- Scope: DROP POLICY only. No GRANT/REVOKE (table-level privileges are
-- unchanged - RLS policy removal is what closes the access, not a grant
-- change), no RLS enable/disable change, no ALTER TABLE, no DROP TABLE,
-- and no change to any policy on public.events or public.photographers
-- (those are a separate, later audit). No application code is changed by
-- this migration.
-- ============================================================

DROP POLICY IF EXISTS "Admin can delete wishes" ON public.wishes;
DROP POLICY IF EXISTS "Admin can update and delete wishes" ON public.wishes;
DROP POLICY IF EXISTS "Anyone can insert wishes" ON public.wishes;
DROP POLICY IF EXISTS "Authenticated users can delete wishes" ON public.wishes;
DROP POLICY IF EXISTS "Authenticated users can read wishes" ON public.wishes;
DROP POLICY IF EXISTS "Public can insert wishes" ON public.wishes;
DROP POLICY IF EXISTS "Public can view wishes" ON public.wishes;

DROP POLICY IF EXISTS "Admin full access on page_views" ON public.page_views;
DROP POLICY IF EXISTS "Anyone can insert page views" ON public.page_views;
DROP POLICY IF EXISTS "Anyone can read page views" ON public.page_views;
DROP POLICY IF EXISTS "Public can insert page_views" ON public.page_views;
