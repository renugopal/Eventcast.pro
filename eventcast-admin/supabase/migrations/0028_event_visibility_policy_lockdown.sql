-- Migration 0028: visibility-aware public access policies.
-- Service-role callers bypass RLS, so their application-level public-event
-- filters are enforced in the Worker and public API routes.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'event_visibility'
      AND is_nullable = 'NO'
      AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'public.events.event_visibility is not ready for policy lockdown';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass
      AND conname = 'events_event_visibility_check'
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'events_event_visibility_check is missing; refusing policy lockdown';
  END IF;
END;
$$;

-- Preserve events_select_policy, events_insert_policy, events_update_policy,
-- and events_delete_policy. Only the audited broad bypass policies are removed.
DROP POLICY IF EXISTS "Public can view events" ON public.events;
DROP POLICY IF EXISTS "Admin full access on events" ON public.events;

CREATE POLICY events_public_select_policy ON public.events
  FOR SELECT
  TO anon, authenticated
  USING (
    event_visibility = 'public'
    AND archived_at IS NULL
  );

DROP POLICY IF EXISTS wishes_insert_policy ON public.wishes;
DROP POLICY IF EXISTS wishes_select_policy ON public.wishes;

CREATE POLICY wishes_insert_policy ON public.wishes
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.events AS event_row
      WHERE event_row.id = wishes.event_id
        AND event_row.event_visibility = 'public'
        AND event_row.archived_at IS NULL
    )
  );

CREATE POLICY wishes_select_policy ON public.wishes
  FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events AS event_row
      WHERE event_row.id = wishes.event_id
        AND event_row.event_visibility = 'public'
        AND event_row.archived_at IS NULL
    )
  );

DROP POLICY IF EXISTS page_views_insert_policy ON public.page_views;

CREATE POLICY page_views_insert_policy ON public.page_views
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.events AS event_row
      WHERE event_row.id = page_views.event_id
        AND event_row.event_visibility = 'public'
        AND event_row.archived_at IS NULL
    )
  );

DROP POLICY IF EXISTS guest_photos_public_insert ON public.guest_photos;
DROP POLICY IF EXISTS guest_photos_public_select ON public.guest_photos;

CREATE POLICY guest_photos_public_insert ON public.guest_photos
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.events AS event_row
      WHERE event_row.id = guest_photos.event_id
        AND event_row.event_visibility = 'public'
        AND event_row.archived_at IS NULL
    )
  );

CREATE POLICY guest_photos_public_select ON public.guest_photos
  FOR SELECT
  TO anon, authenticated
  USING (
    approved = true
    AND EXISTS (
      SELECT 1
      FROM public.events AS event_row
      WHERE event_row.id = guest_photos.event_id
        AND event_row.event_visibility = 'public'
        AND event_row.archived_at IS NULL
    )
  );

COMMIT;
