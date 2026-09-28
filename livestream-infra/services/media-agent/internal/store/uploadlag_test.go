package store

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// insertSegmentJob is a TEST-LOCAL fixture: no public store API writes an
// arbitrary historical created_at, so rows are inserted directly to control
// created_at, status, and upload_status precisely.
func insertSegmentJob(t *testing.T, st *Store, seq int, status, uploadStatus, createdAt string) {
	t.Helper()
	if _, err := st.db.Exec(`
		INSERT INTO segment_jobs (idempotency_key, event_id, session_id, local_file_identity, seq_no,
		                          duration_seconds, status, upload_status, created_at, updated_at)
		VALUES (?, 'evt', 'sess', ?, ?, 4.0, ?, ?, ?, ?)`,
		fmt.Sprintf("k-%d", seq), fmt.Sprintf("%d.ts", seq), seq, status, uploadStatus, createdAt, createdAt); err != nil {
		t.Fatalf("insertSegmentJob(%d): %v", seq, err)
	}
}

func TestOldestPendingUploadAge_NoBacklog_Zero(t *testing.T) {
	st := openTestStore(t)
	age, err := st.OldestPendingUploadAgeSeconds(context.Background(), time.Now().UTC())
	if err != nil || age != 0 {
		t.Fatalf("age=%v err=%v, want 0, nil", age, err)
	}
}

func TestOldestPendingUploadAge_IncludesPendingAndLeased_ExcludesOthers(t *testing.T) {
	st := openTestStore(t)
	now := time.Date(2026, 9, 27, 12, 0, 0, 0, time.UTC)
	old := func(d time.Duration) string { return fmtTime(now.Add(-d)) }
	// Excluded rows are all OLDER than every included row, so a wrong filter
	// would change the answer.
	insertSegmentJob(t, st, 1, SegmentCapturing, UploadPending, old(10*time.Hour))
	insertSegmentJob(t, st, 2, SegmentMissing, UploadPending, old(9*time.Hour))
	insertSegmentJob(t, st, 3, SegmentFailed, UploadPending, old(8*time.Hour))
	insertSegmentJob(t, st, 4, SegmentQueued, UploadConfirmed, old(7*time.Hour))
	insertSegmentJob(t, st, 5, SegmentQueued, UploadDeadLetter, old(6*time.Hour))
	insertSegmentJob(t, st, 6, SegmentQueued, UploadLeased, old(90*time.Second)) // oldest included
	insertSegmentJob(t, st, 7, SegmentQueued, UploadPending, old(30*time.Second))

	age, err := st.OldestPendingUploadAgeSeconds(context.Background(), now)
	if err != nil || age != 90 {
		t.Fatalf("age=%v err=%v, want 90 (the leased row; excluded states ignored)", age, err)
	}
}

func TestOldestPendingUploadAge_ChronologicalNotLexical(t *testing.T) {
	st := openTestStore(t)
	base := time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC)
	// "...T10:00:00Z" sorts AFTER "...T10:00:00.5Z" as text ('Z' > '.'), but
	// is EARLIER in time.
	insertSegmentJob(t, st, 1, SegmentQueued, UploadPending, fmtTime(base.Add(500*time.Millisecond)))
	insertSegmentJob(t, st, 2, SegmentQueued, UploadPending, fmtTime(base))
	now := base.Add(10 * time.Second)
	age, err := st.OldestPendingUploadAgeSeconds(context.Background(), now)
	if err != nil || age != 10 {
		t.Fatalf("age=%v err=%v, want 10 from the chronologically oldest row", age, err)
	}
}

func TestOldestPendingUploadAge_FutureCreatedAtClampsToZero(t *testing.T) {
	st := openTestStore(t)
	now := time.Now().UTC()
	insertSegmentJob(t, st, 1, SegmentQueued, UploadPending, fmtTime(now.Add(time.Minute)))
	age, err := st.OldestPendingUploadAgeSeconds(context.Background(), now)
	if err != nil || age != 0 {
		t.Fatalf("age=%v err=%v, want clamped 0", age, err)
	}
}

func TestOldestPendingUploadAge_QueryErrorReturnsError(t *testing.T) {
	st := openTestStore(t)
	st.Close()
	if age, err := st.OldestPendingUploadAgeSeconds(context.Background(), time.Now()); err == nil {
		t.Fatalf("age=%v err=nil, want an error (never a fabricated 0)", age)
	}
}

func TestMetricsSnapshot_UsesSharedOldestPendingDefinition(t *testing.T) {
	st := openTestStore(t)
	base := time.Date(2026, 9, 27, 10, 0, 0, 0, time.UTC)
	insertSegmentJob(t, st, 1, SegmentQueued, UploadPending, fmtTime(base.Add(500*time.Millisecond)))
	insertSegmentJob(t, st, 2, SegmentQueued, UploadLeased, fmtTime(base))
	insertSegmentJob(t, st, 3, SegmentQueued, UploadConfirmed, fmtTime(base.Add(-time.Hour)))
	now := base.Add(42 * time.Second)
	snap, err := st.GetMetricsSnapshot(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	shared, err := st.OldestPendingUploadAgeSeconds(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	if snap.OldestPendingUploadAgeSeconds != shared || shared != 42 {
		t.Fatalf("snapshot=%v shared=%v, want both 42 (one definition)", snap.OldestPendingUploadAgeSeconds, shared)
	}
}
