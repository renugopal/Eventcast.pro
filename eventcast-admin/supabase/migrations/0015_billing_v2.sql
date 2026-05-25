-- ============================================================
-- Migration 0015: Billing V2 — New Plan Tiers
-- Plans: free (1 event) | pay_per_use (wallet) |
--        basic (5/mo) | professional (15/mo) | business (30/mo) | enterprise (custom)
-- Stream duration: free = 8hrs, paid = 12hrs
-- Add-ons: extra destinations ₹49/dest or ₹99/event bundle (up to 5)
-- Grandfather pricing: ₹299 launch → ₹499 regular (after 12 months)
-- Run once in Supabase SQL editor
-- ============================================================

-- 1. Extend plan_tier check to support new tiers
--    (old tiers: 'free', 'pay_per_event', 'pro', 'agency')
--    (new tiers: 'free', 'pay_per_use', 'basic', 'professional', 'business', 'enterprise')
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_tier_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_tier_check
  CHECK (plan_tier IN (
    'free',
    'pay_per_use',
    'pay_per_event',   -- kept for backward compat with existing rows
    'basic',
    'professional',
    'business',
    'enterprise',
    'pro',             -- kept for backward compat
    'agency'           -- kept for backward compat
  ));

-- 2. Add events-per-month limit columns
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS events_per_month        INTEGER DEFAULT 1;
  -- free=1, pay_per_use=NULL(wallet), basic=5, professional=15, business=30, enterprise=NULL(custom)

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS events_used_this_month  INTEGER DEFAULT 0;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS month_reset_at          TIMESTAMPTZ
    DEFAULT date_trunc('month', now()) + interval '1 month';

-- 3. Stream duration limit (hours)
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stream_duration_limit_hours INTEGER DEFAULT 8;
  -- free=8, all paid=12

-- 4. Grandfather pricing tracking
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS grandfather_pricing     BOOLEAN DEFAULT FALSE;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS grandfather_until       TIMESTAMPTZ;
  -- Set to (subscription_created_at + 12 months) for launch users

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS pay_per_use_price_paise INTEGER DEFAULT 29900;
  -- ₹299 launch price (29900 paise). Changes to 49900 after grandfather period ends.

-- 5. Auto fallback to pay_per_use when subscription expires
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS auto_fallback_payperuse BOOLEAN DEFAULT TRUE;

-- 6. Add-on tracking per subscription
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS extra_destinations_enabled BOOLEAN DEFAULT FALSE;
  -- If TRUE: charged ₹49/destination or ₹99/event bundle (tracked per-event)

-- 7. Plan limits reference table (for UI display)
CREATE TABLE IF NOT EXISTS plan_limits (
  plan_tier            TEXT PRIMARY KEY,
  display_name         TEXT NOT NULL,
  price_monthly_paise  INTEGER,          -- NULL for free/pay_per_use/enterprise
  events_per_month     INTEGER,          -- NULL = unlimited/custom
  stream_duration_hrs  INTEGER NOT NULL DEFAULT 12,
  destinations_included INTEGER NOT NULL DEFAULT 2,  -- HLS + YouTube
  guest_photos_per_event INTEGER NOT NULL DEFAULT 50,
  vod_days             INTEGER NOT NULL DEFAULT 30,
  subdomain_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  custom_domain_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order           INTEGER NOT NULL DEFAULT 0
);

-- Seed plan limits data
INSERT INTO plan_limits VALUES
  ('free',         'Free Trial',      NULL,     1,   8,  2, 20, 7,   FALSE, FALSE, TRUE, 0),
  ('pay_per_use',  'Pay Per Use',     NULL,     NULL,12,  2, 50, 30,  FALSE, FALSE, TRUE, 1),
  ('basic',        'Basic',           149900,   5,   12, 2, 50, 30,  FALSE, FALSE, TRUE, 2),
  ('professional', 'Professional',    349900,   15,  12, 3, 50, 30,  TRUE,  FALSE, TRUE, 3),
  ('business',     'Business',        799900,   30,  12, 5, 50, 30,  TRUE,  TRUE,  TRUE, 4),
  ('enterprise',   'Enterprise',      NULL,     NULL,12, 99, 50, 30,  TRUE,  TRUE,  TRUE, 5)
