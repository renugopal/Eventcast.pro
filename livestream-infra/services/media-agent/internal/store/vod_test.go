package store

import (
	"context"
	"testing"
	"time"
)

func TestUpsertVODFinalizedIsIdempotent(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	if err := st.UpsertVODFinalized(ctx, "evt1", []int64{1, 2}, 1, "events/pb/vod/index.m3u8", 0, time.Now().UTC()); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}
	if err := st.UpsertVODFinalized(ctx, "evt1", []int64{1, 2, 3}, 1, "events/pb/vod/index.m3u8", 0, time.Now().UTC()); err != nil {
		t.Fatalf("second UpsertVODFinalized() error: %v", err)
	}

	got, found, err := st.GetVODFinalization(ctx, "evt1")
	if err != nil || !found {
		t.Fatalf("GetVODFinalization() found=%v err=%v", found, err)
	}
	if got.Status != VODFinalized || len(got.SegmentIDs) != 3 {
		t.Errorf("got = %+v, want status=finalized with 3 segment ids", got)
	}
}

func TestUpsertVODFailedThenFinalizedOverwrites(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	if err := st.UpsertVODFailed(ctx, "evt1", "object store unavailable", time.Now().UTC()); err != nil {
		t.Fatalf("UpsertVODFailed() error: %v", err)
	}
	got, found, err := st.GetVODFinalization(ctx, "evt1")
	if err != nil || !found {
		t.Fatalf("GetVODFinalization() found=%v err=%v", found, err)
	}
	if got.Status != VODFailed || got.LastError == "" {
		t.Errorf("got = %+v, want status=failed with a non-empty last_error", got)
	}

	if err := st.UpsertVODFinalized(ctx, "evt1", []int64{1}, 1, "key", 0, time.Now().UTC()); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}
	got, found, err = st.GetVODFinalization(ctx, "evt1")
	if err != nil || !found {
		t.Fatalf("GetVODFinalization() found=%v err=%v", found, err)
	}
	if got.Status != VODFinalized || got.LastError != "" {
		t.Errorf("got = %+v, want status=finalized with last_error cleared", got)
	}
}

func TestUpsertVODFinalizedRecordsGapState(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	if err := st.UpsertVODFinalized(ctx, "evt-gap", []int64{1, 2}, 1, "key", 2, time.Now().UTC()); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}
	got, found, err := st.GetVODFinalization(ctx, "evt-gap")
	if err != nil || !found {
		t.Fatalf("GetVODFinalization() found=%v err=%v", found, err)
	}
	if got.GapCount != 2 || got.GapStatus != VODGapPendingReview {
		t.Errorf("got = %+v, want gap_count=2 gap_status=pending_review", got)
	}

	if err := st.UpsertVODFinalized(ctx, "evt-nogap", []int64{1}, 1, "key2", 0, time.Now().UTC()); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}
	gotClean, found, err := st.GetVODFinalization(ctx, "evt-nogap")
	if err != nil || !found {
		t.Fatalf("GetVODFinalization() found=%v err=%v", found, err)
	}
	if gotClean.GapStatus != VODGapNone {
		t.Errorf("GapStatus = %q, want %q for a gapless finalization", gotClean.GapStatus, VODGapNone)
	}
}

func TestResolveVODGapAcknowledgeIsIdempotent(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	now := time.Now().UTC()

	if err := st.UpsertVODFinalized(ctx, "evt-gap", []int64{1}, 1, "key", 1, now); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}

	first, err := st.ResolveVODGap(ctx, "evt-gap", VODGapActionAcknowledge, "operator-1", "reviewed manually", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("ResolveVODGap() error: %v", err)
	}
	if first.GapStatus != VODGapAcknowledged || first.GapResolutionActor != "operator-1" {
		t.Errorf("got = %+v, want acknowledged by operator-1", first)
	}

	// Repeating the same action must succeed idempotently (still audited,
	// but not an error and not a conflicting-resolution failure).
	second, err := st.ResolveVODGap(ctx, "evt-gap", VODGapActionAcknowledge, "operator-2", "double-checked", now.Add(2*time.Minute))
	if err != nil {
		t.Fatalf("repeat ResolveVODGap() error: %v", err)
	}
	if second.GapStatus != VODGapAcknowledged {
		t.Errorf("GapStatus = %q after repeat, want acknowledged", second.GapStatus)
	}

	var auditCount int
	if err := st.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM vod_gap_audit WHERE event_id = ?`, "evt-gap").Scan(&auditCount); err != nil {
		t.Fatalf("count vod_gap_audit rows: %v", err)
	}
	if auditCount != 2 {
		t.Errorf("audit row count = %d, want 2 (one per resolution attempt)", auditCount)
	}
}

func TestResolveVODGapRejectsConflictingResolution(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	now := time.Now().UTC()

	if err := st.UpsertVODFinalized(ctx, "evt-gap", []int64{1}, 1, "key", 1, now); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}
	if _, err := st.ResolveVODGap(ctx, "evt-gap", VODGapActionAcknowledge, "operator-1", "ok", now.Add(time.Minute)); err != nil {
		t.Fatalf("ResolveVODGap() error: %v", err)
	}

	if _, err := st.ResolveVODGap(ctx, "evt-gap", VODGapActionReject, "operator-2", "changed my mind", now.Add(2*time.Minute)); err != ErrGapAlreadyResolvedDifferently {
		t.Errorf("ResolveVODGap() error = %v, want ErrGapAlreadyResolvedDifferently", err)
	}
}

func TestResolveVODGapRequiresAPendingGap(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	now := time.Now().UTC()

	if _, err := st.ResolveVODGap(ctx, "no-such-event", VODGapActionAcknowledge, "operator-1", "ok", now); err != ErrNoGapPending {
		t.Errorf("ResolveVODGap() error = %v, want ErrNoGapPending for an unknown event", err)
	}

	if err := st.UpsertVODFinalized(ctx, "evt-clean", []int64{1}, 1, "key", 0, now); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}
	if _, err := st.ResolveVODGap(ctx, "evt-clean", VODGapActionAcknowledge, "operator-1", "ok", now); err != ErrNoGapPending {
		t.Errorf("ResolveVODGap() error = %v, want ErrNoGapPending for a gapless finalization", err)
	}
}

func TestListFinalizedEventsEligibleForCleanup(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	longAgo := time.Now().UTC().Add(-48 * time.Hour)
	recent := time.Now().UTC()
	if err := st.UpsertVODFinalized(ctx, "evt-old", []int64{1}, 1, "key1", 0, longAgo); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}
	if err := st.UpsertVODFinalized(ctx, "evt-recent", []int64{1}, 1, "key2", 0, recent); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}

	cutoff := time.Now().UTC().Add(-24 * time.Hour)
	eligible, err := st.ListFinalizedEventsEligibleForCleanup(ctx, cutoff)
	if err != nil {
		t.Fatalf("ListFinalizedEventsEligibleForCleanup() error: %v", err)
	}
	if len(eligible) != 1 || eligible[0] != "evt-old" {
		t.Errorf("eligible = %v, want [evt-old]", eligible)
	}
}
