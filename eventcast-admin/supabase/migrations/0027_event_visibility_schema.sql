-- Migration 0027: event visibility schema only.
-- This migration deliberately makes no RLS or policy changes; 0028 performs
-- the policy lockdown after the schema and value contract are in place.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'event_visibility'
  ) THEN
    RAISE EXCEPTION 'public.events.event_visibility already exists; refusing an unexpected schema state';
  END IF;
END;
$$;

ALTER TABLE public.events
  ADD COLUMN event_visibility varchar;

-- All existing rows retain current public reachability. privacy_status is UI
-- metadata and is deliberately not used as this access-control boundary.
UPDATE public.events
SET event_visibility = 'public';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.events WHERE event_visibility IS NULL) THEN
    RAISE EXCEPTION 'event_visibility backfill left null event rows';
  END IF;
END;
$$;

ALTER TABLE public.events
  ADD CONSTRAINT events_event_visibility_check
  CHECK (event_visibility IN ('public', 'private', 'synthetic'));

ALTER TABLE public.events
  ALTER COLUMN event_visibility SET NOT NULL,
  ALTER COLUMN event_visibility SET DEFAULT 'public';

COMMIT;
