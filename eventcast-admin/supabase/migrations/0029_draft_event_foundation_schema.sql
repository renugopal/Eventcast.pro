-- ============================================================
-- Migration 0029: Draft Event Foundation — minimal additive schema
-- (V2.1 baseline, Route-Based Draft Event Foundation slice — SCH-002)
--
-- Adds exactly three additive columns to public.events:
--   scheduled_start_at  (CNT-003 — the one authoritative event timestamp)
--   template_version    (CNT-004 — exact canonical template release pin)
--   page_state          (EVT-001 — Draft/Published, independent of
--                        event_visibility)
--
-- ...and tightens the one public SELECT policy so a Draft row can never be
-- returned through the public event lookup, regardless of the legacy
-- event_visibility default (schema preflight §5: "A new Draft must
-- therefore never be inserted as a publicly visible row").
--
-- No column is dropped. No Restreamer column is touched. No other RLS
-- policy (insert/update/delete, or any non-events table) is touched. No
-- existing row's data is mutated — every new column is nullable or carries
-- a backward-compatible default, so every current row remains exactly as
-- publicly visible and functional as it is today.
--
-- LOCAL FILE ONLY. This migration is not applied — locally or remotely —
-- by this authoring step. Applying it (via `supabase db push` or any other
-- path) requires a separate, explicit approval.
-- ============================================================

BEGIN;

-- ── Guard: refuse to run against an unexpected schema state ────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'scheduled_start_at'
  ) THEN
    RAISE EXCEPTION 'public.events.scheduled_start_at already exists; refusing an unexpected schema state';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'template_version'
  ) THEN
    RAISE EXCEPTION 'public.events.template_version already exists; refusing an unexpected schema state';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'page_state'
  ) THEN
    RAISE EXCEPTION 'public.events.page_state already exists; refusing an unexpected schema state';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'events' AND policyname = 'events_public_select_policy'
  ) THEN
    RAISE EXCEPTION 'events_public_select_policy is missing; refusing to run against an unexpected policy state (expected the state left by 0028_event_visibility_policy_lockdown.sql)';
  END IF;
END;
$$;

-- ── STEP 1: scheduled_start_at ──────────────────────────────────────────────
-- The one authoritative event timestamp (CNT-003 / CRT-007), interpreted in
-- Asia/Kolkata. Nullable and unbackfilled: legacy rows keep using
-- event_date/event_time/timer_target_time exactly as before until a later,
-- separately-approved task migrates them — no existing row's data is
-- computed or mutated here.
ALTER TABLE public.events
  ADD COLUMN scheduled_start_at timestamptz NULL;

COMMENT ON COLUMN public.events.scheduled_start_at IS
  'Authoritative event start time (V2.1 CNT-003), Asia/Kolkata. Legacy event_date/event_time/timer_target_time are compatibility mirrors only and must not be treated as competing authorities once this is set.';

-- ── STEP 2: template_version ────────────────────────────────────────────────
-- Pins the exact canonical template release an event was created with
-- (CNT-004). Nullable: existing rows predate template versioning and are
-- left unbackfilled.
ALTER TABLE public.events
  ADD COLUMN template_version text NULL;

COMMENT ON COLUMN public.events.template_version IS
  'Exact canonical template release version (V2.1 CNT-004). NULL for rows created before template versioning existed.';

-- ── STEP 3: page_state ──────────────────────────────────────────────────────
-- The Draft/Published page-state dimension, independent of the legacy
-- event_visibility column (SCH-002 / EVT-001: lifecycle, page, stream,
-- YouTube, recording, and media status are separate dimensions — this adds
-- only the page dimension, nothing else, and does not redesign the full
-- lifecycle model).
--
-- DEFAULT 'published' is required for backward compatibility: every
-- existing row is already a live, publicly-served event, and defaulting to
-- 'draft' would silently unpublish the entire current catalog. Only a
-- future Draft-aware insert path (a later, separately-approved task) writes
-- 'draft' explicitly.
ALTER TABLE public.events
  ADD COLUMN page_state text NOT NULL DEFAULT 'published'
    CHECK (page_state IN ('draft', 'published'));

COMMENT ON COLUMN public.events.page_state IS
  'Draft/Published page-state (V2.1 EVT-001), independent of event_visibility. Defaults to published for backward compatibility with every pre-existing row; a Draft-safe insert path must set this to draft explicitly.';

-- ── STEP 4: tighten the public SELECT policy ────────────────────────────────
-- A Draft must never be returned through the public event lookup even if
-- event_visibility defaults to 'public'. Every existing row already
-- satisfies page_state = 'published' via the STEP 3 default, so this is a
-- no-op for all current data — it only takes effect once a future insert
-- explicitly writes page_state = 'draft'.
--
-- Only this one policy is touched. events_insert_policy, events_update_policy,
-- and events_delete_policy (owner/admin/studio-member paths) are untouched,
-- as are wishes/page_views/guest_photos policies and every non-events table.
DROP POLICY IF EXISTS events_public_select_policy ON public.events;

CREATE POLICY events_public_select_policy ON public.events
  FOR SELECT
  TO anon, authenticated
  USING (
    event_visibility = 'public'
    AND page_state = 'published'
    AND archived_at IS NULL
  );

COMMIT;
