package store

import (
	"context"
	"fmt"
	"time"
)

// MetricsSnapshot aggregates current durable state for internal/metrics
// to publish as Prometheus gauges. Every field here is either a count
// grouped by a small, fixed enum column or a single scalar - never a
// per-entity breakdown - so publishing it can never introduce an
// unbounded or secret-derived metric label.
type MetricsSnapshot struct {
	SessionsByStatus              map[string]int
	SegmentJobsByStatus           map[string]int
	SegmentsByUploadStatus        map[string]int
	SegmentUploadAttemptsSum      int64
	OldestPendingUploadAgeSeconds float64
	ManifestGenerationsByType     map[string]int
	VODFinalizationsByStatus      map[string]int
	VODByGapStatus                map[string]int
	RelaysByStatus                map[string]int
	RelayRestartsSum              int64
}

// GetMetricsSnapshot runs every aggregate query internal/metrics needs in
// one place, each individually cheap (indexed GROUP BY over a small
// enum column, or a single-row scalar aggregate).
func (s *Store) GetMetricsSnapshot(ctx context.Context, now time.Time) (MetricsSnapshot, error) {
	var snap MetricsSnapshot
	var err error

	if snap.SessionsByStatus, err = s.countByColumn(ctx, "ingest_sessions", "status"); err != nil {
		return MetricsSnapshot{}, fmt.Errorf("store: metrics snapshot: sessions: %w", err)
	}
	if snap.SegmentJobsByStatus, err = s.countByColumn(ctx, "segment_jobs", "status"); err != nil {
		return MetricsSnapshot{}, fmt.Errorf("store: metrics snapshot: segment jobs: %w", err)
	}
	if snap.SegmentsByUploadStatus, err = s.countByColumn(ctx, "segment_jobs", "upload_status"); err != nil {
		return MetricsSnapshot{}, fmt.Errorf("store: metrics snapshot: segment upload status: %w", err)
	}
	if snap.ManifestGenerationsByType, err = s.countByColumn(ctx, "manifest_generations", "manifest_type"); err != nil {
		return MetricsSnapshot{}, fmt.Errorf("store: metrics snapshot: manifest generations: %w", err)
	}
	if snap.VODFinalizationsByStatus, err = s.countByColumn(ctx, "vod_finalizations", "status"); err != nil {
		return MetricsSnapshot{}, fmt.Errorf("store: metrics snapshot: vod finalizations: %w", err)
	}
	if snap.VODByGapStatus, err = s.countByColumn(ctx, "vod_finalizations", "gap_status"); err != nil {
		return MetricsSnapshot{}, fmt.Errorf("store: metrics snapshot: vod gap status: %w", err)
	}
	if snap.RelaysByStatus, err = s.countByColumn(ctx, "youtube_relays", "status"); err != nil {
		return MetricsSnapshot{}, fmt.Errorf("store: metrics snapshot: relays: %w", err)
	}

	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(upload_attempt_count), 0) FROM segment_jobs`).Scan(&snap.SegmentUploadAttemptsSum); err != nil {
		return MetricsSnapshot{}, fmt.Errorf("store: metrics snapshot: upload attempts sum: %w", err)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(SUM(restart_count), 0) FROM youtube_relays`).Scan(&snap.RelayRestartsSum); err != nil {
		return MetricsSnapshot{}, fmt.Errorf("store: metrics snapshot: relay restarts sum: %w", err)
	}

	snap.OldestPendingUploadAgeSeconds, err = s.OldestPendingUploadAgeSeconds(ctx, now)
	if err != nil {
		return MetricsSnapshot{}, fmt.Errorf("store: metrics snapshot: %w", err)
	}

	return snap, nil
}

// OldestPendingUploadAgeSeconds is the single definition of "oldest pending
// upload age": the age of the oldest segment_jobs row that is durably
// captured (status 'queued') and not yet R2-confirmed (upload_status
// 'pending' or 'leased' - leased/in-progress and retrying jobs included;
// capturing, missing, failed, confirmed, and dead_letter excluded), measured
// from its created_at. It backs both media_agent_queue_oldest_pending_age_seconds
// (via GetMetricsSnapshot) and the non-gating /readyz upload_lag_seconds
// signal.
//
// The minimum is chosen by PARSED time in Go, never by SQL ORDER BY on the
// variable-length RFC3339Nano text (which is not chronological). A
// successful query with no backlog returns 0. Any query/scan/parse failure
// returns an error (callers omit/skip; never a fabricated 0). Negative
// (clock-skewed) ages clamp to 0. Every matching row is scanned; cost grows
// with the current upload backlog.
func (s *Store) OldestPendingUploadAgeSeconds(ctx context.Context, now time.Time) (float64, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT created_at FROM segment_jobs
		WHERE status = ? AND upload_status IN (?, ?)`, SegmentQueued, UploadPending, UploadLeased)
	if err != nil {
		return 0, fmt.Errorf("store: oldest pending upload: %w", err)
	}
	defer rows.Close()
	var oldest time.Time
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return 0, fmt.Errorf("store: scan pending upload created_at: %w", err)
		}
		t, err := time.Parse(time.RFC3339Nano, raw)
		if err != nil {
			return 0, fmt.Errorf("store: parse pending upload created_at: %w", err)
		}
		if oldest.IsZero() || t.Before(oldest) {
			oldest = t
		}
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("store: iterate pending uploads: %w", err)
	}
	if oldest.IsZero() {
		return 0, nil
	}
	if d := now.Sub(oldest).Seconds(); d > 0 {
		return d, nil
	}
	return 0, nil
}

// countByColumn returns a count of rows grouped by column, for the fixed,
// small set of tables/columns this package calls it with. table and
// column are always Go string literals supplied by GetMetricsSnapshot
// above, never request-controlled input, so building the query with
// fmt.Sprintf here cannot introduce SQL injection.
func (s *Store) countByColumn(ctx context.Context, table, column string) (map[string]int, error) {
	rows, err := s.db.QueryContext(ctx, fmt.Sprintf(`SELECT %s, COUNT(*) FROM %s GROUP BY %s`, column, table, column))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var key string
		var n int
		if err := rows.Scan(&key, &n); err != nil {
			return nil, err
		}
		counts[key] = n
	}
	return counts, rows.Err()
}
