package store

import (
	"context"
	"testing"
	"time"
)

func enqueueTestArchive(t *testing.T, st *Store, eventID, generation string) B2Archive {
	t.Helper()
	a, err := st.EnqueueB2Archive(context.Background(), EnqueueB2ArchiveInput{
		EventID:            eventID,
		Generation:         generation,
		CoveredPlaybackIDs: []string{"pb-1"},
		GapStatus:          VODGapNone,
		LocalFinalizedAt:   time.Now().UTC(),
	}, time.Now().UTC())
	if err != nil {
		t.Fatalf("EnqueueB2Archive() error: %v", err)
	}
	return a
}

// Repeated operator finalize calls must not reset completed work or create
// competing jobs.
func TestEnqueueB2ArchiveIsANoOpForAnUnchangedGeneration(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	enqueueTestArchive(t, st, "evt-1", "gen-a")
	if _, err := st.MarkB2Archived(ctx, "evt-1", "gen-a", "bucket", "playlist-key", 3, false, time.Now().UTC()); err != nil {
		t.Fatalf("MarkB2Archived() error: %v", err)
	}

	again := enqueueTestArchive(t, st, "evt-1", "gen-a")
	if again.State != B2ArchiveArchived {
		t.Errorf("state = %q, want the completed archive to be left untouched", again.State)
	}
	if again.PlaylistKey != "playlist-key" {
		t.Errorf("playlist key = %q, want it preserved", again.PlaylistKey)
	}
}

// A newer generation must converge the single row forward and discard
// evidence that describes the superseded segment set.
func TestEnqueueB2ArchiveConvergesToANewerGeneration(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	enqueueTestArchive(t, st, "evt-1", "gen-a")
	if _, err := st.MarkB2Archived(ctx, "evt-1", "gen-a", "bucket", "playlist-a", 3, false, time.Now().UTC()); err != nil {
		t.Fatalf("MarkB2Archived() error: %v", err)
	}

	converged := enqueueTestArchive(t, st, "evt-1", "gen-b")
	if converged.Generation != "gen-b" {
		t.Errorf("generation = %q, want gen-b", converged.Generation)
	}
	if converged.State != B2ArchivePending {
		t.Errorf("state = %q, want pending after convergence", converged.State)
	}
	if converged.PlaylistKey != "" {
		t.Errorf("playlist key = %q, want stale evidence cleared", converged.PlaylistKey)
	}
	if converged.ReportedGeneration != "" {
		t.Error("report progress for the superseded generation was not cleared")
	}
}

// The generation guard is what prevents a slow archival pass from
// recording stale work as authoritative after the row moved on.
func TestMarkB2ArchivedRejectsAStaleGeneration(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	enqueueTestArchive(t, st, "evt-1", "gen-b")
	applied, err := st.MarkB2Archived(ctx, "evt-1", "gen-a", "bucket", "playlist-a", 3, false, time.Now().UTC())
	if err != nil {
		t.Fatalf("MarkB2Archived() error: %v", err)
	}
	if applied {
		t.Error("a completed pass for a superseded generation was accepted as authoritative")
	}
}

func TestClaimB2ArchiveWorkIsExclusive(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	enqueueTestArchive(t, st, "evt-1", "gen-a")

	first, found, err := st.ClaimB2ArchiveWork(ctx, time.Now().UTC(), 15*time.Minute)
	if err != nil || !found {
		t.Fatalf("ClaimB2ArchiveWork() error=%v found=%v", err, found)
	}
	if first.EventID != "evt-1" {
		t.Errorf("claimed %q, want evt-1", first.EventID)
	}

	// Already claimed and in flight: a second worker must not pick it up
	// until its retry time elapses.
	if _, found, err = st.ClaimB2ArchiveWork(ctx, time.Now().UTC(), 15*time.Minute); err != nil {
		t.Fatalf("second ClaimB2ArchiveWork() error: %v", err)
	} else if found {
		t.Error("a second worker claimed an archive already in flight")
	}
}

// --- Spool retention gate -------------------------------------------------

func finalizeForCleanup(t *testing.T, st *Store, eventID string) {
	t.Helper()
	old := time.Now().UTC().Add(-48 * time.Hour)
	if err := st.UpsertVODFinalized(context.Background(), eventID, []int64{1}, 1, "r2-key", 0, old); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}
}

func eligibleIDs(t *testing.T, st *Store, b2Enabled bool) []string {
	t.Helper()
	cutoff := time.Now().UTC().Add(-24 * time.Hour)
	ids, err := st.ListFinalizedEventsEligibleForCleanup(context.Background(), cutoff, b2Enabled)
	if err != nil {
		t.Fatalf("ListFinalizedEventsEligibleForCleanup() error: %v", err)
	}
	return ids
}

