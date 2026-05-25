-- ============================================================
-- Migration 0014: Platform Roles & Mobile Authentication
-- Purpose: Introduce platform-level roles (super_admin, live_streamer, reseller)
--          and mobile number authentication support
-- Run once in Supabase SQL editor
-- ============================================================

-- 1. Create platform_users table for platform-level user profiles
CREATE TABLE IF NOT EXISTS platform_users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform_role    TEXT NOT NULL DEFAULT 'live_streamer'
                     CHECK (platform_role IN ('super_admin', 'live_streamer', 'reseller')),
  mobile_number    TEXT UNIQUE,
  mobile_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  grandfather_pricing BOOLEAN NOT NULL DEFAULT FALSE,
  grandfather_until   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- 2. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS platform_users_user_id_idx    ON platform_users(user_id);
CREATE INDEX IF NOT EXISTS platform_users_mobile_idx     ON platform_users(mobile_number);
CREATE INDEX IF NOT EXISTS platform_users_role_idx       ON platform_users(platform_role);

-- 3. Enable Row Level Security
ALTER TABLE platform_users ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own record
CREATE POLICY platform_users_self_read ON platform_users
  FOR SELECT USING (user_id = auth.uid());

-- Policy: Users can update their own record (mobile number, etc.)
CREATE POLICY platform_users_self_update ON platform_users
  FOR UPDATE USING (user_id = auth.uid());

-- Policy: Super admins can read all records
CREATE POLICY platform_users_admin_read ON platform_users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM platform_users pu
      WHERE pu.user_id = auth.uid()
        AND pu.platform_role = 'super_admin'
    )
  );

-- Policy: Super admins can update all records
CREATE POLICY platform_users_admin_update ON platform_users
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM platform_users pu
      WHERE pu.user_id = auth.uid()
        AND pu.platform_role = 'super_admin'
    )
  );

-- 4. Trigger: auto-create platform_users record when a studio_member is added
CREATE OR REPLACE FUNCTION create_platform_user_on_member()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO platform_users (user_id, platform_role)
  VALUES (NEW.user_id, 'live_streamer')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_create_platform_user ON studio_members;
CREATE TRIGGER trg_create_platform_user
  AFTER INSERT ON studio_members
  FOR EACH ROW EXECUTE FUNCTION create_platform_user_on_member();

-- 5. Backfill: create platform_users records for all existing studio_members
INSERT INTO platform_users (user_id, platform_role)
SELECT DISTINCT user_id, 'live_streamer'
FROM studio_members
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================
-- IMPORTANT: After running this migration, set the super admin:
-- UPDATE platform_users
-- SET platform_role = 'super_admin'
-- WHERE user_id = (
--   SELECT user_id FROM studio_members sm
--   JOIN studios s ON s.id = sm.studio_id
--   WHERE s.slug = 'eventcast'
--   LIMIT 1
-- );
-- ============================================================
