package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// Segment job statuses.
const (
	SegmentCapturing = "capturing" // claimed; durable capture in progress
	SegmentQueued    = "queued"    // durably captured, awaiting upload (later phase)
	SegmentMissing   = "missing"   // reconciliation found a DB row but the spool file is gone
	SegmentFailed    = "failed"    // durable capture could not complete
)

// SegmentJob is one row of the durable segment queue: a completed SRS
// HLS segment the agent has (or is attempting to have) durably captured
// into its protected spool. See 03_DATA_MODEL_AND_API_CONTRACTS.md
// "segment_jobs MUST enforce a unique idempotency key."
type SegmentJob struct {
	ID                int64
	IdempotencyKey    string
	EventID           string
	SessionID         string
	LocalFileIdentity string
	SeqNo             int64
	DurationSeconds   float64
	SpoolPath         string
	ByteSize          int64
	SHA256            string
	Status            string
	AttemptCount      int
	LastError         string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// ClaimSegmentInput identifies one completed SRS segment.
type ClaimSegmentInput struct {
	IdempotencyKey    string
	EventID           string
	SessionID         string
	LocalFileIdentity string
	SeqNo             int64
	DurationSeconds   float64
}

// ClaimSegment atomically claims the idempotency key for capture, or
// discovers that it is already claimed/completed. Exactly one caller
// across any number of concurrent, duplicate on_hls callbacks for the
// same segment receives owned=true (its AttemptCount comes back as 1,
// meaning this call performed the INSERT); every other caller -
// including true concurrent duplicates racing this one, not just
// sequential retries - receives owned=false and the current row state,
// because SQLite serializes the underlying INSERT ... ON CONFLICT ...
// RETURNING statement across connections. The owner is responsible for
// performing the filesystem capture and then calling FinalizeSegment or
// FailSegment; non-owners must poll (see WaitForSegmentResult) rather
// than touch the filesystem themselves.
func (s *Store) ClaimSegment(ctx context.Context, in ClaimSegmentInput) (job SegmentJob, owned bool, err error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)

	row := s.db.QueryRowContext(ctx, `
		INSERT INTO segment_jobs (
			idempotency_key, event_id, session_id, local_file_identity, seq_no, duration_seconds,
			status, attempt_count, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
		ON CONFLICT(idempotency_key) DO UPDATE SET
			attempt_count = segment_jobs.attempt_count + 1,
			updated_at = excluded.updated_at
		RETURNING id, idempotency_key, event_id, session_id, local_file_identity, seq_no, duration_seconds,
		          spool_path, byte_size, sha256, status, attempt_count, last_error, created_at, updated_at`,
		in.IdempotencyKey, in.EventID, in.SessionID, in.LocalFileIdentity, in.SeqNo, in.DurationSeconds,
		SegmentCapturing, now, now,
	)

	job, err = scanSegmentJob(row)
	if err != nil {
		return SegmentJob{}, false, fmt.Errorf("store: claim segment %s: %w", in.IdempotencyKey, err)
	}
	return job, job.AttemptCount == 1, nil
}

func scanSegmentJob(row *sql.Row) (SegmentJob, error) {
	var j SegmentJob
	var createdAt, updatedAt string
	if err := row.Scan(&j.ID, &j.IdempotencyKey, &j.EventID, &j.SessionID, &j.LocalFileIdentity, &j.SeqNo,
		&j.DurationSeconds, &j.SpoolPath, &j.ByteSize, &j.SHA256, &j.Status, &j.AttemptCount, &j.LastError,
		&createdAt, &updatedAt); err != nil {
		return SegmentJob{}, err
	}
	var err error
	j.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return SegmentJob{}, fmt.Errorf("parse created_at: %w", err)
	}
	j.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt)
	if err != nil {
		return SegmentJob{}, fmt.Errorf("parse updated_at: %w", err)
	}
	return j, nil
}

// FinalizeSegment records a successful durable capture: the file is
// protected in the spool and the row transitions capturing -> queued.
func (s *Store) FinalizeSegment(ctx context.Context, id int64, spoolPath string, byteSize int64, sha256 string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE segment_jobs SET status = ?, spool_path = ?, byte_size = ?, sha256 = ?, last_error = '', updated_at = ?
		WHERE id = ?`,
		SegmentQueued, spoolPath, byteSize, sha256, now.UTC().Format(time.RFC3339Nano), id)
	if err != nil {
		return fmt.Errorf("store: finalize segment %d: %w", id, err)
	}
	return nil
}

// FailSegment records that durable capture could not complete. Per
// 02_V1_ARCHITECTURE_SPEC.md "on_hls", the callback must fail loudly
// rather than acknowledge unprotected media; FailSegment is how that
// failure becomes a durable, queryable record instead of only a log
// line.
func (s *Store) FailSegment(ctx context.Context, id int64, lastError string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE segment_jobs SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`,
		SegmentFailed, lastError, now.UTC().Format(time.RFC3339Nano), id)
	if err != nil {
		return fmt.Errorf("store: fail segment %d: %w", id, err)
	}
	return nil
}

