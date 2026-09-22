package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Livestream Technical Telemetry + Media Node Health Reporting (see the
// project's read-only audit and Step 0 SRS evidence). Every query here is
// read-only against already-durable state (ingest_sessions, segment_jobs)
// - no new SQLite table is introduced by this package. Telemetry is
// derived, never a second authoritative copy of session/segment state.

// ListActiveSessions returns every session currently "starting" or
// "active", i.e. every event this node believes it is currently
// publishing. The telemetry reporter samples the SRS API and reports one
// entry per row this returns.
func (s *Store) ListActiveSessions(ctx context.Context) ([]Session, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, event_id, ingest_id, playback_id, status, started_at, disconnected_at, end_reason, last_activity_at, segment_count
		FROM ingest_sessions WHERE status IN (?, ?) ORDER BY started_at`, SessionStarting, SessionActive)
	if err != nil {
		return nil, fmt.Errorf("store: list active sessions: %w", err)
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var sess Session
		var startedAt string
		var disconnectedAt sql.NullString
		var lastActivityAt string
		if err := rows.Scan(&sess.ID, &sess.EventID, &sess.IngestID, &sess.PlaybackID, &sess.Status, &startedAt,
			&disconnectedAt, &sess.EndReason, &lastActivityAt, &sess.SegmentCount); err != nil {
			return nil, fmt.Errorf("store: scan active session: %w", err)
		}
		sess.StartedAt, err = time.Parse(time.RFC3339Nano, startedAt)
		if err != nil {
			return nil, fmt.Errorf("store: parse started_at: %w", err)
		}
		sess.LastActivityAt, err = time.Parse(time.RFC3339Nano, lastActivityAt)
		if err != nil {
			return nil, fmt.Errorf("store: parse last_activity_at: %w", err)
		}
		if disconnectedAt.Valid {
			t, err := time.Parse(time.RFC3339Nano, disconnectedAt.String)
			if err != nil {
				return nil, fmt.Errorf("store: parse disconnected_at: %w", err)
			}
			sess.DisconnectedAt = sql.NullTime{Time: t, Valid: true}
		}
		sessions = append(sessions, sess)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: iterate active sessions: %w", err)
	}
	return sessions, nil
}

// ListUnreportedEndedSessions returns up to limit sessions that
// transitioned out of starting/active (disconnected, finalized, or
// failed) whose telemetry_reported_at (local SQLite migration 0006) is
// still NULL - i.e. every session summary not yet durably acknowledged
// by the control plane - ordered deterministically by disconnected_at so
// a bounded batch always drains the oldest backlog first.
//
// This is retry-until-acknowledged, not a time-window heuristic: a
// session stays eligible here across any number of failed report ticks
// and across an agent restart, because the marker lives in the same
// durable SQLite row the session itself does. It leaves this query set
// only when the caller calls MarkSessionTelemetryReported for it, which
// must happen only once the control plane's response has actually
// included that session's id in AcceptedSessionIDs - never merely
// because a report attempt was made.
//
// limit must be a positive, real bound: SQLite treats a negative LIMIT
// as "no limit at all", so passing one through unchecked would silently
// defeat the whole point of bounding this query. limit <= 0 is rejected
// with a clear error rather than ever reaching SQLite as an accidental
// unbounded query.
func (s *Store) ListUnreportedEndedSessions(ctx context.Context, limit int) ([]Session, error) {
	if limit <= 0 {
		return nil, fmt.Errorf("store: list unreported ended sessions: limit must be positive, got %d", limit)
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT id, event_id, ingest_id, playback_id, status, started_at, disconnected_at, end_reason, last_activity_at, segment_count
		FROM ingest_sessions
		WHERE status IN (?, ?, ?) AND disconnected_at IS NOT NULL AND telemetry_reported_at IS NULL
		ORDER BY disconnected_at ASC
		LIMIT ?`,
		SessionDisconnected, SessionFinalized, SessionFailed, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list unreported ended sessions: %w", err)
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var sess Session
		var startedAt string
		var disconnectedAt sql.NullString
		var lastActivityAt string
		if err := rows.Scan(&sess.ID, &sess.EventID, &sess.IngestID, &sess.PlaybackID, &sess.Status, &startedAt,
			&disconnectedAt, &sess.EndReason, &lastActivityAt, &sess.SegmentCount); err != nil {
			return nil, fmt.Errorf("store: scan unreported ended session: %w", err)
		}
		sess.StartedAt, err = time.Parse(time.RFC3339Nano, startedAt)
		if err != nil {
			return nil, fmt.Errorf("store: parse started_at: %w", err)
		}
		sess.LastActivityAt, err = time.Parse(time.RFC3339Nano, lastActivityAt)
		if err != nil {
			return nil, fmt.Errorf("store: parse last_activity_at: %w", err)
		}
		if disconnectedAt.Valid {
			t, err := time.Parse(time.RFC3339Nano, disconnectedAt.String)
			if err != nil {
				return nil, fmt.Errorf("store: parse disconnected_at: %w", err)
			}
			sess.DisconnectedAt = sql.NullTime{Time: t, Valid: true}
		}
		sessions = append(sessions, sess)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: iterate unreported ended sessions: %w", err)
	}
	return sessions, nil
}

