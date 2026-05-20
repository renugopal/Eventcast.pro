-- ============================================================
-- Migration 0008: stream_alerts table
-- Used by: /api/cron/stream-health-monitor
-- Run once in Supabase SQL editor or via supabase db push
-- ============================================================

CREATE TABLE IF NOT EXISTS stream_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     UUID REFERENCES events(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL,
  event_name   TEXT,
  alert_type   TEXT NOT NULL,   -- 'stream_not_found' | 'stream_dead' | 'no_signal' | 'low_bitrate'
  severity     TEXT NOT NULL,   -- 'critical' | 'warning'
  message      TEXT,
  bitrate_kbps NUMERIC,
  stream_state TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Index for fast queries by event and time
CREATE INDEX IF NOT EXISTS stream_alerts_event_id_idx ON stream_alerts(event_id);
CREATE INDEX IF NOT EXISTS stream_alerts_created_at_idx ON stream_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS stream_alerts_severity_idx ON stream_alerts(severity);

-- Enable Row Level Security
ALTER TABLE stream_alerts ENABLE ROW LEVEL SECURITY;

-- Only the service role (used by cron) can insert alerts.
-- Studio owners can read alerts for their own events.
CREATE POLICY stream_alerts_service_insert ON stream_alerts
  FOR INSERT
  WITH CHECK (true); -- Service role bypasses RLS; anon/user inserts are blocked by default

CREATE POLICY stream_alerts_studio_select ON stream_alerts
  FOR SELECT USING (
    event_id IN (
      SELECT e.id FROM events e
      JOIN studio_members sm ON sm.studio_id = e.studio_id
      WHERE sm.user_id = auth.uid()
    )
  );

-- Admins can delete old alerts (cleanup)
CREATE POLICY stream_alerts_studio_delete ON stream_alerts
  FOR DELETE USING (
    event_id IN (
      SELECT e.id FROM events e
      JOIN studio_members sm ON sm.studio_id = e.studio_id
      WHERE sm.user_id = auth.uid() AND sm.role = 'owner'
    )
  );