// GetSegmentByID re-reads a segment job row, used to poll for the
// outcome of a capture owned by a different, concurrently-arrived
// duplicate callback.
func (s *Store) GetSegmentByID(ctx context.Context, id int64) (SegmentJob, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, idempotency_key, event_id, session_id, local_file_identity, seq_no, duration_seconds,
		       spool_path, byte_size, sha256, status, attempt_count, last_error, created_at, updated_at
		FROM segment_jobs WHERE id = ?`, id)
	job, err := scanSegmentJob(row)
	if err != nil {
		return SegmentJob{}, fmt.Errorf("store: get segment %d: %w", id, err)
	}
	return job, nil
}

// GetSegmentByIdempotencyKey looks up a segment job by its natural key,
// used by reconciliation to check whether an orphan spool file already
// has a record before reconstructing one.
func (s *Store) GetSegmentByIdempotencyKey(ctx context.Context, key string) (SegmentJob, bool, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, idempotency_key, event_id, session_id, local_file_identity, seq_no, duration_seconds,
		       spool_path, byte_size, sha256, status, attempt_count, last_error, created_at, updated_at
		FROM segment_jobs WHERE idempotency_key = ?`, key)
	job, err := scanSegmentJob(row)
	if errors.Is(err, sql.ErrNoRows) {
		return SegmentJob{}, false, nil
	}
	if err != nil {
		return SegmentJob{}, false, fmt.Errorf("store: get segment by key %s: %w", key, err)
	}
	return job, true, nil
}

// InsertReconciledSegment records an orphan durable spool file
// discovered by reconciliation (a file with no matching segment_jobs
// row, e.g. because the process crashed between fsync and the
// finalizing UPDATE). It is a no-op, not an error, if a row with this
// idempotency key already exists, so running reconciliation repeatedly
// never creates duplicate rows.
func (s *Store) InsertReconciledSegment(ctx context.Context, in ClaimSegmentInput, spoolPath string, byteSize int64, sha256 string, now time.Time) error {
	nowStr := now.UTC().Format(time.RFC3339Nano)
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO segment_jobs (
			idempotency_key, event_id, session_id, local_file_identity, seq_no, duration_seconds,
			spool_path, byte_size, sha256, status, attempt_count, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
		ON CONFLICT(idempotency_key) DO NOTHING`,
		in.IdempotencyKey, in.EventID, in.SessionID, in.LocalFileIdentity, in.SeqNo, in.DurationSeconds,
		spoolPath, byteSize, sha256, SegmentQueued, nowStr, nowStr)
	if err != nil {
		return fmt.Errorf("store: insert reconciled segment %s: %w", in.IdempotencyKey, err)
	}
	return nil
}

// MarkSegmentMissing records that a previously-queued segment's spool
// file is no longer present on disk. Per the frozen failure policy, the
// agent reports this rather than silently deleting or recreating the
// row, and never deletes unrelated files to "fix" it.
func (s *Store) MarkSegmentMissing(ctx context.Context, id int64, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE segment_jobs SET status = ?, last_error = 'spool file missing at reconciliation', updated_at = ?
		WHERE id = ?`, SegmentMissing, now.UTC().Format(time.RFC3339Nano), id)
	if err != nil {
		return fmt.Errorf("store: mark segment %d missing: %w", id, err)
	}
	return nil
}

// ListStuckCapturing returns every segment job row still in the
// "capturing" status whose updated_at is older than olderThan - a
// capture claimed by a process that crashed or was killed before it
// could finalize or fail the row. Rows updated more recently are
// presumed to be a genuinely in-flight capture running concurrently
// with this reconciliation pass and are left alone.
func (s *Store) ListStuckCapturing(ctx context.Context, olderThan time.Time) ([]SegmentJob, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, idempotency_key, event_id, session_id, local_file_identity, seq_no, duration_seconds,
		       spool_path, byte_size, sha256, status, attempt_count, last_error, created_at, updated_at
		FROM segment_jobs WHERE status = ? AND updated_at < ? ORDER BY id`,
		SegmentCapturing, olderThan.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return nil, fmt.Errorf("store: list stuck capturing segments: %w", err)
	}
	defer rows.Close()
	return scanSegmentJobRows(rows)
}

// ListSegmentsByStatus returns every segment job row with the given
// status, ordered by id, for reconciliation to check file presence.
func (s *Store) ListSegmentsByStatus(ctx context.Context, status string) ([]SegmentJob, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, idempotency_key, event_id, session_id, local_file_identity, seq_no, duration_seconds,
		       spool_path, byte_size, sha256, status, attempt_count, last_error, created_at, updated_at
		FROM segment_jobs WHERE status = ? ORDER BY id`, status)
	if err != nil {
		return nil, fmt.Errorf("store: list segments by status %s: %w", status, err)
	}
	defer rows.Close()
	return scanSegmentJobRows(rows)
}

func scanSegmentJobRows(rows *sql.Rows) ([]SegmentJob, error) {
	var jobs []SegmentJob
	for rows.Next() {
		var j SegmentJob
		var createdAt, updatedAt string
		if err := rows.Scan(&j.ID, &j.IdempotencyKey, &j.EventID, &j.SessionID, &j.LocalFileIdentity, &j.SeqNo,
			&j.DurationSeconds, &j.SpoolPath, &j.ByteSize, &j.SHA256, &j.Status, &j.AttemptCount, &j.LastError,
			&createdAt, &updatedAt); err != nil {
			return nil, fmt.Errorf("store: scan segment: %w", err)
		}
		var err error
		j.CreatedAt, err = time.Parse(time.RFC3339Nano, createdAt)
		if err != nil {
			return nil, fmt.Errorf("store: parse created_at: %w", err)
		}
		j.UpdatedAt, err = time.Parse(time.RFC3339Nano, updatedAt)
		if err != nil {
			return nil, fmt.Errorf("store: parse updated_at: %w", err)
		}
		jobs = append(jobs, j)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: iterate segments: %w", err)
	}
	return jobs, nil
}