// MarkSessionTelemetryReported durably marks sessionID's summary as
// acknowledged by the control plane (telemetry_reported_at = now), so
// ListUnreportedEndedSessions never returns it again. Callers MUST call
// this only for a session id the control plane's response actually
// listed in AcceptedSessionIDs - never merely because a report attempt
// was made, and never for every session id in a request whose delivery
// is unknown (network failure, timeout, or malformed response). It is
// idempotent: calling it again for an already-marked session is a
// harmless no-op (the WHERE clause matches zero rows).
func (s *Store) MarkSessionTelemetryReported(ctx context.Context, sessionID string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE ingest_sessions SET telemetry_reported_at = ?
		WHERE id = ? AND telemetry_reported_at IS NULL`,
		now.UTC().Format(time.RFC3339Nano), sessionID)
	if err != nil {
		return fmt.Errorf("store: mark session %s telemetry reported: %w", sessionID, err)
	}
	return nil
}

// SessionCountForEvent returns the total number of sessions ever created
// for eventID (every status), the basis for the reconnect count a
// currently-active session reports: reconnectCount = max(0, count-1).
func (s *Store) SessionCountForEvent(ctx context.Context, eventID string) (int, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM ingest_sessions WHERE event_id = ?`, eventID).Scan(&count); err != nil {
		return 0, fmt.Errorf("store: session count for event %s: %w", eventID, err)
	}
	return count, nil
}

// SessionCapturedBytes sums byte_size for every segment_jobs row captured
// under sessionID (status queued/missing/failed all mean the durable
// capture itself completed - see internal/spool.Capture - so this counts
// bytes the Media Agent has actually protected, never bytes still only
// "capturing"). This is the basis for the derived "delivered" bitrate
// figure the telemetry aggregator reports - explicitly distinct from and
// never a substitute for the SRS-reported ingest kbps figure.
func (s *Store) SessionCapturedBytes(ctx context.Context, sessionID string) (int64, error) {
	var sum sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		SELECT SUM(byte_size) FROM segment_jobs
		WHERE session_id = ? AND status IN (?, ?, ?)`,
		sessionID, SegmentQueued, SegmentMissing, SegmentFailed).Scan(&sum)
	if err != nil {
		return 0, fmt.Errorf("store: session captured bytes for %s: %w", sessionID, err)
	}
	if !sum.Valid {
		return 0, nil
	}
	return sum.Int64, nil
}

// PendingUploadBacklogBytes sums byte_size for every segment_jobs row not
// yet R2-confirmed (upload_status pending or leased) - the node
// heartbeat's r2_queue_bytes evidence (media_nodes, migration 0020).
// Returns 0, nil when the R2 subsystem is disabled or nothing is
// outstanding (both indistinguishable from "no backlog" here, which is
// correct: neither implies a problem).
func (s *Store) PendingUploadBacklogBytes(ctx context.Context) (int64, error) {
	var sum sql.NullInt64
	err := s.db.QueryRowContext(ctx, `
		SELECT SUM(byte_size) FROM segment_jobs
		WHERE upload_status IN (?, ?)`, UploadPending, UploadLeased).Scan(&sum)
	if err != nil {
		return 0, fmt.Errorf("store: pending upload backlog bytes: %w", err)
	}
	if !sum.Valid {
		return 0, nil
	}
	return sum.Int64, nil
}
