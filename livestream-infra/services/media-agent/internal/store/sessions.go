package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Session statuses (03_DATA_MODEL_AND_API_CONTRACTS.md "stream_sessions").
const (
	SessionStarting     = "starting"
	SessionActive       = "active"
	SessionDisconnected = "disconnected"
	SessionFinalized    = "finalized"
	SessionFailed       = "failed"
)

// EndReasonStaleTimeout marks a session periodic reconciliation closed
// because no segment activity was observed within the configured
// session-stale timeout and no on_unpublish callback ever arrived
// (an ungraceful disconnect, container restart, or crashed publisher).
const EndReasonStaleTimeout = "stale_timeout"

// EndReasonUnpublish marks a session closed by a normal on_unpublish
// callback.
const EndReasonUnpublish = "unpublish"

// Session is the Media Agent's local record of one accepted publisher
// connection lifecycle (the ingest_sessions table).
type Session struct {
	ID             string
	EventID        string
	IngestID       string
	PlaybackID     string
	Status         string
	StartedAt      time.Time
	DisconnectedAt sql.NullTime
	EndReason      string
	LastActivityAt time.Time
	SegmentCount   int
}

// ErrConflictingActivePublisher is returned by CreateSession when
// another session for the same event is already starting or active.
// Callers map this to the SRS on_publish DUPLICATE_PUBLISHER rejection.
var ErrConflictingActivePublisher = errors.New("store: a session is already active for this event")

// CreateSession inserts a new active session for eventID/ingestID,
// pinning playbackID for the lifetime of this session: every segment
// uploaded under this session's id uses this exact value, never a later
// value the assignment's playback_id may take on after a subsequent
// activation. The partial unique index
// idx_ingest_sessions_one_active_per_event is the authoritative
// concurrency guard: if another goroutine committed a starting/active
// session for the same event first, this call returns
// ErrConflictingActivePublisher rather than racing an application-level
// check-then-insert. Reconnection always reaches this path with a fresh
// session id; it never reopens or mutates a prior session's identity.
func (s *Store) CreateSession(ctx context.Context, eventID, ingestID, playbackID string, now time.Time) (Session, error) {
	id, err := newID("sess")
	if err != nil {
		return Session{}, err
	}

	nowStr := now.UTC().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO ingest_sessions (id, event_id, ingest_id, playback_id, status, started_at, end_reason, last_activity_at, segment_count)
		VALUES (?, ?, ?, ?, ?, ?, '', ?, 0)`,
		id, eventID, ingestID, playbackID, SessionActive, nowStr, nowStr)
	if err != nil {
		if isUniqueConstraintErr(err) {
			return Session{}, ErrConflictingActivePublisher
		}
		return Session{}, fmt.Errorf("store: create session: %w", err)
	}

	return Session{
		ID:             id,
		EventID:        eventID,
		IngestID:       ingestID,
		PlaybackID:     playbackID,
		Status:         SessionActive,
		StartedAt:      now.UTC(),
		LastActivityAt: now.UTC(),
	}, nil
}

// GetSessionPlaybackID returns the playback_id pinned to sessionID at
// creation time, or found=false if no such session exists. Deliberately
// narrower than a full Session fetch: this is the upload worker's hot
// path for every segment, and it needs exactly this one column, not a
// full row scan/timestamp parse.
func (s *Store) GetSessionPlaybackID(ctx context.Context, sessionID string) (string, bool, error) {
	var playbackID string
	err := s.db.QueryRowContext(ctx, `SELECT playback_id FROM ingest_sessions WHERE id = ?`, sessionID).Scan(&playbackID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("store: get session %s playback_id: %w", sessionID, err)
	}
	return playbackID, true, nil
}

// FindMostRecentByIngestID returns the most recently started session
// for ingestID regardless of status, or found=false if none exists.
// on_hls and on_unpublish callbacks identify their session this way
// because the SRS callback payload carries the non-secret stream name
// (ingest_id), not an internal session id, and at most one session for
// a given ingest_id can ever be starting/active at once.
func (s *Store) FindMostRecentByIngestID(ctx context.Context, ingestID string) (Session, bool, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, event_id, ingest_id, playback_id, status, started_at, disconnected_at, end_reason, last_activity_at, segment_count
		FROM ingest_sessions WHERE ingest_id = ? ORDER BY started_at DESC LIMIT 1`, ingestID)
	sess, err := scanSession(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, false, nil
	}
	if err != nil {
		return Session{}, false, fmt.Errorf("store: find session by ingest_id %s: %w", ingestID, err)
	}
	return sess, true, nil
}

