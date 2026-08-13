package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// B2 archive states (migrations/0004_b2_archival.sql).
const (
	B2ArchivePending   = "pending"
	B2ArchiveArchiving = "archiving"
	B2ArchiveArchived  = "archived"
	B2ArchiveFailed    = "failed"
)

// B2Archive is the durable per-event record of authoritative B2 archival
// work and its control-plane report state. It is the newest generation
// that must be archived - not a history table.
type B2Archive struct {
	EventID            string
	Generation         string
	State              string
	Bucket             string
	PlaylistKey        string
	ObjectCount        int
	CoveredPlaybackIDs []string
	GapCount           int
	GapStatus          string
	StrongVerified     bool
	LocalFinalizedAt   time.Time
	ArchivedAt         time.Time
	ArchiveAttempts    int
	NextAttemptAt      time.Time
	LastError          string

	ReportedGeneration string
	ReportedState      string
	ReportedAt         time.Time
	ReportAttempts     int
	NextReportAt       time.Time
	ReportLastError    string
}

const b2ArchiveColumns = `
	event_id, generation, state, bucket, playlist_key, object_count, covered_playback_ids,
	gap_count, gap_status, strong_verified, local_finalized_at, archived_at,
	archive_attempts, next_attempt_at, last_error,
	reported_generation, reported_state, reported_at, report_attempts, next_report_at, report_last_error`

type b2RowScanner interface {
	Scan(dest ...any) error
}

// boolToInt renders a Go bool as the 0/1 SQLite stores, so a query
// parameter can be compared directly in SQL.
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func scanB2Archive(row b2RowScanner) (B2Archive, error) {
	var a B2Archive
	var coveredJSON, localFinalizedAt, archivedAt, nextAttemptAt, reportedAt, nextReportAt string
	var strongVerified int
	if err := row.Scan(
		&a.EventID, &a.Generation, &a.State, &a.Bucket, &a.PlaylistKey, &a.ObjectCount, &coveredJSON,
		&a.GapCount, &a.GapStatus, &strongVerified, &localFinalizedAt, &archivedAt,
		&a.ArchiveAttempts, &nextAttemptAt, &a.LastError,
		&a.ReportedGeneration, &a.ReportedState, &reportedAt, &a.ReportAttempts, &nextReportAt, &a.ReportLastError,
	); err != nil {
		return B2Archive{}, err
	}
	a.StrongVerified = strongVerified == 1
	if coveredJSON != "" {
		if err := json.Unmarshal([]byte(coveredJSON), &a.CoveredPlaybackIDs); err != nil {
			return B2Archive{}, fmt.Errorf("parse covered_playback_ids: %w", err)
		}
	}
	var err error
	if a.LocalFinalizedAt, err = parseOptionalTime(localFinalizedAt); err != nil {
		return B2Archive{}, fmt.Errorf("parse local_finalized_at: %w", err)
	}
	if a.ArchivedAt, err = parseOptionalTime(archivedAt); err != nil {
		return B2Archive{}, fmt.Errorf("parse archived_at: %w", err)
	}
	if a.NextAttemptAt, err = parseOptionalTime(nextAttemptAt); err != nil {
		return B2Archive{}, fmt.Errorf("parse next_attempt_at: %w", err)
	}
	if a.ReportedAt, err = parseOptionalTime(reportedAt); err != nil {
		return B2Archive{}, fmt.Errorf("parse reported_at: %w", err)
	}
	if a.NextReportAt, err = parseOptionalTime(nextReportAt); err != nil {
		return B2Archive{}, fmt.Errorf("parse next_report_at: %w", err)
	}
	return a, nil
}

// GetB2Archive returns eventID's archive row, or found=false if archival
// has never been enqueued for it.
func (s *Store) GetB2Archive(ctx context.Context, eventID string) (B2Archive, bool, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+b2ArchiveColumns+` FROM b2_archives WHERE event_id = ?`, eventID)
	a, err := scanB2Archive(row)
	if errors.Is(err, sql.ErrNoRows) {
		return B2Archive{}, false, nil
	}
	if err != nil {
		return B2Archive{}, false, fmt.Errorf("store: get b2 archive for %s: %w", eventID, err)
	}
	return a, true, nil
}

// EnqueueB2ArchiveInput describes one generation that must be archived.
type EnqueueB2ArchiveInput struct {
	EventID            string
	Generation         string
	CoveredPlaybackIDs []string
	GapCount           int
	GapStatus          string
	LocalFinalizedAt   time.Time
}

