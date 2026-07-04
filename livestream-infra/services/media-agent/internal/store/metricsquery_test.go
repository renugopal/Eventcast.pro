package store

import (
	"context"
	"testing"
	"time"
)

func TestGetMetricsSnapshotEmptyDatabase(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	snap, err := st.GetMetricsSnapshot(ctx, time.Now().UTC())
	if err != nil {
		t.Fatalf("GetMetricsSnapshot() error: %v", err)
	}
	if len(snap.SessionsByStatus) != 0 || snap.SegmentUploadAttemptsSum != 0 || snap.OldestPendingUploadAgeSeconds != 0 {
		t.Errorf("got %+v, want all-zero snapshot for an empty database", snap)
	}
}

func TestGetMetricsSnapshotReflectsState(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	if _, err := st.ImportAssignments(ctx, []Assignment{testAssignment("stream-1")}); err != nil {
		t.Fatalf("ImportAssignments() error: %v", err)
	}
	sess, err := st.CreateSession(ctx, "event-stream-1", "stream-1", time.Now())
	if err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}

	old := time.Now().UTC().Add(-time.Hour)
	if _, _, err := st.ClaimSegment(ctx, ClaimSegmentInput{
		IdempotencyKey: "e|s|1", EventID: "event-stream-1", SessionID: sess.ID,
		LocalFileIdentity: "1", SeqNo: 1, DurationSeconds: 4,
	}); err != nil {
		t.Fatalf("ClaimSegment() error: %v", err)
	}
	// Force a known created_at so the age computation is deterministic.
	if _, err := st.db.ExecContext(ctx, `UPDATE segment_jobs SET status = 'queued', created_at = ? WHERE idempotency_key = ?`,
		old.Format(time.RFC3339Nano), "e|s|1"); err != nil {
		t.Fatalf("force created_at: %v", err)
	}

	if err := st.UpsertVODFinalized(ctx, "event-stream-1", []int64{1}, 1, "key", 1, time.Now().UTC()); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}

	snap, err := st.GetMetricsSnapshot(ctx, time.Now().UTC())
	if err != nil {
		t.Fatalf("GetMetricsSnapshot() error: %v", err)
	}
	if snap.SessionsByStatus["active"] != 1 {
		t.Errorf("SessionsByStatus[active] = %d, want 1", snap.SessionsByStatus["active"])
	}
	if snap.SegmentJobsByStatus["queued"] != 1 {
		t.Errorf("SegmentJobsByStatus[queued] = %d, want 1", snap.SegmentJobsByStatus["queued"])
	}
	if snap.OldestPendingUploadAgeSeconds < 3500 { // ~1 hour, allow scheduling slack
		t.Errorf("OldestPendingUploadAgeSeconds = %f, want >= ~3600", snap.OldestPendingUploadAgeSeconds)
	}
	if snap.VODFinalizationsByStatus[VODFinalized] != 1 {
		t.Errorf("VODFinalizationsByStatus[finalized] = %d, want 1", snap.VODFinalizationsByStatus[VODFinalized])
	}
	if snap.VODByGapStatus[VODGapPendingReview] != 1 {
		t.Errorf("VODByGapStatus[pending_review] = %d, want 1", snap.VODByGapStatus[VODGapPendingReview])
	}
}
