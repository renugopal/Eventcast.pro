package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ClaimUploadableSegment atomically claims the single oldest durably
// captured segment (status = SegmentQueued) that is either never
// uploaded, due for a retry, or whose previous worker's lease has
// expired, and marks it UploadLeased under workerID. It returns
// found=false if no segment is currently eligible.
//
// The claim is a single UPDATE ... WHERE id = (SELECT ...) RETURNING
// statement: SQLite serializes writers, so two workers racing this call
// cannot both claim the same row - the second worker's subquery is
// evaluated only after the first's UPDATE (and its lease fields) has
// committed, at which point that row no longer matches. This is the
// same atomic-claim pattern ClaimSegment uses for capture.
func (s *Store) ClaimUploadableSegment(ctx context.Context, workerID string, leaseDuration time.Duration, now time.Time) (SegmentJob, bool, error) {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	leaseExpires := now.Add(leaseDuration).UTC().Format(time.RFC3339Nano)

	row := s.db.QueryRowContext(ctx, `
		UPDATE segment_jobs SET
			upload_status = ?,
			upload_lease_owner = ?,
			upload_lease_expires_at = ?,
			updated_at = ?
		WHERE id = (
			SELECT id FROM segment_jobs
			WHERE status = ?
			  AND (
			        upload_status = ?
			        OR (upload_status = ? AND upload_lease_expires_at <> '' AND upload_lease_expires_at < ?)
			      )
			  AND (upload_next_attempt_at = '' OR upload_next_attempt_at <= ?)
			ORDER BY id
			LIMIT 1
		)
		RETURNING `+segmentJobColumns,
		UploadLeased, workerID, leaseExpires, nowStr,
		SegmentQueued, UploadPending, UploadLeased, nowStr, nowStr,
	)

	job, err := scanSegmentJob(row)
	if errors.Is(err, sql.ErrNoRows) {
		return SegmentJob{}, false, nil
	}
	if err != nil {
		return SegmentJob{}, false, fmt.Errorf("store: claim uploadable segment: %w", err)
	}
	return job, true, nil
}

// ConfirmUpload transitions a leased segment to UploadConfirmed after
// the caller has verified the R2 object via a HEAD request (key, size,
// and metadata all match). It also clears lease and retry-scheduling
// fields, since a confirmed segment never needs to be claimed again.
func (s *Store) ConfirmUpload(ctx context.Context, id int64, r2Key string, now time.Time) error {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `
		UPDATE segment_jobs SET
			upload_status = ?, r2_key = ?, uploaded_at = ?, upload_last_error = '',
			upload_lease_owner = '', upload_lease_expires_at = '', upload_next_attempt_at = '',
			updated_at = ?
		WHERE id = ?`,
		UploadConfirmed, r2Key, nowStr, nowStr, id)
	if err != nil {
		return fmt.Errorf("store: confirm upload %d: %w", id, err)
	}
	return nil
}

