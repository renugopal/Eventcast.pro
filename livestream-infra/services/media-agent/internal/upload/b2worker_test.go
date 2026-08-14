package upload

import (
	"context"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

func testB2Worker(f *archiveFixture, t *testing.T) *B2ArchiveWorker {
	return NewB2ArchiveWorker(f.store, f.archiver, B2ArchiveWorkerConfig{
		RetryBaseDelay: time.Millisecond,
		RetryMaxDelay:  10 * time.Millisecond,
		LeaseDuration:  time.Minute,
	}, testLogger(t))
}

// Finalization must only ENQUEUE. If it uploaded synchronously, a slow
// transfer or a B2 outage would hold the operator's finalize request open.
func TestFinalizeEnqueuesArchiveWorkWithoutUploading(t *testing.T) {
	f := newArchiveFixture(t)
	ctx := context.Background()

	if err := NewB2Enqueuer(f.store).Enqueue(ctx, f.eventID); err != nil {
		t.Fatalf("Enqueue() error: %v", err)
	}

	if f.b2.putCount != 0 {
		t.Errorf("enqueue performed %d B2 uploads, want 0", f.b2.putCount)
	}
	archive, found, err := f.store.GetB2Archive(ctx, f.eventID)
	if err != nil || !found {
		t.Fatalf("GetB2Archive() error=%v found=%v", err, found)
	}
	if archive.State != store.B2ArchivePending {
		t.Errorf("state = %q, want pending", archive.State)
	}
	if archive.Generation != f.generation() {
		t.Errorf("generation = %q, want the current finalized generation", archive.Generation)
	}
	if len(archive.CoveredPlaybackIDs) != 1 || archive.CoveredPlaybackIDs[0] != "pb-1" {
		t.Errorf("covered playback ids = %v, want [pb-1]", archive.CoveredPlaybackIDs)
	}
}

func TestB2ArchiveWorkerDrainsPendingWork(t *testing.T) {
	f := newArchiveFixture(t)
	ctx := context.Background()

	if err := NewB2Enqueuer(f.store).Enqueue(ctx, f.eventID); err != nil {
		t.Fatalf("Enqueue() error: %v", err)
	}
	testB2Worker(f, t).RunOnce(ctx)

	archive, _, err := f.store.GetB2Archive(ctx, f.eventID)
	if err != nil {
		t.Fatalf("GetB2Archive() error: %v", err)
	}
	if archive.State != store.B2ArchiveArchived {
		t.Fatalf("state = %q, want archived", archive.State)
	}
	if archive.PlaylistKey != B2VODPlaylistKey("", f.eventID, archive.Generation) {
		t.Errorf("playlist key = %q, want the generation-specific key", archive.PlaylistKey)
	}
	// This fixture runs the default "none" integrity mode, where archival
	// completing is NOT byte-integrity proof and must never be recorded as
	// such - retention freeze depends on this staying false.
	if archive.StrongVerified {
		t.Error("archival success under mode none was recorded as strong byte-integrity verification")
	}
}

// A pass interrupted mid-flight must be recoverable: the row is left
// claimable once its lease expires, and archival is idempotent.
func TestB2ArchiveWorkerRecoversAnInterruptedPassAfterRestart(t *testing.T) {
	f := newArchiveFixture(t)
	ctx := context.Background()

	if err := NewB2Enqueuer(f.store).Enqueue(ctx, f.eventID); err != nil {
		t.Fatalf("Enqueue() error: %v", err)
	}

	// Simulate a crash after claiming but before completing.
	if _, _, err := f.store.ClaimB2ArchiveWork(ctx, time.Now().UTC(), time.Millisecond); err != nil {
		t.Fatalf("ClaimB2ArchiveWork() error: %v", err)
	}
	time.Sleep(5 * time.Millisecond)

	testB2Worker(f, t).RunOnce(ctx)

	archive, _, err := f.store.GetB2Archive(ctx, f.eventID)
	if err != nil {
		t.Fatalf("GetB2Archive() error: %v", err)
	}
	if archive.State != store.B2ArchiveArchived {
		t.Errorf("state = %q, want archived after restart recovery", archive.State)
	}
}

// Repeated operator finalize calls for the same unchanged generation must
// converge on the one row rather than enqueuing competing jobs.
func TestDuplicateFinalizeDoesNotEnqueueCompetingWork(t *testing.T) {
	f := newArchiveFixture(t)
	ctx := context.Background()
	enqueuer := NewB2Enqueuer(f.store)

	if err := enqueuer.Enqueue(ctx, f.eventID); err != nil {
		t.Fatalf("Enqueue() error: %v", err)
	}
	testB2Worker(f, t).RunOnce(ctx)
	putsAfterFirst := f.b2.putCount

	// A second finalize for the identical generation.
	if err := enqueuer.Enqueue(ctx, f.eventID); err != nil {
		t.Fatalf("second Enqueue() error: %v", err)
	}
	archive, _, err := f.store.GetB2Archive(ctx, f.eventID)
	if err != nil {
		t.Fatalf("GetB2Archive() error: %v", err)
	}
	if archive.State != store.B2ArchiveArchived {
		t.Errorf("state = %q, want the completed archive left untouched", archive.State)
	}

	testB2Worker(f, t).RunOnce(ctx)
	if f.b2.putCount != putsAfterFirst {
		t.Errorf("a duplicate finalize caused %d extra uploads, want 0", f.b2.putCount-putsAfterFirst)
	}
}

// An event with no confirmed segments must not acquire archival history:
// doing so would permanently hold its spool under the fail-closed gate.
func TestEnqueueCreatesNoArchiveRowWithoutConfirmedSegments(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	if err := NewB2Enqueuer(st).Enqueue(ctx, "evt-with-nothing"); err != nil {
		t.Fatalf("Enqueue() error: %v", err)
	}
	if _, found, err := st.GetB2Archive(ctx, "evt-with-nothing"); err != nil {
		t.Fatalf("GetB2Archive() error: %v", err)
	} else if found {
		t.Error("an archive row was created for an event with no confirmed segments")
	}
}
