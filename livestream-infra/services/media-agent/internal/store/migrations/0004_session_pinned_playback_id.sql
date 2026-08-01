-- Pins each session's playback_id at creation time (on_publish), rather
-- than resolving it fresh per upload job from the mutable, periodically
-- re-synced cached_event_assignments row. Without this, a later
-- activation for the same event (which always mints a fresh playback_id)
-- can cause segments from one continuous RTMP session to be split across
-- two different R2 prefixes once the assignment cache resyncs mid-session.
ALTER TABLE ingest_sessions ADD COLUMN playback_id TEXT NOT NULL DEFAULT '';