// ReleaseUploadForRetry records a retryable upload failure: the segment
// returns to UploadPending (releasing its lease) with an incremented
// attempt count and a scheduled next-attempt time. Per
// 02_V1_ARCHITECTURE_SPEC.md "Upload retries MUST use exponential
// backoff with jitter ... Retriable ... errors MUST not become terminal
// merely because a retry count was exceeded," this never transitions to
// UploadDeadLetter regardless of how large attemptCount grows; only
// DeadLetterUpload does that, for errors classified as non-retryable.
func (s *Store) ReleaseUploadForRetry(ctx context.Context, id int64, lastError string, nextAttemptAt, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE segment_jobs SET
			upload_status = ?, upload_attempt_count = upload_attempt_count + 1, upload_last_error = ?,
			upload_next_attempt_at = ?, upload_lease_owner = '', upload_lease_expires_at = '', updated_at = ?
		WHERE id = ?`,
		UploadPending, lastError, nextAttemptAt.UTC().Format(time.RFC3339Nano), now.UTC().Format(time.RFC3339Nano), id)
	if err != nil {
		return fmt.Errorf("store: release upload %d for retry: %w", id, err)
	}
	return nil
}

// DeadLetterUpload records a terminal, non-retryable upload failure
// (invalid credentials, a corrupted or missing local file, or a
// confirmed R2 object whose metadata does not match what this segment
// expects to have uploaded). A dead-lettered segment is never
// automatically retried; it requires operator intervention.
func (s *Store) DeadLetterUpload(ctx context.Context, id int64, lastError string, now time.Time) error {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `
		UPDATE segment_jobs SET
			upload_status = ?, upload_attempt_count = upload_attempt_count + 1, upload_last_error = ?,
			upload_lease_owner = '', upload_lease_expires_at = '', updated_at = ?
		WHERE id = ?`,
		UploadDeadLetter, lastError, nowStr, id)
	if err != nil {
		return fmt.Errorf("store: dead-letter upload %d: %w", id, err)
	}
	return nil
}

// ReclaimExpiredUploadLeases is a defensive sweep run by reconciliation:
// it releases any lease whose expiry has passed back to UploadPending
// immediately, without waiting for a future ClaimUploadableSegment call
// to notice. This bounds how long a segment can be stranded after its
// owning worker crashed without the process ever calling
// ClaimUploadableSegment again (e.g. every worker goroutine exited).
func (s *Store) ReclaimExpiredUploadLeases(ctx context.Context, now time.Time) (int, error) {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	res, err := s.db.ExecContext(ctx, `
		UPDATE segment_jobs SET
			upload_status = ?, upload_lease_owner = '', upload_lease_expires_at = '', updated_at = ?
		WHERE upload_status = ? AND upload_lease_expires_at <> '' AND upload_lease_expires_at < ?`,
		UploadPending, nowStr, UploadLeased, nowStr)
	if err != nil {
		return 0, fmt.Errorf("store: reclaim expired upload leases: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("store: reclaim expired upload leases: rows affected: %w", err)
	}
	return int(n), nil
}

// ListConfirmedSegmentsByEvent returns every UploadConfirmed segment for
// eventID in ascending id order (this Media Agent's stable
// chronological ordering across sessions - see internal/upload/manifest
// package docs). It backs both live-manifest windowing and VOD
// finalization; both variants require the same "confirmed segments in
// order" starting point.
func (s *Store) ListConfirmedSegmentsByEvent(ctx context.Context, eventID string) ([]SegmentJob, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+segmentJobColumns+` FROM segment_jobs
		WHERE event_id = ? AND upload_status = ?
		ORDER BY id`, eventID, UploadConfirmed)
	if err != nil {
		return nil, fmt.Errorf("store: list confirmed segments for event %s: %w", eventID, err)
	}
	defer rows.Close()
	return scanSegmentJobRows(rows)
}

// ListSegmentsByEvent returns every segment_jobs row for eventID in
// ascending id order, regardless of capture or upload status. VOD
// finalization uses this to check whether any segment is still
// in-flight (capturing) before it will finalize.
func (s *Store) ListSegmentsByEvent(ctx context.Context, eventID string) ([]SegmentJob, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+segmentJobColumns+` FROM segment_jobs WHERE event_id = ? ORDER BY id`, eventID)
	if err != nil {
		return nil, fmt.Errorf("store: list segments for event %s: %w", eventID, err)
	}
	defer rows.Close()
	return scanSegmentJobRows(rows)
}

// MarkManifestCommitted records that ids have been referenced by a
// published manifest (live or VOD). It is best-effort bookkeeping for
// operator visibility, not a correctness dependency: manifest content
// itself is always recomputed from UploadConfirmed state directly, so a
// missed or duplicate MarkManifestCommitted call cannot cause an
// incorrect manifest.
//
// ids is every segment currently inside the manifest's window - for a
// live manifest, that is the whole ~DVR-window suffix, not just the
// newly-confirmed segment - so a single rebuild can pass a few hundred
// ids. This issues one batched UPDATE rather than one per id: the
// earlier per-id loop held SQLite's write lock for as many round trips
// as there were ids, and because a live rebuild fires on every upload
// confirmation, that lock duration was the dominant source of
// SQLITE_BUSY under concurrent upload/manifest activity. The
// manifest_commit_status <> ? filter also skips rows already marked
// committed by a previous rebuild, so a steady-state rebuild - which
// only ever adds one new segment to an otherwise-already-committed
// window - writes just that one row.
func (s *Store) MarkManifestCommitted(ctx context.Context, ids []int64, now time.Time) error {
	if len(ids) == 0 {
		return nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, 0, len(ids)+3)
	args = append(args, ManifestCommitCommitted, now.UTC().Format(time.RFC3339Nano))
	for i, id := range ids {
		placeholders[i] = "?"
		args = append(args, id)
	}
	args = append(args, ManifestCommitCommitted)

	query := `UPDATE segment_jobs SET manifest_commit_status = ?, updated_at = ?
		WHERE id IN (` + strings.Join(placeholders, ",") + `) AND manifest_commit_status <> ?`
	if _, err := s.db.ExecContext(ctx, query, args...); err != nil {
		return fmt.Errorf("store: mark manifest committed for %d segments: %w", len(ids), err)
	}
	return nil
}

// ListRetentionCandidates returns every UploadConfirmed, not-yet-locally-deleted
// segment for eventID, for the retention worker to evaluate against the
// configured local safety delay after VOD finalization.
func (s *Store) ListRetentionCandidates(ctx context.Context, eventID string) ([]SegmentJob, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+segmentJobColumns+` FROM segment_jobs
		WHERE event_id = ? AND upload_status = ? AND local_deleted_at = ''
		ORDER BY id`, eventID, UploadConfirmed)
	if err != nil {
		return nil, fmt.Errorf("store: list retention candidates for event %s: %w", eventID, err)
	}
	defer rows.Close()
	return scanSegmentJobRows(rows)
}

// ListEventsNeedingManifestRebuild returns the distinct event ids that
// have at least one UploadConfirmed segment not yet reflected in a
// published manifest (ManifestCommitPending). It is the store-driven
// discovery query behind the manifest rebuild backstop: because it is
// recomputed from durable state rather than tracked in memory, it
// naturally covers delayed uploads, out-of-order completion, a worker
// restart, and a manifest publish that failed partway (that segment's
// manifest_commit_status simply never advanced to "committed", so it
// is found again on the next sweep).
func (s *Store) ListEventsNeedingManifestRebuild(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT event_id FROM segment_jobs
		WHERE upload_status = ? AND manifest_commit_status = ?`,
		UploadConfirmed, ManifestCommitPending)
	if err != nil {
		return nil, fmt.Errorf("store: list events needing manifest rebuild: %w", err)
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
		return nil, fmt.Errorf("store: iterate events needing manifest rebuild: %w", err)
	}
	return eventIDs, nil
}

// MarkLocalDeleted records that this segment's local spool copy has
// been removed by the retention worker. It never touches SpoolPath
// itself (a historical record of where the file used to live), only
// LocalDeletedAt, so the row remains a complete audit trail.
func (s *Store) MarkLocalDeleted(ctx context.Context, id int64, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE segment_jobs SET local_deleted_at = ?, updated_at = ? WHERE id = ?`,
		now.UTC().Format(time.RFC3339Nano), now.UTC().Format(time.RFC3339Nano), id)
	if err != nil {
		return fmt.Errorf("store: mark segment %d locally deleted: %w", id, err)
	}
	return nil
}
