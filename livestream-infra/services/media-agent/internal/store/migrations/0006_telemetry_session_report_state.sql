-- Durable acknowledgment marker for Livestream Technical Telemetry + Media
-- Node Health Reporting's ended-session summary delivery. NULL means "not
-- yet durably acknowledged by the control plane"; the telemetry reporter
-- resends any such session on its next tick until the control plane's
-- response includes this session's id in AcceptedSessionIDs (see
-- internal/controlplane.TelemetryReportResponse), at which point it is
-- set once and never cleared. This reuses the existing durable
-- ingest_sessions row rather than introducing a second queue table.
ALTER TABLE ingest_sessions ADD COLUMN telemetry_reported_at TEXT NULL;
