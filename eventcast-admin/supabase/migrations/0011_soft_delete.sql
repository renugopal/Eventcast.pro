-- Migration 0011: Event Archival & Soft Delete
-- This migration adds the archived_at column to the events table 
-- to allow soft-deleting events (moving them to a recycle bin) instead of hard deleting.

ALTER TABLE public.events 
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;

-- We don't automatically update existing RLS policies here to avoid breaking things,
-- instead, the application logic (Next.js server actions / API) will explicitly filter out
-- archived events (where archived_at IS NULL) in queries for active views,
-- and will explicitly query where archived_at IS NOT NULL for the archive view.
