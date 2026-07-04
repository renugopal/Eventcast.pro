package store

import (
	"context"
	"sync"
	"testing"
	"time"
)

func testClaimInput(key string) ClaimSegmentInput {
	return ClaimSegmentInput{
		IdempotencyKey:    key,
		EventID:           "event-1",
		SessionID:         "session-1",
		LocalFileIdentity: "1-1720000000-1.ts",
		SeqNo:             1,
		DurationSeconds:   4.0,
	}
}

func TestClaimSegmentFreshClaimIsOwned(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	job, owned, err := st.ClaimSegment(ctx, testClaimInput("key-1"))
	if err != nil {
		t.Fatalf("ClaimSegment() error: %v", err)
	}
	if !owned {
		t.Error("owned = false for a fresh claim, want true")
	}
	if job.Status != SegmentCapturing {
		t.Errorf("Status = %q, want %q", job.Status, SegmentCapturing)
	}
	if job.AttemptCount != 1 {
		t.Errorf("AttemptCount = %d, want 1", job.AttemptCount)
	}
}

func TestClaimSegmentDuplicateIsNotOwned(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	first, owned, err := st.ClaimSegment(ctx, testClaimInput("key-1"))
	if err != nil {
		t.Fatalf("ClaimSegment() first error: %v", err)
	}
	if !owned {
		t.Fatal("first claim should be owned")
	}

	second, owned, err := st.ClaimSegment(ctx, testClaimInput("key-1"))
	if err != nil {
		t.Fatalf("ClaimSegment() duplicate error: %v", err)
	}
	if owned {
		t.Error("owned = true for a duplicate claim, want false")
	}
	if second.ID != first.ID {
		t.Errorf("duplicate claim returned a different row id: %d vs %d", second.ID, first.ID)
	}
	if second.AttemptCount != 2 {
		t.Errorf("AttemptCount = %d, want 2", second.AttemptCount)
	}
}

func TestClaimSegmentConcurrentOnlyOneOwner(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	const attempts = 10
	var wg sync.WaitGroup
	ownedCount := make(chan bool, attempts)

	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, owned, err := st.ClaimSegment(ctx, testClaimInput("concurrent-key"))
			if err != nil {
				t.Errorf("ClaimSegment() error: %v", err)
				return
			}
			ownedCount <- owned
		}()
	}
	wg.Wait()
	close(ownedCount)

	owners := 0
	total := 0
	for owned := range ownedCount {
		total++
		if owned {
			owners++
		}
	}
	if total != attempts {
		t.Fatalf("collected %d results, want %d", total, attempts)
	}
	if owners != 1 {
		t.Errorf("concurrent ClaimSegment owners = %d, want exactly 1", owners)
	}
}

