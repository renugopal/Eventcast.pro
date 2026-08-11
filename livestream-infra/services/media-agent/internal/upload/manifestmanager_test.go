package upload

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// confirmSegment marks seg UploadConfirmed in the store and also PUTs a
// matching object into fake, so both manifest tests (which only read
// database state) and VOD finalization tests (which additionally
// HEAD-validate every referenced object against the object store, per
// 02_V1_ARCHITECTURE_SPEC.md "VOD finalization") see a consistent,
// realistic "confirmed" segment.
func confirmSegment(t *testing.T, st *store.Store, fake *fakeObjectStore, seg store.SegmentJob, playbackID string) store.SegmentJob {
	t.Helper()
	ctx := context.Background()
	key := SegmentKey("", playbackID, seg.SessionID, seg.LocalFileIdentity)

	content, err := os.ReadFile(seg.SpoolPath)
	if err != nil {
		t.Fatalf("read spool file %s: %v", seg.SpoolPath, err)
	}
	if err := fake.PutObject(ctx, PutObjectInput{
		Key: key, Body: strings.NewReader(string(content)), Size: int64(len(content)),
		ContentType: contentTypeSegment, Metadata: segmentMetadata(seg),
	}); err != nil {
		t.Fatalf("seed confirmed object: %v", err)
	}

	if err := st.ConfirmUpload(ctx, seg.ID, key, time.Now().UTC()); err != nil {
		t.Fatalf("ConfirmUpload() error: %v", err)
	}
	got, err := st.GetSegmentByID(ctx, seg.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	return got
}

func TestRebuildLiveSkipsWithoutAssignment(t *testing.T) {
	st := openTestStore(t)
	fake := newFakeObjectStore()
	seg := setupQueuedSegment(t, st, "evt1", "sess1", 1, []byte("data"))
	confirmSegment(t, st, fake, seg, "pb1") // key computed but no assignment cached under evt1

	mgr := NewManifestManager(st, fake, ManifestConfig{DVRWindow: 900 * time.Second, RequestTimeout: time.Second}, testLogger(t))
	if err := mgr.RebuildLive(context.Background(), "evt1"); err != nil {
		t.Fatalf("RebuildLive() error: %v", err)
	}
	// The seed PutObject above already used one; RebuildLive itself must
	// not have issued a manifest publish without a resolvable assignment.
	seedPuts, _ := fake.counts()
	if seedPuts != 1 {
		t.Errorf("expected no additional publish without a cached assignment, got %d total PutObject calls", seedPuts)
	}
}

func TestRebuildLivePublishesOnlyConfirmedSegments(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	fake := newFakeObjectStore()

	s1 := setupQueuedSegment(t, st, "evt1", "sess1", 1, []byte("a"))
	s2 := setupQueuedSegment(t, st, "evt1", "sess1", 2, []byte("b"))
	_ = setupQueuedSegment(t, st, "evt1", "sess1", 3, []byte("c")) // left unconfirmed

	confirmSegment(t, st, fake, s1, "pb1")
	confirmSegment(t, st, fake, s2, "pb1")

	mgr := NewManifestManager(st, fake, ManifestConfig{DVRWindow: 900 * time.Second, RequestTimeout: time.Second}, testLogger(t))
	if err := mgr.RebuildLive(ctx, "evt1"); err != nil {
		t.Fatalf("RebuildLive() error: %v", err)
	}

	key := LivePlaylistKey("", "pb1")
	if !fake.has(key) {
		t.Fatalf("expected live manifest object at %q", key)
	}
	body := fakeBody(t, fake, key)
	if strings.Count(body, "#EXTINF") != 2 {
		t.Errorf("expected exactly 2 segments in manifest, got:\n%s", body)
	}
	if !strings.Contains(body, s1.LocalFileIdentity) || !strings.Contains(body, s2.LocalFileIdentity) {
		t.Errorf("expected both confirmed segments referenced by name, got:\n%s", body)
	}
}

func TestRebuildLiveIsIdempotentForUnchangedSegmentSet(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	fake := newFakeObjectStore()
	s1 := setupQueuedSegment(t, st, "evt1", "sess1", 1, []byte("a"))
	confirmSegment(t, st, fake, s1, "pb1")

	mgr := NewManifestManager(st, fake, ManifestConfig{DVRWindow: 900 * time.Second, RequestTimeout: time.Second}, testLogger(t))

	if err := mgr.RebuildLive(ctx, "evt1"); err != nil {
		t.Fatalf("first RebuildLive() error: %v", err)
	}
	firstPut, _ := fake.counts()

	if err := mgr.RebuildLive(ctx, "evt1"); err != nil {
		t.Fatalf("second RebuildLive() error: %v", err)
	}
	secondPut, _ := fake.counts()

	if secondPut != firstPut {
		t.Errorf("expected no additional PutObject for an unchanged segment set: first=%d second=%d", firstPut, secondPut)
	}
}

func TestRebuildLiveRepublishesWhenNewSegmentConfirmed(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	fake := newFakeObjectStore()
	s1 := setupQueuedSegment(t, st, "evt1", "sess1", 1, []byte("a"))
	confirmSegment(t, st, fake, s1, "pb1")

	mgr := NewManifestManager(st, fake, ManifestConfig{DVRWindow: 900 * time.Second, RequestTimeout: time.Second}, testLogger(t))
	if err := mgr.RebuildLive(ctx, "evt1"); err != nil {
		t.Fatalf("first RebuildLive() error: %v", err)
	}
	firstPut, _ := fake.counts()

	s2 := setupQueuedSegment(t, st, "evt1", "sess1", 2, []byte("b"))
	confirmSegment(t, st, fake, s2, "pb1")
	if err := mgr.RebuildLive(ctx, "evt1"); err != nil {
		t.Fatalf("second RebuildLive() error: %v", err)
	}
	secondPut, _ := fake.counts()

	if secondPut <= firstPut {
		t.Errorf("expected a new publish once a new segment confirmed: first=%d second=%d", firstPut, secondPut)
	}
	body := fakeBody(t, fake, LivePlaylistKey("", "pb1"))
	if strings.Count(body, "#EXTINF") != 2 {
		t.Errorf("expected 2 segments after second confirmation, got:\n%s", body)
	}
}

func TestRebuildLiveTrimsToApproximateDVRWindow(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	fake := newFakeObjectStore()

	for i := int64(1); i <= 10; i++ {
		s := setupQueuedSegment(t, st, "evt1", "sess1", i, []byte("x"))
		confirmSegment(t, st, fake, s, "pb1")
	}

	// Each segment defaults to 4s duration (see seg() helper reused via
	// setupQueuedSegment's ClaimSegmentInput.DurationSeconds); an 8s
	// window should keep roughly 2-3 of the 10 confirmed segments.
	mgr := NewManifestManager(st, fake, ManifestConfig{DVRWindow: 8 * time.Second, RequestTimeout: time.Second}, testLogger(t))
	if err := mgr.RebuildLive(ctx, "evt1"); err != nil {
		t.Fatalf("RebuildLive() error: %v", err)
	}

	body := fakeBody(t, fake, LivePlaylistKey("", "pb1"))
	count := strings.Count(body, "#EXTINF")
	if count == 0 || count >= 10 {
		t.Errorf("expected the DVR window to trim the manifest to a small subset of 10 segments, got %d", count)
	}
}

// TestRebuildLiveAddressesSegmentsByTheirOwnPinnedKeyAfterAssignmentRotates
// proves the manifest-side counterpart of the fix in
// TestWorkerUsesSessionPinnedPlaybackIDEvenAfterAssignmentPlaybackIDChanges:
// a live manifest's own object address correctly tracks the event's
// current/enabled assignment playback_id, but every segment URL inside
// it must still resolve to that segment's own already-recorded r2_key -
// never a path reconstructed under the manifest's playback_id - since a
// segment uploaded under an earlier session keeps the playback_id that
// was pinned to it at the time, which can differ once the assignment has
// since rotated to a new playback_id (e.g. a later re-activation).
func TestRebuildLiveAddressesSegmentsByTheirOwnPinnedKeyAfterAssignmentRotates(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)

	importTestAssignment(t, st, "evt1", "ingest1", "pb-old")
	sess := pinTestSession(t, st, "evt1", "ingest1", "pb-old")
	fake := newFakeObjectStore()

	s1 := setupQueuedSegment(t, st, "evt1", sess.ID, 1, []byte("a"))
	confirmSegment(t, st, fake, s1, "pb-old")

	// Simulate a later activation for the same event rotating the cached
	// assignment's playback_id - exactly what the real control-plane sync
	// does on every cycle - while the earlier session's segment remains
	// confirmed only under its own pinned key.
	importTestAssignment(t, st, "evt1", "ingest1", "pb-new")

	mgr := NewManifestManager(st, fake, ManifestConfig{DVRWindow: 900 * time.Second, RequestTimeout: time.Second}, testLogger(t))
	if err := mgr.RebuildLive(ctx, "evt1"); err != nil {
		t.Fatalf("RebuildLive() error: %v", err)
	}

	// The manifest's own object address correctly tracks the event's
	// current/enabled assignment playback_id.
	manifestKey := LivePlaylistKey("", "pb-new")
	if !fake.has(manifestKey) {
		t.Fatalf("expected live manifest object at %q", manifestKey)
	}
	body := fakeBody(t, fake, manifestKey)

	wantSegmentKey := SegmentKey("", "pb-old", sess.ID, s1.LocalFileIdentity)
	if !strings.Contains(body, wantSegmentKey) {
		t.Errorf("manifest does not reference the segment's actual key %q:\n%s", wantSegmentKey, body)
	}
	unwantedSegmentKey := SegmentKey("", "pb-new", sess.ID, s1.LocalFileIdentity)
	if strings.Contains(body, unwantedSegmentKey) {
		t.Errorf("manifest must not reference a reconstructed key under the rotated playback_id %q:\n%s", unwantedSegmentKey, body)
	}
}

func fakeBody(t *testing.T, fake *fakeObjectStore, key string) string {
	t.Helper()
	fake.mu.Lock()
	defer fake.mu.Unlock()
	obj, ok := fake.objects[key]
	if !ok {
		t.Fatalf("no object recorded at key %q", key)
	}
	return obj.body
}
