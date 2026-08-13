package upload

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// archiveFixture builds a realistic confirmed-and-finalized event: a
// pinned session, two confirmed segments uploaded to the R2 fake, and a
// local VOD finalization on record.
type archiveFixture struct {
	store     *store.Store
	b2        *fakeObjectStore
	archiver  *B2Archiver
	eventID   string
	sessionID string
	confirmed []store.SegmentJob
}

func newArchiveFixture(t *testing.T) *archiveFixture {
	t.Helper()
	ctx := context.Background()
	logger := testLogger(t)

	st := openTestStore(t)
	const eventID, ingestID, playbackID = "evt-1", "ing-1", "pb-1"
	importTestAssignment(t, st, eventID, ingestID, playbackID)
	sess := pinTestSession(t, st, eventID, ingestID, playbackID)

	r2 := newFakeObjectStore()
	worker := testWorker(st, r2, logger)
	setupQueuedSegment(t, st, eventID, sess.ID, 1, []byte("segment-one"))
	setupQueuedSegment(t, st, eventID, sess.ID, 2, []byte("segment-two"))
	for i := 0; i < 2; i++ {
		if _, err := worker.processOnce(ctx, "w"); err != nil {
			t.Fatalf("processOnce() error: %v", err)
		}
	}

	confirmed, err := st.ListConfirmedSegmentsByEvent(ctx, eventID)
	if err != nil {
		t.Fatalf("ListConfirmedSegmentsByEvent() error: %v", err)
	}
	if len(confirmed) != 2 {
		t.Fatalf("confirmed segments = %d, want 2", len(confirmed))
	}

	if err := st.UpsertVODFinalized(ctx, eventID, idsOf(confirmed), 1, "r2-vod-key", 0, time.Now().UTC()); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}

	b2 := newFakeObjectStore()
	archiver := NewB2Archiver(st, b2, B2ArchiveConfig{
		Bucket:         "eventcast-vod-test",
		RequestTimeout: 5 * time.Second,
	}, logger)

	return &archiveFixture{store: st, b2: b2, archiver: archiver, eventID: eventID, sessionID: sess.ID, confirmed: confirmed}
}

func (f *archiveFixture) generation() string { return FinalizationGeneration(f.confirmed) }

func TestB2ArchiverUploadsEverySegmentAndTheGenerationPlaylist(t *testing.T) {
	f := newArchiveFixture(t)
	gen := f.generation()

	result, err := f.archiver.ArchiveEvent(context.Background(), f.eventID, gen)
	if err != nil {
		t.Fatalf("ArchiveEvent() error: %v", err)
	}
	if !result.Archived {
		t.Fatalf("ArchiveEvent() did not archive: %s", result.Reason)
	}
	if want := 3; result.ObjectCount != want { // two segments plus the playlist
		t.Errorf("ObjectCount = %d, want %d", result.ObjectCount, want)
	}
	if result.PlaylistKey != B2VODPlaylistKey("", f.eventID, gen) {
		t.Errorf("PlaylistKey = %q, want the generation-specific key", result.PlaylistKey)
	}

	for _, s := range f.confirmed {
		key := B2SegmentKey("", f.eventID, s.SessionID, s.SHA256, s.LocalFileIdentity)
		if _, ok := f.b2.objects[key]; !ok {
			t.Errorf("segment object missing from B2 at %q", key)
		}
	}
}

// Idempotency: re-running must re-verify existing content-addressed
// objects rather than re-uploading them, which is what makes a retry after
// a crash cheap and safe.
func TestB2ArchiverReusesMatchingContentAddressedObjects(t *testing.T) {
	f := newArchiveFixture(t)
	ctx := context.Background()
	gen := f.generation()

	if _, err := f.archiver.ArchiveEvent(ctx, f.eventID, gen); err != nil {
		t.Fatalf("first ArchiveEvent() error: %v", err)
	}
	firstPuts := f.b2.putCount

	if _, err := f.archiver.ArchiveEvent(ctx, f.eventID, gen); err != nil {
		t.Fatalf("second ArchiveEvent() error: %v", err)
	}

	// Only the playlist is rewritten; the two segments are reused.
	if got, want := f.b2.putCount-firstPuts, 1; got != want {
		t.Errorf("second pass performed %d PUTs, want %d (segments must be reused)", got, want)
	}
}

