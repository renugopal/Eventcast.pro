-- ============================================================
-- Migration 0031: widen event_visibility to allow 'unlisted'
-- (V2.1 Public / Unlisted Visibility Foundation Gate — approved decision,
-- corrected during this session to keep anonymous RLS Public-only)
--
-- Adds exactly one additional allowed value ('unlisted') to the existing
-- events_event_visibility_check CHECK constraint on public.events.
-- event_visibility remains the single canonical visibility column — no new
-- column is introduced, no column is renamed.
--
-- Live-schema preflight (this session) confirmed the exact constraint name
-- and definition this migration must safely replace:
--   events_event_visibility_check
--   CHECK (((event_visibility)::text = ANY (ARRAY['public','private','synthetic']::text[])))
-- and confirmed event_visibility is `character varying NOT NULL DEFAULT 'public'`,
-- neither of which this migration touches beyond the CHECK's allowed set.
--
-- SECURITY DECISION (this session): does NOT modify events_public_select_policy
-- or any other RLS policy. Anonymous/public direct Supabase SELECT access to
-- public.events remains Public-only. Published + Unlisted direct-link
-- delivery is provided only by the public render Worker (service-role,
-- single-slug lookup) — never by anonymous database enumeration. Widening
-- the CHECK constraint alone does not change what any RLS policy allows.
--
-- Does not modify existing rows, does not backfill, does not change the
-- column default, does not rename the column, does not touch
-- privacy_status, does not touch any other table.
--
-- LOCAL FILE ONLY. Not applied by this authoring step. Applying it (via
-- `supabase db push` or any other path) requires a separate, explicit
-- approval and pre-apply review.
-- ============================================================

BEGIN;

-- ── Guard: refuse to run against an unexpected schema state ────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass
      AND conname = 'events_event_visibility_check'
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'events_event_visibility_check is missing; refusing an unexpected schema state';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.events'::regclass
      AND conname = 'events_event_visibility_check'
      AND pg_get_constraintdef(oid) ILIKE '%unlisted%'
  ) THEN
    RAISE EXCEPTION 'events_event_visibility_check already allows unlisted; refusing an unexpected schema state';
  END IF;
END;
$$;

-- ── Widen the CHECK constraint only ─────────────────────────────────────────
-- Postgres has no ALTER CHECK ADD VALUE; the constraint is dropped and
-- recreated under the exact same verified name with exactly one additional
-- allowed value. Column type, nullability, and default are untouched.
ALTER TABLE public.events
  DROP CONSTRAINT events_event_visibility_check;

ALTER TABLE public.events
  ADD CONSTRAINT events_event_visibility_check
  CHECK (event_visibility IN ('public', 'private', 'synthetic', 'unlisted'));

COMMIT;
