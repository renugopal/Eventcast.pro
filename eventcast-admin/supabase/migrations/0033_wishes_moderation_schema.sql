-- ============================================================
-- Migration 0033: Wishes moderation schema (Media + Engagement Core)
--
-- Baseline WISH-002 ("Wishes use review-first moderation with approve, pin,
-- hide, reject, and delete controls") cannot be truthfully implemented
-- against the current `wishes` table: it has no status/pin column at all,
-- only `id, name, message, event_id, studio_id, created_at`. This migration
-- adds exactly the two columns needed to represent that state honestly,
-- additively, with a default that preserves today's behavior exactly (every
-- existing and newly-inserted wish starts 'approved' — nothing changes for
-- guests submitting a wish, matching the fact that Wishes have no per-event
-- Manual Approval toggle in this package, unlike Guest Memories/GM-004).
--
-- `status` values: 'approved' (visible, default — unchanged current
-- behavior), 'hidden' (provider-hidden, reversible), 'rejected' (provider
-- rejected, reversible — distinct from delete, which is permanent).
-- `is_pinned` supports the accepted "pin" moderation action; pinning does
-- not affect visibility on its own.
--
-- The public anonymous `wishes_select_policy` (last defined by migration
-- 0032, Published + Public/Unlisted eligibility) is widened by exactly one
-- additional condition, `status = 'approved'`, so a provider's hide/reject
-- action actually removes a wish from the public page. No other condition
-- in that policy changes. `wishes_insert_policy` (public submission) is not
-- touched — new wishes still insert with the column default of 'approved',
-- preserving today's "wish appears immediately" behavior. The existing
-- studio-scoped `wishes_delete_policy` is not touched.
--
-- Provider moderation mutations (approve/hide/reject/pin/delete) are
-- performed through a new authenticated API route using the service-role
-- client plus application-layer ownership checks (the same established
-- pattern as the Partner/Event Credit and thumbnail routes), not a new RLS
-- UPDATE policy — consistent with how every other studio-mutation route in
-- this codebase already works.
--
-- LOCAL FILE ONLY. Not applied by this authoring step. Applying it requires
-- a separate, explicit approval and pre-apply review.
-- ============================================================

BEGIN;

-- ── Guard: refuse to run against an unexpected schema/policy state ─────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wishes' AND column_name = 'status'
  ) THEN
    RAISE EXCEPTION 'public.wishes.status already exists; refusing to run this migration twice';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wishes' AND policyname = 'wishes_select_policy'
  ) THEN
    RAISE EXCEPTION 'wishes_select_policy is missing; refusing an unexpected policy state';
  END IF;
END;
$$;

ALTER TABLE public.wishes
  ADD COLUMN status text NOT NULL DEFAULT 'approved'
    CHECK (status IN ('approved', 'hidden', 'rejected'));

ALTER TABLE public.wishes
  ADD COLUMN is_pinned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS wishes_event_id_status_idx ON public.wishes(event_id, status);

-- ── wishes_select_policy — add status = 'approved' to the exact 0032 policy ─
DROP POLICY IF EXISTS wishes_select_policy ON public.wishes;
CREATE POLICY wishes_select_policy ON public.wishes
  FOR SELECT
  TO anon, authenticated
  USING (
    status = 'approved'
    AND EXISTS (
      SELECT 1
      FROM public.events AS event_row
      WHERE event_row.id = wishes.event_id
        AND event_row.page_state = 'published'
        AND event_row.event_visibility IN ('public', 'unlisted')
        AND event_row.archived_at IS NULL
    )
  );

COMMIT;