ON CONFLICT (plan_tier) DO UPDATE SET
  display_name          = EXCLUDED.display_name,
  price_monthly_paise   = EXCLUDED.price_monthly_paise,
  events_per_month      = EXCLUDED.events_per_month,
  stream_duration_hrs   = EXCLUDED.stream_duration_hrs,
  destinations_included = EXCLUDED.destinations_included,
  guest_photos_per_event= EXCLUDED.guest_photos_per_event,
  vod_days              = EXCLUDED.vod_days,
  subdomain_enabled     = EXCLUDED.subdomain_enabled,
  custom_domain_enabled = EXCLUDED.custom_domain_enabled,
  sort_order            = EXCLUDED.sort_order;

-- 8. Add-ons pricing table
CREATE TABLE IF NOT EXISTS addon_pricing (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_type   TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  price_paise  INTEGER,          -- NULL allowed for custom-priced add-ons
  description  TEXT,
  is_active    BOOLEAN DEFAULT TRUE
);

INSERT INTO addon_pricing (addon_type, display_name, price_paise, description) VALUES
  ('extra_destination_single', 'Extra Destination',            4900, '₹49 per extra streaming destination per event'),
  ('extra_destination_bundle', 'Destination Bundle (up to 5)', 9900, '₹99 per event for up to 5 streaming destinations'),
  ('custom_domain',            'Custom Domain Connect',         NULL, 'Connect your own domain (price varies by plan)')
ON CONFLICT (addon_type) DO NOTHING;

-- 9. Subscription notification tracking
CREATE TABLE IF NOT EXISTS subscription_notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id         UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('expiry_7d','expiry_3d','expiry_1d','expired','fallback','wallet_low')),
  channel           TEXT NOT NULL
    CHECK (channel IN ('whatsapp','sms','email')),
  sent_at           TIMESTAMPTZ DEFAULT now()
);

-- Prevent duplicate notifications per day — use a separate UNIQUE INDEX
-- Note: sent_at::date is used instead of date_trunc() because index expressions must be IMMUTABLE
CREATE UNIQUE INDEX IF NOT EXISTS sub_notif_unique_per_day
  ON subscription_notifications (studio_id, notification_type, channel, (sent_at::date));

CREATE INDEX IF NOT EXISTS sub_notif_studio_idx
  ON subscription_notifications(studio_id, notification_type);

-- 10. Helper function: reset monthly event usage
CREATE OR REPLACE FUNCTION reset_monthly_event_usage()
RETURNS void AS $$
BEGIN
  UPDATE subscriptions
  SET events_used_this_month = 0,
      month_reset_at = date_trunc('month', now()) + interval '1 month'
  WHERE month_reset_at <= now()
    AND plan_tier IN ('basic', 'professional', 'business');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. Helper function: check if user can create event (within plan limits)
CREATE OR REPLACE FUNCTION can_create_event(p_studio_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_sub subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO v_sub FROM subscriptions WHERE studio_id = p_studio_id;

  -- No subscription record → treat as free
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'free_trial');
  END IF;

  -- Pay per use → check wallet balance
  IF v_sub.plan_tier = 'pay_per_use' THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'wallet_deduct');
  END IF;

  -- Free trial → 1 event max (check events_used)
  IF v_sub.plan_tier = 'free' THEN
    IF v_sub.events_used_this_month >= 1 THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'free_trial_exhausted');
    END IF;
    RETURN jsonb_build_object('allowed', true, 'reason', 'free_trial');
  END IF;

  -- Paid plans → check monthly limit
  IF v_sub.events_per_month IS NOT NULL AND v_sub.events_used_this_month >= v_sub.events_per_month THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'monthly_limit_reached', 'limit', v_sub.events_per_month);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', 'within_limit');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- AFTER RUNNING: Migrate existing subscriptions to new tiers
-- UPDATE subscriptions SET
--   plan_tier = CASE plan_tier
--     WHEN 'pay_per_event' THEN 'pay_per_use'
--     WHEN 'pro'           THEN 'professional'
--     ELSE plan_tier END,
--   events_per_month = CASE plan_tier
--     WHEN 'free'           THEN 1
--     WHEN 'pay_per_event'  THEN NULL
--     WHEN 'pro'            THEN 15
--     WHEN 'agency'         THEN 30
--     ELSE 5 END,
--   stream_duration_limit_hours = CASE plan_tier
--     WHEN 'free' THEN 8 ELSE 12 END,
--   grandfather_pricing = TRUE,
--   grandfather_until = now() + interval '12 months',
--   pay_per_use_price_paise = 29900;
-- ============================================================
