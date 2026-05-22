-- ============================================================
-- Migration 0013: guest_photos table
-- Used by: Guest Photo Wall feature
-- Photos go live immediately (approved = true by default).
-- Studio owners can delete via admin moderation panel.
-- Run once in Supabase SQL editor or via supabase db push
-- ============================================================

CREATE TABLE IF NOT EXISTS guest_photos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  photo_url        TEXT NOT NULL,          -- Cloudflare R2 public URL
  r2_key           TEXT NOT NULL,          -- R2 object key (for deletion)
  file_size_bytes  INTEGER,                -- For storage analytics widget
  uploader_name    TEXT NOT NULL,          -- Guest name (required)
  approved         BOOLEAN NOT NULL DEFAULT TRUE,  -- Photos go live immediately
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast per-event queries and analytics
CREATE INDEX IF NOT EXISTS guest_photos_event_id_idx   ON guest_photos(event_id);
CREATE INDEX IF NOT EXISTS guest_photos_created_at_idx ON guest_photos(created_at DESC);
CREATE INDEX IF NOT EXISTS guest_photos_approved_idx   ON guest_photos(event_id, approved);

-- Enable Row Level Security
ALTER TABLE guest_photos ENABLE ROW LEVEL SECURITY;

-- ── Policy 1: Public INSERT ───────────────────────────────────────────────────
-- Guests upload without logging in. Rate limiting is enforced at API layer.
CREATE POLICY guest_photos_public_insert ON guest_photos
  FOR INSERT
  WITH CHECK (true);

-- ── Policy 2: Public SELECT (approved photos only) ───────────────────────────
-- Landing page reads only approved=true photos for display.
CREATE POLICY guest_photos_public_select ON guest_photos
  FOR SELECT
  USING (approved = true);

-- ── Policy 3: Studio owner full control ──────────────────────────────────────
-- Studio owners/members can read ALL photos (including unapproved) and delete.
-- This powers the admin moderation panel.
CREATE POLICY guest_photos_studio_manage ON guest_photos
  FOR ALL
  USING (
    event_id IN (
      SELECT e.id FROM events e
      JOIN studio_members sm ON sm.studio_id = e.studio_id
      WHERE sm.user_id = auth.uid()
    )
  );

-- ── Add guest_photo_limit column to events table ──────────────────────────────
-- Stores the plan-tier-based photo limit at the time the event was created.
-- free_trial = 20, all other plans = 50
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS guest_photo_limit INTEGER NOT NULL DEFAULT 50;

-- Enable Supabase Realtime for live photo wall updates
-- Run this in the Supabase dashboard: Table Editor → guest_photos → Enable Realtime
-- (Cannot be done via SQL migration in all Supabase configurations)

ALTER TABLE events ADD COLUMN IF NOT EXISTS guest_photo_wall_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS guest_photo_moderation BOOLEAN DEFAULT FALSE;
