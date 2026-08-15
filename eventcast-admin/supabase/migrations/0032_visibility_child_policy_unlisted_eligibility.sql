-- ============================================================
-- Migration 0032: Public + Unlisted eligibility for existing guest
-- engagement child-table policies (narrow compatibility correction within
-- the Public / Unlisted Visibility Foundation Gate feature)
--
-- Migration 0028 created five anon/authenticated child-table policies that
-- gate ordinary page-runtime guest actions (submit a Wish, read Wishes,
-- record a page view, upload a Guest Photo, read approved Guest Photos) on
-- `event_visibility = 'public'` alone:
--   wishes_insert_policy, wishes_select_policy, page_views_insert_policy,
--   guest_photos_public_insert, guest_photos_public_select
--
-- These are child-resource operations already scoped to a known event_id
-- from the rendered event page — not a discovery/listing surface — so per
-- Baseline §8 ("Unlisted remains link-accessible, just not indexed") they
-- should behave the same on a Published + Unlisted page as on a Published +
-- Public page. This migration widens exactly those five policies' event
-- eligibility to:
--   page_state = 'published' AND event_visibility IN ('public', 'unlisted')
-- and nothing else.
--
-- IMPORTANT: migration 0028 predates `page_state` (added later by 0029) —
-- none of these five policies currently check it at all, only
-- `event_visibility = 'public' AND archived_at IS NULL`. A Draft's
-- `event_visibility` defaults to 'unlisted' (see 0031 and the Draft-create
-- route), so naively adding 'unlisted' to these policies WITHOUT also
-- requiring `page_state = 'published'` would make every Draft's Wishes,
-- Guest Photos, and page-view collection anonymously writable/readable —
-- a real regression. Adding `page_state = 'published'` here closes that gap
-- as part of the same narrow change, rather than leaving it implicit.
--
-- Does NOT touch `events_public_select_policy` (stays Public-only,
-- unwidened — Unlisted direct-link delivery remains the Worker's job only).
-- Does NOT touch migration 0028 itself. Does NOT touch any other policy,
-- table, or the `events_event_visibility_check` CHECK constraint (0031).
-- Does NOT allow legacy `private`/`synthetic` events. Does NOT create any
-- new listing/enumeration capability — every policy here still resolves a
-- single already-known `event_id`, exactly as it did before.
--
-- LOCAL FILE ONLY. Not applied by this authoring step. Applying it (via
-- `supabase db push` or any other path) requires a separate, explicit
-- approval and pre-apply review. Depends on migrations 0029 (page_state)
-- and 0031 (event_visibility allows 'unlisted') already being applied.
-- ============================================================

BEGIN;

-- ── Guard: refuse to run against an unexpected schema/policy state ─────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'page_state'
  ) THEN
    RAISE EXCEPTION 'public.events.page_state is missing; this migration requires 0029 to be applied first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass
      AND conname = 'events_event_visibility_check'
      AND pg_get_constraintdef(oid) ILIKE '%unlisted%'
  ) THEN
    RAISE EXCEPTION 'events_event_visibility_check does not yet allow unlisted; this migration requires 0031 to be applied first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wishes' AND policyname = 'wishes_insert_policy'
  ) THEN
    RAISE EXCEPTION 'wishes_insert_policy is missing; refusing an unexpected policy state';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wishes' AND policyname = 'wishes_select_policy'
  ) THEN
    RAISE EXCEPTION 'wishes_select_policy is missing; refusing an unexpected policy state';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'page_views' AND policyname = 'page_views_insert_policy'
  ) THEN
    RAISE EXCEPTION 'page_views_insert_policy is missing; refusing an unexpected policy state';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guest_photos' AND policyname = 'guest_photos_public_insert'
  ) THEN
    RAISE EXCEPTION 'guest_photos_public_insert is missing; refusing an unexpected policy state';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'guest_photos' AND policyname = 'guest_photos_public_select'
  ) THEN
    RAISE EXCEPTION 'guest_photos_public_select is missing; refusing an unexpected policy state';
  END IF;
END;
$$;

-- ── wishes ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS wishes_insert_policy ON public.wishes;
CREATE POLICY wishes_insert_policy ON public.wishes
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.events AS event_row
      WHERE event_row.id = wishes.event_id
        AND event_row.page_state = 'published'
        AND event_row.event_visibility IN ('public', 'unlisted')
        AND event_row.archived_at IS NULL
    )
  );

DROP POLICY IF EXISTS wishes_select_policy ON public.wishes;
CREATE POLICY wishes_select_policy ON public.wishes
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events AS event_row
      WHERE event_row.id = wishes.event_id
        AND event_row.page_state = 'published'
        AND event_row.event_visibility IN ('public', 'unlisted')
        AND event_row.archived_at IS NULL
    )
  );

-- ── page_views ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS page_views_insert_policy ON public.page_views;
CREATE POLICY page_views_insert_policy ON public.page_views
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.events AS event_row
      WHERE event_row.id = page_views.event_id
        AND event_row.page_state = 'published'
        AND event_row.event_visibility IN ('public', 'unlisted')
        AND event_row.archived_at IS NULL
    )
  );

-- ── guest_photos ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS guest_photos_public_insert ON public.guest_photos;
CREATE POLICY guest_photos_public_insert ON public.guest_photos
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.events AS event_row
      WHERE event_row.id = guest_photos.event_id
        AND event_row.page_state = 'published'
        AND event_row.event_visibility IN ('public', 'unlisted')
        AND event_row.archived_at IS NULL
    )
  );

DROP POLICY IF EXISTS guest_photos_public_select ON public.guest_photos;
CREATE POLICY guest_photos_public_select ON public.guest_photos
  FOR SELECT
  TO anon, authenticated
  USING (
    approved = true
    AND EXISTS (
      SELECT 1
      FROM public.events AS event_row
      WHERE event_row.id = guest_photos.event_id
        AND event_row.page_state = 'published'
        AND event_row.event_visibility IN ('public', 'unlisted')
        AND event_row.archived_at IS NULL
    )
  );

COMMIT;