// A content-addressed key whose stored object does NOT match is an
// invariant violation. Overwriting it could mutate bytes underneath a
// previously verified generation's playlist, so it must fail closed.
func TestB2ArchiverFailsClosedOnContentAddressMismatchAndNeverOverwrites(t *testing.T) {
	f := newArchiveFixture(t)
	ctx := context.Background()

	victim := f.confirmed[0]
	key := B2SegmentKey("", f.eventID, victim.SessionID, victim.SHA256, victim.LocalFileIdentity)
	f.b2.objects[key] = fakeObject{
		body:     "not the same bytes",
		size:     victim.ByteSize + 5,
		metadata: map[string]string{"sha256": "some-other-digest"},
	}
	putsBefore := f.b2.putCount

	_, err := f.archiver.ArchiveEvent(ctx, f.eventID, f.generation())
	if !errors.Is(err, ErrB2ContentAddressMismatch) {
		t.Fatalf("ArchiveEvent() error = %v, want ErrB2ContentAddressMismatch", err)
	}
	if f.b2.putCount != putsBefore {
		t.Error("archiver overwrote a mismatched content-addressed object instead of failing closed")
	}
	if f.b2.objects[key].body != "not the same bytes" {
		t.Error("pre-existing object was modified")
	}
}

// The spool is the archiver's only byte source. Losing it must surface as
// a failure, never as a silent success that would let the retention gate
// release the remaining copies.
func TestB2ArchiverFailsWhenTheSpoolByteSourceIsMissing(t *testing.T) {
	f := newArchiveFixture(t)
	ctx := context.Background()

	if err := removeFile(f.confirmed[0].SpoolPath); err != nil {
		t.Fatalf("remove spool file: %v", err)
	}

	result, err := f.archiver.ArchiveEvent(ctx, f.eventID, f.generation())
	if err == nil {
		t.Fatalf("ArchiveEvent() unexpectedly succeeded: %+v", result)
	}
	if !strings.Contains(err.Error(), "spool") {
		t.Errorf("error = %v, want it to identify the missing spool source", err)
	}
}

// A generation that no longer matches durable state describes a superseded
// segment set and must never be recorded as authoritative.
func TestB2ArchiverReportsSupersededForAStaleGeneration(t *testing.T) {
	f := newArchiveFixture(t)

	result, err := f.archiver.ArchiveEvent(context.Background(), f.eventID, "a-generation-that-never-existed")
	if err != nil {
		t.Fatalf("ArchiveEvent() error: %v", err)
	}
	if !result.Superseded {
		t.Errorf("result = %+v, want Superseded for a stale generation", result)
	}
	if result.Archived {
		t.Error("a stale generation must never be reported as archived")
	}
}

// Two generations of the same event share unchanged segment objects but
// must never share a playlist key.
func TestB2ArchiverKeepsGenerationPlaylistsSeparateWhileSharingSegments(t *testing.T) {
	f := newArchiveFixture(t)
	ctx := context.Background()

	genA := f.generation()
	if _, err := f.archiver.ArchiveEvent(ctx, f.eventID, genA); err != nil {
		t.Fatalf("ArchiveEvent(genA) error: %v", err)
	}

	// A late segment confirms, producing a genuinely new generation.
	setupQueuedSegment(t, f.store, f.eventID, f.sessionID, 3, []byte("segment-three"))
	worker := testWorker(f.store, newFakeObjectStore(), testLogger(t))
	if _, err := worker.processOnce(ctx, "w"); err != nil {
		t.Fatalf("processOnce() error: %v", err)
	}
	confirmed, err := f.store.ListConfirmedSegmentsByEvent(ctx, f.eventID)
	if err != nil {
		t.Fatalf("ListConfirmedSegmentsByEvent() error: %v", err)
	}
	genB := FinalizationGeneration(confirmed)
	if genA == genB {
		t.Fatal("adding a segment did not change the generation")
	}

	if _, err := f.archiver.ArchiveEvent(ctx, f.eventID, genB); err != nil {
		t.Fatalf("ArchiveEvent(genB) error: %v", err)
	}

	if _, ok := f.b2.objects[B2VODPlaylistKey("", f.eventID, genA)]; !ok {
		t.Error("generation A's playlist was destroyed by generation B")
	}
	if _, ok := f.b2.objects[B2VODPlaylistKey("", f.eventID, genB)]; !ok {
		t.Error("generation B's playlist was not written")
	}
}

// removeFile deletes one file, used to simulate the spool byte source
// disappearing before archival.
func removeFile(path string) error { return os.Remove(path) }