func TestFinalizeSegmentTransitionsToQueued(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now()

	job, _, err := st.ClaimSegment(ctx, testClaimInput("key-1"))
	if err != nil {
		t.Fatalf("ClaimSegment() error: %v", err)
	}

	if err := st.FinalizeSegment(ctx, job.ID, "/spool/event-1/session-1/1-x.ts", 12345, "deadbeef", now); err != nil {
		t.Fatalf("FinalizeSegment() error: %v", err)
	}

	got, err := st.GetSegmentByID(ctx, job.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.Status != SegmentQueued {
		t.Errorf("Status = %q, want %q", got.Status, SegmentQueued)
	}
	if got.SpoolPath != "/spool/event-1/session-1/1-x.ts" || got.ByteSize != 12345 || got.SHA256 != "deadbeef" {
		t.Errorf("finalized job = %+v, fields did not persist as expected", got)
	}
}

func TestFailSegmentTransitionsToFailed(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now()

	job, _, err := st.ClaimSegment(ctx, testClaimInput("key-1"))
	if err != nil {
		t.Fatalf("ClaimSegment() error: %v", err)
	}

	if err := st.FailSegment(ctx, job.ID, "source file vanished", now); err != nil {
		t.Fatalf("FailSegment() error: %v", err)
	}

	got, err := st.GetSegmentByID(ctx, job.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.Status != SegmentFailed {
		t.Errorf("Status = %q, want %q", got.Status, SegmentFailed)
	}
	if got.LastError != "source file vanished" {
		t.Errorf("LastError = %q, want %q", got.LastError, "source file vanished")
	}
}

func TestGetSegmentByIdempotencyKeyNotFound(t *testing.T) {
	st := openTestStore(t)
	_, found, err := st.GetSegmentByIdempotencyKey(context.Background(), "does-not-exist")
	if err != nil {
		t.Fatalf("GetSegmentByIdempotencyKey() error: %v", err)
	}
	if found {
		t.Error("found = true for an unknown key, want false")
	}
}

func TestInsertReconciledSegmentIsIdempotent(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now()

	in := testClaimInput("orphan-key")
	if err := st.InsertReconciledSegment(ctx, in, "/spool/event-1/session-1/1-x.ts", 100, "abc", now); err != nil {
		t.Fatalf("InsertReconciledSegment() first error: %v", err)
	}
	if err := st.InsertReconciledSegment(ctx, in, "/spool/event-1/session-1/1-x.ts", 100, "abc", now); err != nil {
		t.Fatalf("InsertReconciledSegment() second error: %v", err)
	}

	jobs, err := st.ListSegmentsByStatus(ctx, SegmentQueued)
	if err != nil {
		t.Fatalf("ListSegmentsByStatus() error: %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("len(jobs) = %d, want 1 (repeated reconciliation must not duplicate)", len(jobs))
	}
}

func TestMarkSegmentMissing(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now()

	job, _, err := st.ClaimSegment(ctx, testClaimInput("key-1"))
	if err != nil {
		t.Fatalf("ClaimSegment() error: %v", err)
	}
	if err := st.FinalizeSegment(ctx, job.ID, "/spool/gone.ts", 1, "abc", now); err != nil {
		t.Fatalf("FinalizeSegment() error: %v", err)
	}

	if err := st.MarkSegmentMissing(ctx, job.ID, now); err != nil {
		t.Fatalf("MarkSegmentMissing() error: %v", err)
	}

	got, err := st.GetSegmentByID(ctx, job.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.Status != SegmentMissing {
		t.Errorf("Status = %q, want %q", got.Status, SegmentMissing)
	}
}

func TestListStuckCapturingRespectsAgeThreshold(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()

	if _, _, err := st.ClaimSegment(ctx, testClaimInput("recent-key")); err != nil {
		t.Fatalf("ClaimSegment() error: %v", err)
	}

	// Nothing is old enough yet.
	stuck, err := st.ListStuckCapturing(ctx, time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatalf("ListStuckCapturing() error: %v", err)
	}
	if len(stuck) != 0 {
		t.Errorf("len(stuck) = %d, want 0 for a just-claimed row", len(stuck))
	}

	// Everything looks "stuck" if the cutoff is in the future.
	stuck, err = st.ListStuckCapturing(ctx, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("ListStuckCapturing() error: %v", err)
	}
	if len(stuck) != 1 {
		t.Errorf("len(stuck) = %d, want 1 when the cutoff is in the future", len(stuck))
	}
}

func TestListSegmentsByStatus(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now()

	capturing, _, err := st.ClaimSegment(ctx, testClaimInput("capturing-key"))
	if err != nil {
		t.Fatalf("ClaimSegment() error: %v", err)
	}
	queued, _, err := st.ClaimSegment(ctx, testClaimInput("queued-key"))
	if err != nil {
		t.Fatalf("ClaimSegment() error: %v", err)
	}
	if err := st.FinalizeSegment(ctx, queued.ID, "/spool/x.ts", 1, "abc", now); err != nil {
		t.Fatalf("FinalizeSegment() error: %v", err)
	}

	capturingJobs, err := st.ListSegmentsByStatus(ctx, SegmentCapturing)
	if err != nil {
		t.Fatalf("ListSegmentsByStatus(capturing) error: %v", err)
	}
	if len(capturingJobs) != 1 || capturingJobs[0].ID != capturing.ID {
		t.Errorf("ListSegmentsByStatus(capturing) = %+v, want just %d", capturingJobs, capturing.ID)
	}

	queuedJobs, err := st.ListSegmentsByStatus(ctx, SegmentQueued)
	if err != nil {
		t.Fatalf("ListSegmentsByStatus(queued) error: %v", err)
	}
	if len(queuedJobs) != 1 || queuedJobs[0].ID != queued.ID {
		t.Errorf("ListSegmentsByStatus(queued) = %+v, want just %d", queuedJobs, queued.ID)
	}
}
