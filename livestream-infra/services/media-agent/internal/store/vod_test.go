package store

import (
	"context"
	"testing"
	"time"
)

func TestUpsertVODFinalizedIsIdempotent(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	if err := st.UpsertVODFinalized(ctx, "evt1", []int64{1, 2}, 1, "events/pb/vod/index.m3u8", time.Now().UTC()); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}
	if err := st.UpsertVODFinalized(ctx, "evt1", []int64{1, 2, 3}, 1, "events/pb/vod/index.m3u8", time.Now().UTC()); err != nil {
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

	if err := st.UpsertVODFinalized(ctx, "evt1", []int64{1}, 1, "key", time.Now().UTC()); err != nil {
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

func TestListFinalizedEventsEligibleForCleanup(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	longAgo := time.Now().UTC().Add(-48 * time.Hour)
	recent := time.Now().UTC()
	if err := st.UpsertVODFinalized(ctx, "evt-old", []int64{1}, 1, "key1", longAgo); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}
	if err := st.UpsertVODFinalized(ctx, "evt-recent", []int64{1}, 1, "key2", recent); err != nil {
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