// EnqueueB2Archive records that in.Generation is the generation that must
// be archived for in.EventID, and returns the resulting row.
//
// It is idempotent and convergent, which is what makes repeated operator
// finalize calls safe: enqueuing the generation a row already carries
// leaves that row completely untouched (so a completed archive is never
// reset back to pending, and no competing job is created), while enqueuing
// a NEWER generation converges the single row forward - resetting archival
// and report progress, because evidence recorded for a superseded segment
// set must never be reported as describing the current one.
func (s *Store) EnqueueB2Archive(ctx context.Context, in EnqueueB2ArchiveInput, now time.Time) (B2Archive, error) {
	covered, err := json.Marshal(in.CoveredPlaybackIDs)
	if err != nil {
		return B2Archive{}, fmt.Errorf("store: marshal covered playback ids: %w", err)
	}
	nowStr := now.UTC().Format(time.RFC3339Nano)
	localFinalizedAt := ""
	if !in.LocalFinalizedAt.IsZero() {
		localFinalizedAt = in.LocalFinalizedAt.UTC().Format(time.RFC3339Nano)
	}
	gapStatus := in.GapStatus
	if gapStatus == "" {
		gapStatus = VODGapNone
	}

	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO b2_archives (
			event_id, generation, state, covered_playback_ids, gap_count, gap_status,
			local_finalized_at, created_at, updated_at
		)
		VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)
		ON CONFLICT(event_id) DO UPDATE SET
			generation           = excluded.generation,
			state                = 'pending',
			bucket               = '',
			playlist_key         = '',
			object_count         = 0,
			covered_playback_ids = excluded.covered_playback_ids,
			gap_count            = excluded.gap_count,
			gap_status           = excluded.gap_status,
			strong_verified      = 0,
			local_finalized_at   = excluded.local_finalized_at,
			archived_at          = '',
			archive_attempts     = 0,
			next_attempt_at      = '',
			last_error           = '',
			reported_generation  = '',
			reported_state       = '',
			reported_at          = '',
			report_attempts      = 0,
			next_report_at       = '',
			report_last_error    = '',
			updated_at           = excluded.updated_at
		WHERE b2_archives.generation <> excluded.generation`,
		in.EventID, in.Generation, string(covered), in.GapCount, gapStatus, localFinalizedAt, nowStr, nowStr,
	); err != nil {
		return B2Archive{}, fmt.Errorf("store: enqueue b2 archive for %s: %w", in.EventID, err)
	}

	a, _, err := s.GetB2Archive(ctx, in.EventID)
	return a, err
}

// ClaimB2ArchiveWork atomically claims the next event whose current
// generation still needs archiving, marking it 'archiving' and pushing
// next_attempt_at out by leaseDuration.
//
// That lease is what makes the claim exclusive: a concurrently running
// worker (or this process after a restart) will not see the row again
// until the lease expires, so the same generation is never archived twice
// in parallel. A row left in 'archiving' by a crashed process is still
// recovered once the lease elapses, and because archival is idempotent,
// redoing an interrupted pass is safe.
func (s *Store) ClaimB2ArchiveWork(ctx context.Context, now time.Time, leaseDuration time.Duration) (B2Archive, bool, error) {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	leaseUntil := now.UTC().Add(leaseDuration).Format(time.RFC3339Nano)
	row := s.db.QueryRowContext(ctx, `
		UPDATE b2_archives
		SET state = 'archiving', next_attempt_at = ?, updated_at = ?
		WHERE event_id = (
			SELECT event_id FROM b2_archives
			WHERE state IN ('pending', 'failed', 'archiving')
			  AND (next_attempt_at = '' OR next_attempt_at <= ?)
			ORDER BY updated_at
			LIMIT 1
		)
		RETURNING `+b2ArchiveColumns, leaseUntil, nowStr, nowStr)

	a, err := scanB2Archive(row)
	if errors.Is(err, sql.ErrNoRows) {
		return B2Archive{}, false, nil
	}
	if err != nil {
		return B2Archive{}, false, fmt.Errorf("store: claim b2 archive work: %w", err)
	}
	return a, true, nil
}

// MarkB2Archived records that generation's complete object set and
// playlist are present in B2 and passed post-PUT verification.
//
// The generation guard is the stale-archive protection: if the row has
// already converged to a newer generation while this pass was running, the
// UPDATE matches nothing and the completed work is correctly discarded as
// describing a superseded segment set.
//
// It deliberately does not set strong_verified. Presence and metadata
// consistency are not byte-level integrity proof.
func (s *Store) MarkB2Archived(ctx context.Context, eventID, generation, bucket, playlistKey string, objectCount int, now time.Time) (bool, error) {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	res, err := s.db.ExecContext(ctx, `
		UPDATE b2_archives
		SET state = 'archived', bucket = ?, playlist_key = ?, object_count = ?,
		    archived_at = ?, last_error = '', next_attempt_at = '',
		    next_report_at = '', updated_at = ?
		WHERE event_id = ? AND generation = ?`,
		bucket, playlistKey, objectCount, nowStr, nowStr, eventID, generation)
	if err != nil {
		return false, fmt.Errorf("store: mark b2 archived for %s: %w", eventID, err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("store: mark b2 archived rows affected for %s: %w", eventID, err)
	}
	return affected > 0, nil
}

// MarkB2ArchiveFailed records a failed archival pass and schedules the
// next attempt. Same generation guard as MarkB2Archived.
func (s *Store) MarkB2ArchiveFailed(ctx context.Context, eventID, generation, lastError string, nextAttemptAt, now time.Time) error {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	if _, err := s.db.ExecContext(ctx, `
		UPDATE b2_archives
		SET state = 'failed', archive_attempts = archive_attempts + 1,
		    last_error = ?, next_attempt_at = ?, next_report_at = '', updated_at = ?
		WHERE event_id = ? AND generation = ?`,
		lastError, nextAttemptAt.UTC().Format(time.RFC3339Nano), nowStr, eventID, generation); err != nil {
		return fmt.Errorf("store: mark b2 archive failed for %s: %w", eventID, err)
	}
	return nil
}

// ListB2ReportsDue returns archives whose current generation/state has not
// yet been acknowledged by the control plane and whose retry time has
// elapsed.
func (s *Store) ListB2ReportsDue(ctx context.Context, now time.Time, limit int) ([]B2Archive, error) {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+b2ArchiveColumns+` FROM b2_archives
		WHERE (next_report_at = '' OR next_report_at <= ?)
		  AND (reported_generation <> generation OR reported_state <> state)
		ORDER BY updated_at
		LIMIT ?`, nowStr, limit)
	if err != nil {
		return nil, fmt.Errorf("store: list b2 reports due: %w", err)
	}
	defer rows.Close()

	var out []B2Archive
	for rows.Next() {
		a, err := scanB2Archive(rows)
		if err != nil {
			return nil, fmt.Errorf("store: scan b2 archive: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: iterate b2 reports due: %w", err)
	}
	return out, nil
}

// MarkB2Reported records a control-plane acknowledgement for a specific
// generation and state. Guarded by generation so an acknowledgement that
// arrives after the row converged forward cannot be mistaken for
// acknowledgement of the newer generation.
func (s *Store) MarkB2Reported(ctx context.Context, eventID, generation, state string, now time.Time) error {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	if _, err := s.db.ExecContext(ctx, `
		UPDATE b2_archives
		SET reported_generation = ?, reported_state = ?, reported_at = ?,
		    report_attempts = 0, next_report_at = '', report_last_error = '', updated_at = ?
		WHERE event_id = ? AND generation = ?`,
		generation, state, nowStr, nowStr, eventID, generation); err != nil {
		return fmt.Errorf("store: mark b2 reported for %s: %w", eventID, err)
	}
	return nil
}

// MarkB2ReportFailed records a failed report attempt and schedules the
// next one. The local archive state is never altered by a report failure:
// a control-plane outage must not corrupt this node's own evidence.
func (s *Store) MarkB2ReportFailed(ctx context.Context, eventID, lastError string, nextReportAt, now time.Time) error {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	if _, err := s.db.ExecContext(ctx, `
		UPDATE b2_archives
		SET report_attempts = report_attempts + 1, report_last_error = ?,
		    next_report_at = ?, updated_at = ?
		WHERE event_id = ?`,
		lastError, nextReportAt.UTC().Format(time.RFC3339Nano), nowStr, eventID); err != nil {
		return fmt.Errorf("store: mark b2 report failed for %s: %w", eventID, err)
	}
	return nil
}
