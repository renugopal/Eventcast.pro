-- ============================================================
-- Migration 0023: Reconcile subscription_notifications /
-- plan_limits / addon_pricing with verified production reality
--
-- A read-only remote audit (literal pg_policies / information_schema /
-- pg_indexes CSV exports, compared line-by-line against 0015's source)
-- proved that production already diverges from 0015_billing_v2.sql in two
-- ways:
--   - public.subscription_notifications already carries a real
--     `notification_date date NOT NULL DEFAULT CURRENT_DATE` column, and
--     `sub_notif_unique_per_day` is already a UNIQUE index on the physical
--     columns (studio_id, notification_type, channel, notification_date) -
--     not 0015's original expression index on (sent_at::date).
--   - public.plan_limits, public.addon_pricing, and
--     public.subscription_notifications already have Row Level Security
--     enabled, which 0015 never enables.
--
-- This migration intentionally codifies that already-verified production
-- reality forward. It does NOT attempt to replay or rewrite migration
-- 0015 (0015's own file is left exactly as originally authored - migration
-- files are never edited after the fact, matching this repository's
-- established convention). The stored notification_date column design is
-- retained rather than reverted to 0015's original sent_at::date
-- expression index: notification_date is simpler and avoids the
-- timezone/precision edge cases of casting a timestamptz to date at query
-- time, and no evidence was found anywhere in the application or migration
-- history that anything depends on the original expression-index shape.
-- The three RLS enablements are retained as intentional hardening (RLS
-- enabled is strictly more restrictive than 0015's original un-enabled
-- state, and no anon/authenticated policy exists or is added on any of the
-- three tables, so they remain service-role-only, consistent with every
-- other internal reference/control table in this schema).
--
-- Every statement below is idempotent against the current, already-
-- reconciled production shape: DROP INDEX IF EXISTS + CREATE UNIQUE INDEX
-- deliberately re-creates the index explicitly (rather than a no-op
-- CREATE INDEX IF NOT EXISTS) so its exact definition is captured in
-- version control, not merely assumed from an unreconciled index name.
--
-- Scope: this migration touches only public.subscription_notifications,
-- public.plan_limits, and public.addon_pricing. No policy is added or
-- changed. No data is inserted, updated, deleted, or backfilled. No other
-- table, column, function, trigger, grant, or index is touched. No
-- application code is changed.
-- ============================================================

ALTER TABLE public.subscription_notifications
  ADD COLUMN IF NOT EXISTS notification_date date NOT NULL DEFAULT CURRENT_DATE;

DROP INDEX IF EXISTS public.sub_notif_unique_per_day;

CREATE UNIQUE INDEX sub_notif_unique_per_day
  ON public.subscription_notifications (studio_id, notification_type, channel, notification_date);

ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addon_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_notifications ENABLE ROW LEVEL SECURITY;
