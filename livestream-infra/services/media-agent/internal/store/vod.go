package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// VOD finalization statuses (02_V1_ARCHITECTURE_SPEC.md "VOD finalization").
const (
	VODPending   = "pending"
	VODFinalized = "finalized"
	VODFailed    = "failed"
)

// VODFinalization is the durable record of one event's VOD finalization
// outcome.
type VODFinalization struct {
	EventID      string
	Status       string
	SegmentIDs   []int64
	SessionCount int
	R2Key        string
	LastError    string
	FinalizedAt  time.Time
	UpdatedAt    time.Time
}

// GetVODFinalization returns eventID's finalization record, or
// found=false if finalization has never been attempted.
func (s *Store) GetVODFinalization(ctx context.Context, eventID string) (VODFinalization, bool, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT event_id, status, segment_ids, session_count, r2_key, last_error, finalized_at, updated_at
		FROM vod_finalizations WHERE event_id = ?`, eventID)

	v, err := scanVODFinalization(row)
	if errors.Is(err, sql.ErrNoRows) {
		return VODFinalization{}, false, nil
	}
	if err != nil {
		return VODFinalization{}, false, fmt.Errorf("store: get vod finalization for %s: %w", eventID, err)
	}
	return v, true, nil
}

func scanVODFinalization(row *sql.Row) (VODFinalization, error) {
	var v VODFinalization
	var segmentIDsJSON, finalizedAt, updatedAt string
	if err := row.Scan(&v.EventID, &v.Status, &segmentIDsJSON, &v.SessionCount, &v.R2Key, &v.LastError,
		&finalizedAt, &updatedAt); err != nil {
		return VODFinalization{}, err
	}
	if segmentIDsJSON != "" {
		if err := json.Unmarshal([]byte(segmentIDsJSON), &v.SegmentIDs); err != nil {
			return VODFinalization{}, fmt.Errorf("parse segment_ids: %w", err)
		}
	}
	var err error
	if v.FinalizedAt, err = parseOptionalTime(finalizedAt); err != nil {
		return VODFinalization{}, fmt.Errorf("parse finalized_at: %w", err)
	}
	if v.UpdatedAt, err = parseOptionalTime(updatedAt); err != nil {
		return VODFinalization{}, fmt.Errorf("parse updated_at: %w", err)
	}
	return v, nil
}

// UpsertVODFinalized durably records that eventID's VOD playlist has
// been built, validated, and published from segmentIDs. It is
// idempotent: calling it again with the same or a different confirmed
// segment set simply overwrites the single row for that event, which is
// safe because VOD finalization itself is always recomputed fresh from
// current UploadConfirmed state (see internal/upload/vod), never
// incrementally patched.
func (s *Store) UpsertVODFinalized(ctx context.Context, eventID string, segmentIDs []int64, sessionCount int, r2Key string, now time.Time) error {
	segmentIDsJSON, err := json.Marshal(segmentIDs)
	if err != nil {
		return fmt.Errorf("store: marshal segment ids: %w", err)
	}
	nowStr := now.UTC().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO vod_finalizations (event_id, status, segment_ids, session_count, r2_key, last_error, finalized_at, updated_at)
		VALUES (?, ?, ?, ?, ?, '', ?, ?)
		ON CONFLICT(event_id) DO UPDATE SET
			status = excluded.status,
			segment_ids = excluded.segment_ids,
			session_count = excluded.session_count,
			r2_key = excluded.r2_key,
			last_error = '',
			finalized_at = excluded.finalized_at,
			updated_at = excluded.updated_at`,
		eventID, VODFinalized, string(segmentIDsJSON), sessionCount, r2Key, nowStr, nowStr)
	if err != nil {
		return fmt.Errorf("store: upsert vod finalization for %s: %w", eventID, err)
	}
	return nil
}

// ListFinalizedEventsEligibleForCleanup returns every event id whose VOD
// finalization completed at or before cutoff. The retention worker
// passes now().Add(-LocalRetentionDelay) as cutoff, so a result here
// means the configured local safety period has already elapsed
// (02_V1_ARCHITECTURE_SPEC.md "Retention and deletion").
func (s *Store) ListFinalizedEventsEligibleForCleanup(ctx context.Context, cutoff time.Time) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT event_id FROM vod_finalizations
		WHERE status = ? AND finalized_at <> '' AND finalized_at <= ?`,
		VODFinalized, cutoff.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return nil, fmt.Errorf("store: list finalized events eligible for cleanup: %w", err)
	}
	defer rows.Close()

	var eventIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("store: scan event id: %w", err)
		}
		eventIDs = append(eventIDs, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: iterate finalized events: %w", err)
	}
	return eventIDs, nil
}

// UpsertVODFailed records a non-fatal finalization attempt failure
// (e.g. the R2 object store was unreachable during publish or
// validation). It leaves the event eligible for another finalization
// attempt; it is not a dead-letter state.
func (s *Store) UpsertVODFailed(ctx context.Context, eventID, lastError string, now time.Time) error {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO vod_finalizations (event_id, status, segment_ids, session_count, r2_key, last_error, finalized_at, updated_at)
		VALUES (?, ?, '', 0, '', ?, '', ?)
		ON CONFLICT(event_id) DO UPDATE SET
			status = excluded.status,
			last_error = excluded.last_error,
			updated_at = excluded.updated_at`,
		eventID, VODFailed, lastError, nowStr)
	if err != nil {
		return fmt.Errorf("store: upsert vod failure for %s: %w", eventID, err)
	}
	return nil
}
