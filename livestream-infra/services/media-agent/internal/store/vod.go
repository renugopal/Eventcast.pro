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

// VOD gap statuses (migrations/0003_production_readiness.sql). A gap is
// "documented" per 02_V1_ARCHITECTURE_SPEC.md the moment finalization
// observes one or more permanently unresolvable segments; it starts
// pending_review and is terminal once an operator acknowledges or
// rejects it via the vod-gap resolution endpoint
// (internal/upload.VODGapHandler).
const (
	VODGapNone          = "none"
	VODGapPendingReview = "pending_review"
	VODGapAcknowledged  = "acknowledged"
	VODGapRejected      = "rejected"
)

// VOD gap resolution actions, matching vod_gap_audit.action's CHECK
// constraint.
const (
	VODGapActionAcknowledge = "acknowledge"
	VODGapActionReject      = "reject"
)

// VODFinalization is the durable record of one event's VOD finalization
// outcome, including its independent gap-resolution state.
type VODFinalization struct {
	EventID      string
	Status       string
	SegmentIDs   []int64
	SessionCount int
	R2Key        string
	LastError    string
	FinalizedAt  time.Time
	UpdatedAt    time.Time

	GapCount            int
	GapStatus           string
	GapResolutionActor  string
	GapResolutionReason string
	GapResolvedAt       time.Time
}

