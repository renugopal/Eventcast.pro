package store

import (
	"context"
	"database/sql"
	"errors"
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

	var oldestCreatedAt string
	err = s.db.QueryRowContext(ctx, `
		SELECT created_at FROM segment_jobs
		WHERE status = 'queued' AND upload_status IN ('pending', 'leased')
		ORDER BY created_at ASC LIMIT 1`).Scan(&oldestCreatedAt)
	switch {
	case err == nil:
		t, parseErr := time.Parse(time.RFC3339Nano, oldestCreatedAt)
		if parseErr != nil {
			return MetricsSnapshot{}, fmt.Errorf("store: metrics snapshot: parse oldest pending created_at: %w", parseErr)
		}
		snap.OldestPendingUploadAgeSeconds = now.Sub(t).Seconds()
	case errors.Is(err, sql.ErrNoRows):
		snap.OldestPendingUploadAgeSeconds = 0
	default:
		return MetricsSnapshot{}, fmt.Errorf("store: metrics snapshot: oldest pending upload: %w", err)
	}

	return snap, nil
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
