-- Migration 0004: Add restreamer URLs to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS restreamer_url text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS restreamer_hls_url text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS restreamer_player_url text;