func scanSession(row *sql.Row) (Session, error) {
	var sess Session
	var startedAt string
	var disconnectedAt sql.NullString
	var lastActivityAt string
	if err := row.Scan(&sess.ID, &sess.EventID, &sess.IngestID, &sess.PlaybackID, &sess.Status, &startedAt,
		&disconnectedAt, &sess.EndReason, &lastActivityAt, &sess.SegmentCount); err != nil {
		return Session{}, err
	}
	var err error
	sess.StartedAt, err = time.Parse(time.RFC3339Nano, startedAt)
	if err != nil {
		return Session{}, fmt.Errorf("parse started_at: %w", err)
	}
	sess.LastActivityAt, err = time.Parse(time.RFC3339Nano, lastActivityAt)
	if err != nil {
		return Session{}, fmt.Errorf("parse last_activity_at: %w", err)
	}
	if disconnectedAt.Valid {
		t, err := time.Parse(time.RFC3339Nano, disconnectedAt.String)
		if err != nil {
			return Session{}, fmt.Errorf("parse disconnected_at: %w", err)
		}
		sess.DisconnectedAt = sql.NullTime{Time: t, Valid: true}
	}
	return sess, nil
}

// MarkDisconnected transitions sessionID to disconnected if (and only
// if) it is currently starting/active. It is idempotent: calling it
// again for an already-disconnected (or finalized/failed) session
// affects zero rows and returns no error, matching the SRS
// on_unpublish contract ("does not delete files, close the event"; it
// also must not error on a redundant or late callback).
func (s *Store) MarkDisconnected(ctx context.Context, sessionID, reason string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE ingest_sessions
		SET status = ?, disconnected_at = ?, end_reason = ?
		WHERE id = ? AND status IN (?, ?)`,
		SessionDisconnected, now.UTC().Format(time.RFC3339Nano), reason, sessionID, SessionStarting, SessionActive)
	if err != nil {
		return fmt.Errorf("store: mark session %s disconnected: %w", sessionID, err)
	}
	return nil
}

// TouchActivity records segment activity against sessionID: advances
// last_activity_at (used by stale-session reconciliation) and
// increments segment_count. It is a no-op (zero rows affected, no
// error) if the session no longer exists.
func (s *Store) TouchActivity(ctx context.Context, sessionID string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE ingest_sessions SET last_activity_at = ?, segment_count = segment_count + 1 WHERE id = ?`,
		now.UTC().Format(time.RFC3339Nano), sessionID)
	if err != nil {
		return fmt.Errorf("store: touch session %s activity: %w", sessionID, err)
	}
	return nil
}

// ReconcileStaleActive transitions every starting/active session whose
// last_activity_at is older than staleBefore to disconnected with
// EndReasonStaleTimeout, freeing its event for a new publisher after an
// ungraceful disconnect that never produced an on_unpublish callback.
// It returns the number of sessions transitioned.
func (s *Store) ReconcileStaleActive(ctx context.Context, staleBefore, now time.Time) (int, error) {
	res, err := s.db.ExecContext(ctx, `
		UPDATE ingest_sessions
		SET status = ?, disconnected_at = ?, end_reason = ?
		WHERE status IN (?, ?) AND last_activity_at < ?`,
		SessionDisconnected, now.UTC().Format(time.RFC3339Nano), EndReasonStaleTimeout,
		SessionStarting, SessionActive, staleBefore.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return 0, fmt.Errorf("store: reconcile stale sessions: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("store: reconcile stale sessions: rows affected: %w", err)
	}
	return int(n), nil
}

// ListSessionsByEvent returns every session ever created for eventID,
// in start order, regardless of status. VOD finalization uses this to
// confirm no session is still starting/active before it will finalize.
func (s *Store) ListSessionsByEvent(ctx context.Context, eventID string) ([]Session, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, event_id, ingest_id, playback_id, status, started_at, disconnected_at, end_reason, last_activity_at, segment_count
		FROM ingest_sessions WHERE event_id = ? ORDER BY started_at`, eventID)
	if err != nil {
		return nil, fmt.Errorf("store: list sessions for event %s: %w", eventID, err)
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
			return nil, fmt.Errorf("store: scan session: %w", err)
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
		return nil, fmt.Errorf("store: iterate sessions: %w", err)
	}
	return sessions, nil
}

// isUniqueConstraintErr reports whether err came from a violated SQLite
// UNIQUE constraint or index. SQLite's error text is stable across
// drivers (it originates from the SQLite engine itself), so a substring
// check is reliable without depending on modernc.org/sqlite-specific
// error types.
func isUniqueConstraintErr(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}