// With archival off and no archival history, behavior must be exactly the
// original 24-hour rule.
func TestSpoolGateKeepsLegacyBehaviorWhenB2NeverStarted(t *testing.T) {
	st := openTestStore(t)
	finalizeForCleanup(t, st, "evt-legacy")

	ids := eligibleIDs(t, st, false)
	if len(ids) != 1 || ids[0] != "evt-legacy" {
		t.Errorf("eligible = %v, want [evt-legacy] under the legacy rule", ids)
	}
}

// Turning archival off must never become a data-destruction path for work
// that already began.
func TestSpoolGateStillHoldsAnEventWhoseArchivalStartedEvenAfterB2IsDisabled(t *testing.T) {
	st := openTestStore(t)
	finalizeForCleanup(t, st, "evt-started")
	enqueueTestArchive(t, st, "evt-started", "gen-a")

	if ids := eligibleIDs(t, st, false); len(ids) != 0 {
		t.Errorf("eligible = %v, want none: archival history must not fall back to the legacy rule", ids)
	}
}

// With archival enabled, an incomplete archive retains the spool - which is
// exactly what stops enabling archival from destroying the only byte
// source while strong verification is still unproven.
func TestSpoolGateRetainsWhileArchiveIsIncomplete(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	finalizeForCleanup(t, st, "evt-1")
	enqueueTestArchive(t, st, "evt-1", "gen-a")

	if ids := eligibleIDs(t, st, true); len(ids) != 0 {
		t.Fatalf("eligible = %v, want none while archival is incomplete", ids)
	}

	// Archived, but neither reported nor strongly verified.
	if _, err := st.MarkB2Archived(ctx, "evt-1", "gen-a", "bucket", "playlist", 3, false, time.Now().UTC()); err != nil {
		t.Fatalf("MarkB2Archived() error: %v", err)
	}
	if ids := eligibleIDs(t, st, true); len(ids) != 0 {
		t.Errorf("eligible = %v, want none: archived alone is not sufficient", ids)
	}

	// Reported, but still not strongly verified - the state this package
	// deliberately stops at until a real integrity mechanism is proven.
	if err := st.MarkB2Reported(ctx, "evt-1", "gen-a", B2ArchiveArchived, time.Now().UTC()); err != nil {
		t.Fatalf("MarkB2Reported() error: %v", err)
	}
	if ids := eligibleIDs(t, st, true); len(ids) != 0 {
		t.Errorf("eligible = %v, want none without strong byte-integrity verification", ids)
	}
}

// Full release requires archived + acknowledged + strongly verified for the
// CURRENT generation, with an acceptable gap state.
func TestSpoolGateReleasesOnlyWhenEveryConditionHolds(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	finalizeForCleanup(t, st, "evt-1")
	enqueueTestArchive(t, st, "evt-1", "gen-a")

	// Records strong verification through the real production path (a
	// strong integrity mode having proven this generation's bytes) rather
	// than simulating it with a raw UPDATE.
	if _, err := st.MarkB2Archived(ctx, "evt-1", "gen-a", "bucket", "playlist", 3, true, time.Now().UTC()); err != nil {
		t.Fatalf("MarkB2Archived() error: %v", err)
	}
	if err := st.MarkB2Reported(ctx, "evt-1", "gen-a", B2ArchiveArchived, time.Now().UTC()); err != nil {
		t.Fatalf("MarkB2Reported() error: %v", err)
	}

	ids := eligibleIDs(t, st, true)
	if len(ids) != 1 || ids[0] != "evt-1" {
		t.Errorf("eligible = %v, want [evt-1] once every condition holds", ids)
	}
}

// An unresolved gap means the recording is known to be incomplete, so the
// only remaining local copy must be retained.
func TestSpoolGateRetainsOnAnUnresolvedGap(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	finalizeForCleanup(t, st, "evt-1")

	if _, err := st.EnqueueB2Archive(ctx, EnqueueB2ArchiveInput{
		EventID:            "evt-1",
		Generation:         "gen-a",
		CoveredPlaybackIDs: []string{"pb-1"},
		GapCount:           2,
		GapStatus:          VODGapPendingReview,
	}, time.Now().UTC()); err != nil {
		t.Fatalf("EnqueueB2Archive() error: %v", err)
	}
	if _, err := st.MarkB2Archived(ctx, "evt-1", "gen-a", "bucket", "playlist", 3, true, time.Now().UTC()); err != nil {
		t.Fatalf("MarkB2Archived() error: %v", err)
	}
	if err := st.MarkB2Reported(ctx, "evt-1", "gen-a", B2ArchiveArchived, time.Now().UTC()); err != nil {
		t.Fatalf("MarkB2Reported() error: %v", err)
	}

	if ids := eligibleIDs(t, st, true); len(ids) != 0 {
		t.Errorf("eligible = %v, want none while a gap is pending_review", ids)
	}
}