// GetVODFinalization returns eventID's finalization record, or
// found=false if finalization has never been attempted.
func (s *Store) GetVODFinalization(ctx context.Context, eventID string) (VODFinalization, bool, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT event_id, status, segment_ids, session_count, r2_key, last_error, finalized_at, updated_at,
		       gap_count, gap_status, gap_resolution_actor, gap_resolution_reason, gap_resolved_at
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
	var segmentIDsJSON, finalizedAt, updatedAt, gapResolvedAt string
	if err := row.Scan(&v.EventID, &v.Status, &segmentIDsJSON, &v.SessionCount, &v.R2Key, &v.LastError,
		&finalizedAt, &updatedAt,
		&v.GapCount, &v.GapStatus, &v.GapResolutionActor, &v.GapResolutionReason, &gapResolvedAt); err != nil {
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
	if v.GapResolvedAt, err = parseOptionalTime(gapResolvedAt); err != nil {
		return VODFinalization{}, fmt.Errorf("parse gap_resolved_at: %w", err)
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
//
// gapCount is the number of permanently unresolvable segments this
// finalization observed. When gapCount is 0, gap_status is set to
// 'none'. When gapCount is positive and the previously recorded gap
// applied to the exact same segment set (same FinalizedAt-generation
// SegmentIDs - callers only call this when segmentIDs actually changed
// or no record exists yet, see internal/upload.VODFinalizer.Finalize),
// gap_status is reset to 'pending_review', requiring the operator to
// review the new gap even if a prior, different gap had already been
// resolved.
func (s *Store) UpsertVODFinalized(ctx context.Context, eventID string, segmentIDs []int64, sessionCount int, r2Key string, gapCount int, now time.Time) error {
	segmentIDsJSON, err := json.Marshal(segmentIDs)
	if err != nil {
		return fmt.Errorf("store: marshal segment ids: %w", err)
	}
	gapStatus := VODGapNone
	if gapCount > 0 {
		gapStatus = VODGapPendingReview
	}
	nowStr := now.UTC().Format(time.RFC3339Nano)
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO vod_finalizations (
			event_id, status, segment_ids, session_count, r2_key, last_error, finalized_at, updated_at,
			gap_count, gap_status, gap_resolution_actor, gap_resolution_reason, gap_resolved_at
		)
		VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, '', '', '')
		ON CONFLICT(event_id) DO UPDATE SET
			status = excluded.status,
			segment_ids = excluded.segment_ids,
			session_count = excluded.session_count,
			r2_key = excluded.r2_key,
			last_error = '',
			finalized_at = excluded.finalized_at,
			updated_at = excluded.updated_at,
			gap_count = excluded.gap_count,
			gap_status = excluded.gap_status,
			gap_resolution_actor = '',
			gap_resolution_reason = '',
			gap_resolved_at = ''`,
		eventID, VODFinalized, string(segmentIDsJSON), sessionCount, r2Key, nowStr, nowStr, gapCount, gapStatus)
	if err != nil {
		return fmt.Errorf("store: upsert vod finalization for %s: %w", eventID, err)
	}
	return nil
}

// ErrNoGapPending is returned by ResolveVODGap when the event has no
// vod_finalizations row, or its gap_status is not 'pending_review' (no
// gap has yet been recorded).
var ErrNoGapPending = errors.New("vod: no pending gap for this event")

// ErrGapAlreadyResolvedDifferently is returned by ResolveVODGap when the
// event's gap was already resolved with a different action than the one
// requested, so the caller must not silently overwrite a prior operator
// decision.
var ErrGapAlreadyResolvedDifferently = errors.New("vod: gap already resolved with a different action")

// ResolveVODGap durably applies an operator's acknowledge/reject decision
// to eventID's currently pending VOD gap, and appends an audit row
// unconditionally (every resolution attempt is recorded, whether or not
// it changes state). It is idempotent: calling it again with the same
// action after it already applied returns success without modifying
// gap_resolved_at again. Calling it with a different action after the
// gap was already resolved returns ErrGapAlreadyResolvedDifferently
// rather than silently overwriting the recorded decision.
func (s *Store) ResolveVODGap(ctx context.Context, eventID, action, actor, reason string, now time.Time) (VODFinalization, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return VODFinalization{}, fmt.Errorf("store: begin resolve vod gap: %w", err)
	}
	defer tx.Rollback()

	row := tx.QueryRowContext(ctx, `
		SELECT event_id, status, segment_ids, session_count, r2_key, last_error, finalized_at, updated_at,
		       gap_count, gap_status, gap_resolution_actor, gap_resolution_reason, gap_resolved_at
		FROM vod_finalizations WHERE event_id = ?`, eventID)
	v, err := scanVODFinalization(row)
	if errors.Is(err, sql.ErrNoRows) {
		return VODFinalization{}, ErrNoGapPending
	}
	if err != nil {
		return VODFinalization{}, fmt.Errorf("store: read vod finalization for %s: %w", eventID, err)
	}

	nowStr := now.UTC().Format(time.RFC3339Nano)
	targetStatus := VODGapAcknowledged
	if action == VODGapActionReject {
		targetStatus = VODGapRejected
	}

	switch v.GapStatus {
	case VODGapPendingReview:
		if _, err := tx.ExecContext(ctx, `
			UPDATE vod_finalizations
			SET gap_status = ?, gap_resolution_actor = ?, gap_resolution_reason = ?, gap_resolved_at = ?, updated_at = ?
			WHERE event_id = ?`,
			targetStatus, actor, reason, nowStr, nowStr, eventID); err != nil {
			return VODFinalization{}, fmt.Errorf("store: apply vod gap resolution for %s: %w", eventID, err)
		}
		v.GapStatus = targetStatus
		v.GapResolutionActor = actor
		v.GapResolutionReason = reason
		v.GapResolvedAt = now
	case VODGapAcknowledged, VODGapRejected:
		if v.GapStatus != targetStatus {
			return VODFinalization{}, ErrGapAlreadyResolvedDifferently
		}
		// Idempotent replay of the same decision: no state change, but
		// still audited below.
	default: // VODGapNone or unknown
		return VODFinalization{}, ErrNoGapPending
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO vod_gap_audit (event_id, action, actor, reason, gap_count, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		eventID, action, actor, reason, v.GapCount, nowStr); err != nil {
		return VODFinalization{}, fmt.Errorf("store: record vod gap audit for %s: %w", eventID, err)
	}

	if err := tx.Commit(); err != nil {
		return VODFinalization{}, fmt.Errorf("store: commit vod gap resolution for %s: %w", eventID, err)
	}
	return v, nil
}

// ListFinalizedEventsEligibleForCleanup returns every event id whose VOD
// finalization completed at or before cutoff. The retention worker
// passes now().Add(-LocalRetentionDelay) as cutoff, so a result here
// means the configured local safety period has already elapsed
// (02_V1_ARCHITECTURE_SPEC.md "Retention and deletion").
//
// Once B2 is in the picture the elapsed delay is no longer sufficient on
// its own, because the local spool is the archiver's only byte source -
// releasing it early would destroy the only recoverable copy of a
// recording that has not yet reached the authoritative store. Two rules
// therefore apply on top of the delay:
//
//   - b2ArchivalEnabled selects whether an event with NO archival history
//     may still be released under the original 24-hour-only behavior. When
//     archival is enabled, an event that has not yet produced a completed,
//     acknowledged, strongly-verified archive is retained.
//
//   - An event that HAS archival history is never released under the
//     legacy rule, regardless of the flag. Turning archival off must not
//     become a data-destruction path for work that already started: such a
//     row stays retained until its archive is genuinely safe, or until a
//     deliberate future recovery action resolves it.
//
// Both conditions are fail-closed: missing or inconsistent evidence
// retains the spool rather than releasing it.
func (s *Store) ListFinalizedEventsEligibleForCleanup(ctx context.Context, cutoff time.Time, b2ArchivalEnabled bool) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT vf.event_id FROM vod_finalizations vf
		WHERE vf.status = ? AND vf.finalized_at <> '' AND vf.finalized_at <= ?
		  AND (
		    (
		      -- Legacy path: archival disabled AND this event never started
		      -- any B2 work at all.
		      ? = 0
		      AND NOT EXISTS (SELECT 1 FROM b2_archives b WHERE b.event_id = vf.event_id)
		    )
		    OR EXISTS (
		      -- Fully satisfied path. Applies whether or not archival is
		      -- currently enabled, so an event whose archival completed
		      -- safely before the flag was turned off is still releasable.
		      SELECT 1 FROM b2_archives b
		      WHERE b.event_id = vf.event_id
		        AND b.state = ?
		        AND b.strong_verified = 1
		        AND b.reported_generation = b.generation
		        AND b.reported_at <> ''
		        AND (b.gap_count = 0 OR b.gap_status = ?)
		    )
		  )`,
		VODFinalized, cutoff.UTC().Format(time.RFC3339Nano),
		boolToInt(b2ArchivalEnabled), B2ArchiveArchived, VODGapAcknowledged)
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
