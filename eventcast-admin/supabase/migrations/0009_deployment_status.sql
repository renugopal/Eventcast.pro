-- ============================================================
-- Migration 0009: deployment_status column on events table
-- Used by: /api/events/generate to track real-time deploy steps
-- Run once in Supabase SQL editor
-- ============================================================

-- Add deployment_status column (nullable: null = legacy/unknown)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS deployment_status TEXT
    CHECK (deployment_status IN ('deploying', 'live', 'failed'))
    DEFAULT NULL;

-- Add deployment_error for debugging failed deployments
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS deployment_error TEXT DEFAULT NULL;

-- Add deployed_at timestamp for ordering/auditing
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS deployed_at TIMESTAMPTZ DEFAULT NULL;

-- Index for fast filtering in EventTable (status badge query)
CREATE INDEX IF NOT EXISTS idx_events_deployment_status
  ON events (deployment_status)
  WHERE deployment_status IS NOT NULL;

-- Enable realtime for deployment_status updates
-- (Run this if realtime is not already enabled on events)
-- ALTER PUBLICATION supabase_realtime ADD TABLE events;

COMMENT ON COLUMN events.deployment_status IS
  'Tracks live deployment state: deploying (in progress), live (success), failed (error)';
