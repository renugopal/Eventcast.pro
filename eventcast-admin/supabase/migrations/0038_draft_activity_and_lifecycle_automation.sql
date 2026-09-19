-- Draft inactivity tracking foundation for the Event Lifecycle automation
-- package (Archive -> Auto-lifecycle -> Permanent Delete).
--
-- Purely additive. Adds exactly one column; no existing column, constraint,
-- policy, or table is touched.
--
-- Why this column is needed: `events` has no activity/edit timestamp today
-- (confirmed via a live read-only schema check — only `created_at`,
-- `archived_at`, and `page_state` exist among the lifecycle-relevant
-- candidates). The 7-day Draft auto-archive rule requires measuring
-- inactivity since the last MEANINGFUL EDIT, not since creation, so
-- `created_at` cannot be reused for it. The separate 30-day
-- Archived-Draft auto-permanent-delete rule needs no new column at all —
-- it is computed directly from the existing `archived_at`, which restore
-- (sets it back to NULL) and re-archive (sets a fresh value) already
-- correctly reset as a side effect of their existing behavior.
--
-- Each step below is applied separately and idempotently (ADD COLUMN IF
-- NOT EXISTS, then SET DEFAULT, then backfill, then SET NOT NULL) rather
-- than a single ADD COLUMN ... DEFAULT ... NOT NULL statement, so a retry
-- against a partially-applied prior attempt (e.g. the column already
-- exists but without its default) still converges correctly instead of
-- erroring or silently leaving the default unset.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS draft_last_activity_at timestamptz;

ALTER TABLE public.events
  ALTER COLUMN draft_last_activity_at SET DEFAULT now();

-- Explicit, auditable backfill. Every existing row gets a FRESH 7-day
-- grace period starting at rollout time, never its historical
-- created_at/last-edit time — a deliberate product decision so that no
-- pre-existing Draft is retroactively already overdue for auto-archive the
-- moment this migration ships.
--
-- Non-Draft rows also receive this value. That is intentionally harmless:
-- the automation sweep always filters `page_state = 'draft'` first, so a
-- Published/Live/Completed/VOD row's `draft_last_activity_at` is never
-- read by either sweep query — inert by construction, not by convention.
UPDATE public.events
SET draft_last_activity_at = now()
WHERE draft_last_activity_at IS NULL;

-- NOT NULL after backfill: combined with the DEFAULT now() set above,
-- every future insert (Draft or otherwise) is guaranteed a value
-- automatically — both the application's explicit write (Draft
-- create/edit routes) and, as a safety net, the column default itself for
-- any insert path that omits it. This removes an entire class of bug: a
-- NULL timestamp can never silently exempt a Draft from the 7-day
-- inactivity timer forever.
ALTER TABLE public.events
  ALTER COLUMN draft_last_activity_at SET NOT NULL;
