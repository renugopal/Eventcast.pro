package store

import (
	"context"
	"testing"
	"time"
)

func mustClaimQueuedSegment(t *testing.T, st *Store, eventID, sessionID, key string, seqNo int64) SegmentJob {
	t.Helper()
	ctx := context.Background()
	job, owned, err := st.ClaimSegment(ctx, ClaimSegmentInput{
		IdempotencyKey: key, EventID: eventID, SessionID: sessionID, LocalFileIdentity: key, SeqNo: seqNo, DurationSeconds: 4,
	})
	if err != nil || !owned {
		t.Fatalf("ClaimSegment() owned=%v err=%v", owned, err)
	}
	if err := st.FinalizeSegment(ctx, job.ID, "/spool/"+key, 100, "deadbeef", time.Now().UTC()); err != nil {
		t.Fatalf("FinalizeSegment() error: %v", err)
	}
	got, err := st.GetSegmentByID(ctx, job.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.UploadStatus != UploadPending {
		t.Fatalf("newly-finalized segment UploadStatus = %q, want %q", got.UploadStatus, UploadPending)
	}
	return got
}

func TestClaimUploadableSegmentOnlyClaimsQueuedSegments(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	// A segment still "capturing" must never be claimable for upload.
	if _, _, err := st.ClaimSegment(ctx, ClaimSegmentInput{IdempotencyKey: "k1", EventID: "e", SessionID: "s", LocalFileIdentity: "k1", SeqNo: 1}); err != nil {
		t.Fatalf("ClaimSegment() error: %v", err)
	}

	_, owned, err := st.ClaimUploadableSegment(ctx, "worker-1", time.Minute, time.Now().UTC())
	if err != nil {
		t.Fatalf("ClaimUploadableSegment() error: %v", err)
	}
	if owned {
		t.Fatal("expected no uploadable segment while the only row is still capturing")
	}
}

func TestClaimUploadableSegmentFIFOOrder(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	first := mustClaimQueuedSegment(t, st, "e", "s", "k1", 1)
	mustClaimQueuedSegment(t, st, "e", "s", "k2", 2)

	job, owned, err := st.ClaimUploadableSegment(ctx, "worker-1", time.Minute, time.Now().UTC())
	if err != nil || !owned {
		t.Fatalf("ClaimUploadableSegment() owned=%v err=%v", owned, err)
	}
	if job.ID != first.ID {
		t.Errorf("claimed segment ID = %d, want the oldest (%d)", job.ID, first.ID)
	}
}

func TestConfirmUploadClearsLeaseAndRetryState(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	seg := mustClaimQueuedSegment(t, st, "e", "s", "k1", 1)

	job, owned, err := st.ClaimUploadableSegment(ctx, "worker-1", time.Minute, time.Now().UTC())
	if err != nil || !owned || job.ID != seg.ID {
		t.Fatalf("ClaimUploadableSegment() owned=%v err=%v", owned, err)
	}
	if err := st.ConfirmUpload(ctx, job.ID, "events/pb/media/s/k1", time.Now().UTC()); err != nil {
		t.Fatalf("ConfirmUpload() error: %v", err)
	}

	got, err := st.GetSegmentByID(ctx, job.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.UploadStatus != UploadConfirmed {
		t.Fatalf("UploadStatus = %q, want %q", got.UploadStatus, UploadConfirmed)
	}
	if got.UploadLeaseOwner != "" || !got.UploadLeaseExpiresAt.IsZero() {
		t.Error("expected lease fields cleared after confirmation")
	}
	if got.R2Key != "events/pb/media/s/k1" {
		t.Errorf("R2Key = %q", got.R2Key)
	}
}

func TestReleaseUploadForRetryNeverBecomesTerminal(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	seg := mustClaimQueuedSegment(t, st, "e", "s", "k1", 1)

	job, _, err := st.ClaimUploadableSegment(ctx, "worker-1", time.Minute, time.Now().UTC())
	if err != nil {
		t.Fatalf("ClaimUploadableSegment() error: %v", err)
	}
	now := time.Now().UTC()
	// Simulate a very large attempt count (as if this had been retried
	// for days): it must still be UploadPending, never dead-lettered,
	// because ReleaseUploadForRetry is only used for retryable failures.
	for i := 0; i < 50; i++ {
		if err := st.ReleaseUploadForRetry(ctx, job.ID, "transient failure", now.Add(time.Minute), now); err != nil {
			t.Fatalf("ReleaseUploadForRetry() error: %v", err)
		}
	}

	got, err := st.GetSegmentByID(ctx, seg.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.UploadStatus != UploadPending {
		t.Errorf("UploadStatus = %q, want %q after many retries", got.UploadStatus, UploadPending)
	}
	if got.UploadAttemptCount != 50 {
		t.Errorf("UploadAttemptCount = %d, want 50", got.UploadAttemptCount)
	}
}

func TestDeadLetterUploadIsTerminal(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	seg := mustClaimQueuedSegment(t, st, "e", "s", "k1", 1)

	if err := st.DeadLetterUpload(ctx, seg.ID, "corrupted file", time.Now().UTC()); err != nil {
		t.Fatalf("DeadLetterUpload() error: %v", err)
	}

	got, err := st.GetSegmentByID(ctx, seg.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.UploadStatus != UploadDeadLetter {
		t.Fatalf("UploadStatus = %q, want %q", got.UploadStatus, UploadDeadLetter)
	}

	// A dead-lettered segment must never be claimable again.
	_, owned, err := st.ClaimUploadableSegment(ctx, "worker-1", time.Minute, time.Now().UTC())
	if err != nil {
		t.Fatalf("ClaimUploadableSegment() error: %v", err)
	}
	if owned {
		t.Error("expected a dead-lettered segment to never be reclaimed")
	}
}

func TestListConfirmedSegmentsByEventOrdersAscending(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	s1 := mustClaimQueuedSegment(t, st, "e", "sess-a", "k1", 1)
	s2 := mustClaimQueuedSegment(t, st, "e", "sess-b", "k2", 1)
	mustClaimQueuedSegment(t, st, "e", "sess-b", "k3", 2) // left unconfirmed

	if err := st.ConfirmUpload(ctx, s1.ID, "r2/k1", time.Now().UTC()); err != nil {
		t.Fatalf("ConfirmUpload() error: %v", err)
	}
	if err := st.ConfirmUpload(ctx, s2.ID, "r2/k2", time.Now().UTC()); err != nil {
		t.Fatalf("ConfirmUpload() error: %v", err)
	}

	confirmed, err := st.ListConfirmedSegmentsByEvent(ctx, "e")
	if err != nil {
		t.Fatalf("ListConfirmedSegmentsByEvent() error: %v", err)
	}
	if len(confirmed) != 2 {
		t.Fatalf("len(confirmed) = %d, want 2", len(confirmed))
	}
	if confirmed[0].ID != s1.ID || confirmed[1].ID != s2.ID {
		t.Errorf("expected ascending id order, got %d, %d", confirmed[0].ID, confirmed[1].ID)
	}
}

func TestListEventsNeedingManifestRebuildAndMarkCommitted(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	seg := mustClaimQueuedSegment(t, st, "evt1", "s", "k1", 1)
	if err := st.ConfirmUpload(ctx, seg.ID, "r2/k1", time.Now().UTC()); err != nil {
		t.Fatalf("ConfirmUpload() error: %v", err)
	}

	events, err := st.ListEventsNeedingManifestRebuild(ctx)
	if err != nil {
		t.Fatalf("ListEventsNeedingManifestRebuild() error: %v", err)
	}
	if len(events) != 1 || events[0] != "evt1" {
		t.Fatalf("events = %v, want [evt1]", events)
	}

	if err := st.MarkManifestCommitted(ctx, []int64{seg.ID}, time.Now().UTC()); err != nil {
		t.Fatalf("MarkManifestCommitted() error: %v", err)
	}

	events, err = st.ListEventsNeedingManifestRebuild(ctx)
	if err != nil {
		t.Fatalf("ListEventsNeedingManifestRebuild() error: %v", err)
	}
	if len(events) != 0 {
		t.Errorf("expected no events needing rebuild after MarkManifestCommitted, got %v", events)
	}
}

func TestReclaimExpiredUploadLeases(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	seg := mustClaimQueuedSegment(t, st, "e", "s", "k1", 1)

	past := time.Now().UTC().Add(-time.Hour)
	if _, owned, err := st.ClaimUploadableSegment(ctx, "worker-dead", time.Second, past); err != nil || !owned {
		t.Fatalf("claim owned=%v err=%v", owned, err)
	}

	n, err := st.ReclaimExpiredUploadLeases(ctx, time.Now().UTC())
	if err != nil {
		t.Fatalf("ReclaimExpiredUploadLeases() error: %v", err)
	}
	if n != 1 {
		t.Fatalf("reclaimed count = %d, want 1", n)
	}

	got, err := st.GetSegmentByID(ctx, seg.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.UploadStatus != UploadPending || got.UploadLeaseOwner != "" {
		t.Errorf("expected reclaimed segment back to pending with no lease owner, got status=%q owner=%q", got.UploadStatus, got.UploadLeaseOwner)
	}
}
