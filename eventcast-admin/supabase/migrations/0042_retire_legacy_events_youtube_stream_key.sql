-- ============================================================
-- Migration 0042: S3 security containment — retire the legacy
-- public.events.youtube_stream_key value
--
-- Finding S3 (2026-09-25, aggregate-only read-only check; no value was
-- ever selected, sampled, hashed, or returned): 44 of 66 events held a
-- non-empty legacy YouTube stream key, all 44 published / public /
-- non-archived and therefore eligible under events_public_select_policy,
-- with column SELECT available to the anon and authenticated roles. The
-- anon key is public by design, so these values were readable by anyone.
-- The legacy /portal/[slug] page additionally shipped them to browsers via
-- a client-side select('*') (fixed in application code alongside this
-- migration).
--
-- This migration:
--   1. Nulls every stored legacy value in place. The UPDATE neither selects
--      nor returns the values (no RETURNING).
--   2. Adds a CHECK constraint so no non-empty value can ever be stored in
--      this column again. With the column permanently empty, the existing
--      anon/authenticated column read exposes nothing, without rewriting
--      table-level grants (a column-level REVOKE alone is ineffective while
--      table-level SELECT is granted, and a full grant rewrite on
--      public.events is riskier than this containment needs).
--      NULL and the empty string remain allowed, so any legacy reader or
--      writer that only ever passes '' keeps working.
--
-- The column itself is intentionally NOT dropped here. Dropping is deferred
-- to the larger YouTube Destinations package because (a) the column
-- predates tracked migrations and a DROP would need a fresh read-only
-- catalog dependency check, (b) the deliberately retained Cloudflare Pages
-- rollback deployment runs a divergent, unverified source lineage that may
-- still reference it, and (c) the remaining legacy-compatibility references
-- in eventContract.ts belong to that package's cleanup.
--
-- Rotating the exposed keys on YouTube is a separate owner-side action;
-- nulling them here does not invalidate them at YouTube.
--
-- Baseline schema preflight (docs/admin-baseline-v2.1/04) recorded no
-- non-system triggers on public.events, and no tracked migration adds one,
-- so the UPDATE has no trigger side effects. Plain ADD CONSTRAINT (no
-- IF NOT EXISTS equivalent) is deliberate: unexpected pre-existing schema
-- should fail visibly. The UPDATE is idempotent if re-run.
-- ============================================================

UPDATE public.events
SET youtube_stream_key = NULL
WHERE youtube_stream_key IS NOT NULL;

ALTER TABLE public.events
  ADD CONSTRAINT events_youtube_stream_key_retired_chk
  CHECK (youtube_stream_key IS NULL OR btrim(youtube_stream_key) = '');

COMMENT ON COLUMN public.events.youtube_stream_key IS
  'RETIRED (migration 0042, S3 containment). Must never hold a stream key: this table is publicly readable for published events. YouTube ingest keys belong only in the encrypted server-side secret store. Scheduled for removal.';
