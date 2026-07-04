package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// YouTube relay statuses (02_V1_ARCHITECTURE_SPEC.md "YouTube relay",
// ADR-012).
const (
	RelayStarting = "starting"
	RelayRunning  = "running"
	RelayStopped  = "stopped"
	RelayFailed   = "failed"
)

// RelayRecord is the durable record of one ingest session's YouTube
// relay lifecycle. It is bookkeeping/observability state only: the
// relay's supervising goroutine and ffmpeg subprocess are always
// in-memory and never survive a Media Agent restart, so
// ReconcileStaleRelays marks every "starting"/"running" row "stopped"
// at startup regardless of what this table says.
type RelayRecord struct {
	ID           int64
	EventID      string
	SessionID    string
	Status       string
	RestartCount int
	LastError    string
	StartedAt    time.Time
	StoppedAt    time.Time
	UpdatedAt    time.Time
}

// UpsertRelayStarting creates (or resets, on session reuse - which
// should not normally happen since session ids are unique per
// reconnect, but is handled idempotently regardless) a relay record in
// the "starting" state for a new session.
func (s *Store) UpsertRelayStarting(ctx context.Context, eventID, sessionID string, now time.Time) error {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO youtube_relays (event_id, session_id, status, restart_count, last_error, started_at, stopped_at, updated_at)
		VALUES (?, ?, ?, 0, '', ?, '', ?)
		ON CONFLICT(session_id) DO UPDATE SET
			status = excluded.status, started_at = excluded.started_at, stopped_at = '', updated_at = excluded.updated_at`,
		eventID, sessionID, RelayStarting, nowStr, nowStr)
	if err != nil {
		return fmt.Errorf("store: upsert relay starting for session %s: %w", sessionID, err)
	}
	return nil
}

// MarkRelayRunning transitions sessionID's relay to "running": ffmpeg
// has started successfully and is actively copying media.
func (s *Store) MarkRelayRunning(ctx context.Context, sessionID string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE youtube_relays SET status = ?, last_error = '', updated_at = ? WHERE session_id = ?`,
		RelayRunning, now.UTC().Format(time.RFC3339Nano), sessionID)
	if err != nil {
		return fmt.Errorf("store: mark relay running for session %s: %w", sessionID, err)
	}
	return nil
}

// MarkRelayStopped transitions sessionID's relay to "stopped" - a clean
// shutdown (session ended, or the supervisor was told to stop), not a
// failure.
func (s *Store) MarkRelayStopped(ctx context.Context, sessionID string, now time.Time) error {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `
		UPDATE youtube_relays SET status = ?, stopped_at = ?, updated_at = ? WHERE session_id = ?`,
		RelayStopped, nowStr, nowStr, sessionID)
	if err != nil {
		return fmt.Errorf("store: mark relay stopped for session %s: %w", sessionID, err)
	}
	return nil
}

// MarkRelayFailed transitions sessionID's relay to its terminal
// "failed" state: the bounded restart budget was exhausted. Per
// ADR-012, this only ever updates this session's own relay row; it must
// never be reachable from any codepath that touches segment_jobs,
// ingest_sessions, or manifest state, keeping a YouTube failure fully
// isolated from primary EventCast delivery.
func (s *Store) MarkRelayFailed(ctx context.Context, sessionID, lastError string, now time.Time) error {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `
		UPDATE youtube_relays SET status = ?, last_error = ?, stopped_at = ?, updated_at = ? WHERE session_id = ?`,
		RelayFailed, lastError, nowStr, nowStr, sessionID)
	if err != nil {
		return fmt.Errorf("store: mark relay failed for session %s: %w", sessionID, err)
	}
	return nil
}

// IncrementRelayRestart records one restart attempt (ffmpeg exited
// unexpectedly and the supervisor is about to relaunch it after a
// backoff delay).
func (s *Store) IncrementRelayRestart(ctx context.Context, sessionID, lastError string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE youtube_relays SET restart_count = restart_count + 1, last_error = ?, updated_at = ? WHERE session_id = ?`,
		lastError, now.UTC().Format(time.RFC3339Nano), sessionID)
	if err != nil {
		return fmt.Errorf("store: increment relay restart for session %s: %w", sessionID, err)
	}
	return nil
}

// GetRelayBySessionID returns sessionID's relay record, or
// found=false if this session never had relay enabled.
func (s *Store) GetRelayBySessionID(ctx context.Context, sessionID string) (RelayRecord, bool, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, event_id, session_id, status, restart_count, last_error, started_at, stopped_at, updated_at
		FROM youtube_relays WHERE session_id = ?`, sessionID)
	r, err := scanRelayRecord(row)
	if errors.Is(err, sql.ErrNoRows) {
		return RelayRecord{}, false, nil
	}
	if err != nil {
		return RelayRecord{}, false, fmt.Errorf("store: get relay for session %s: %w", sessionID, err)
	}
	return r, true, nil
}

func scanRelayRecord(row *sql.Row) (RelayRecord, error) {
	var r RelayRecord
	var startedAt, stoppedAt, updatedAt string
	if err := row.Scan(&r.ID, &r.EventID, &r.SessionID, &r.Status, &r.RestartCount, &r.LastError,
		&startedAt, &stoppedAt, &updatedAt); err != nil {
		return RelayRecord{}, err
	}
	var err error
	if r.StartedAt, err = parseOptionalTime(startedAt); err != nil {
		return RelayRecord{}, fmt.Errorf("parse started_at: %w", err)
	}
	if r.StoppedAt, err = parseOptionalTime(stoppedAt); err != nil {
		return RelayRecord{}, fmt.Errorf("parse stopped_at: %w", err)
	}
	if r.UpdatedAt, err = parseOptionalTime(updatedAt); err != nil {
		return RelayRecord{}, fmt.Errorf("parse updated_at: %w", err)
	}
	return r, nil
}

// ReconcileStaleRelays transitions every "starting"/"running" relay row
// to "stopped" with a distinguishing last_error. It must run once at
// startup, before any new relay is supervised: the ffmpeg subprocess
// and supervising goroutine a "running" row refers to cannot possibly
// have survived a Media Agent process restart, so any such row found at
// startup is stale bookkeeping from before the crash, not a live
// process this instance could reattach to.
func (s *Store) ReconcileStaleRelays(ctx context.Context, now time.Time) (int, error) {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	res, err := s.db.ExecContext(ctx, `
		UPDATE youtube_relays SET status = ?, last_error = 'stopped: media agent restarted', stopped_at = ?, updated_at = ?
		WHERE status IN (?, ?)`,
		RelayStopped, nowStr, nowStr, RelayStarting, RelayRunning)
	if err != nil {
		return 0, fmt.Errorf("store: reconcile stale relays: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("store: reconcile stale relays: rows affected: %w", err)
	}
	return int(n), nil
}
