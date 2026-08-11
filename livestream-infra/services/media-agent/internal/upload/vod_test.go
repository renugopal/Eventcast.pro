package upload

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

func testVODFinalizer(t *testing.T, st *store.Store, fake *fakeObjectStore) *VODFinalizer {
	return NewVODFinalizer(st, fake, ManifestConfig{RequestTimeout: 5 * time.Second}, testLogger(t))
}

func TestFinalizeBlocksOnActiveSession(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	if _, err := st.CreateSession(ctx, "evt1", "ingest1", "pb-1", time.Now()); err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}

	f := testVODFinalizer(t, st, newFakeObjectStore())
	result, err := f.Finalize(ctx, "evt1")
	if err != nil {
		t.Fatalf("Finalize() error: %v", err)
	}
	if result.Finalized {
		t.Fatalf("expected Finalized=false while a session is still active, reason=%q", result.Reason)
	}
}

func TestFinalizeBlocksOnUnresolvedSegments(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	sess, err := st.CreateSession(ctx, "evt1", "ingest1", "pb-1", time.Now())
	if err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}
	if err := st.MarkDisconnected(ctx, sess.ID, store.EndReasonUnpublish, time.Now()); err != nil {
		t.Fatalf("MarkDisconnected() error: %v", err)
	}

	// A segment still "capturing" (durable capture never completed nor
	// failed) must block finalization.
	if _, _, err := st.ClaimSegment(ctx, store.ClaimSegmentInput{
		IdempotencyKey: "evt1|sess-x|still-capturing", EventID: "evt1", SessionID: sess.ID,
		LocalFileIdentity: "still-capturing", SeqNo: 1, DurationSeconds: 4,
	}); err != nil {
		t.Fatalf("ClaimSegment() error: %v", err)
	}

	f := testVODFinalizer(t, st, newFakeObjectStore())
	result, err := f.Finalize(ctx, "evt1")
	if err != nil {
		t.Fatalf("Finalize() error: %v", err)
	}
	if result.Finalized {
		t.Fatalf("expected Finalized=false with an unresolved segment, reason=%q", result.Reason)
	}
}

func TestFinalizeBuildsPlayableEndlistPlaylist(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	sess, err := st.CreateSession(ctx, "evt1", "ingest1", "pb-1", time.Now())
	if err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}

	fake := newFakeObjectStore()
	s1 := setupQueuedSegment(t, st, "evt1", sess.ID, 1, []byte("a"))
	s2 := setupQueuedSegment(t, st, "evt1", sess.ID, 2, []byte("b"))
	confirmSegment(t, st, fake, s1, "pb1")
	confirmSegment(t, st, fake, s2, "pb1")

	if err := st.MarkDisconnected(ctx, sess.ID, store.EndReasonUnpublish, time.Now()); err != nil {
		t.Fatalf("MarkDisconnected() error: %v", err)
	}

	f := testVODFinalizer(t, st, fake)
	result, err := f.Finalize(ctx, "evt1")
	if err != nil {
		t.Fatalf("Finalize() error: %v", err)
	}
	if !result.Finalized {
		t.Fatalf("expected Finalized=true, reason=%q", result.Reason)
	}

	body := fakeBody(t, fake, VODPlaylistKey("", "pb1"))
	if !strings.Contains(body, "#EXT-X-ENDLIST") {
		t.Errorf("expected ENDLIST in finalized VOD playlist:\n%s", body)
	}
	if strings.Count(body, "#EXTINF") != 2 {
		t.Errorf("expected 2 segments in finalized playlist, got:\n%s", body)
	}

	fin, found, err := st.GetVODFinalization(ctx, "evt1")
	if err != nil || !found {
		t.Fatalf("GetVODFinalization() found=%v err=%v", found, err)
	}
	if fin.Status != store.VODFinalized {
		t.Errorf("finalization status = %q, want %q", fin.Status, store.VODFinalized)
	}
}

func TestFinalizeIsIdempotentForUnchangedSet(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	sess, err := st.CreateSession(ctx, "evt1", "ingest1", "pb-1", time.Now())
	if err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}
	fake := newFakeObjectStore()
	s1 := setupQueuedSegment(t, st, "evt1", sess.ID, 1, []byte("a"))
	confirmSegment(t, st, fake, s1, "pb1")
	if err := st.MarkDisconnected(ctx, sess.ID, store.EndReasonUnpublish, time.Now()); err != nil {
		t.Fatalf("MarkDisconnected() error: %v", err)
	}

	f := testVODFinalizer(t, st, fake)

	if _, err := f.Finalize(ctx, "evt1"); err != nil {
		t.Fatalf("first Finalize() error: %v", err)
	}
	firstPut, _ := fake.counts()

	result, err := f.Finalize(ctx, "evt1")
	if err != nil {
		t.Fatalf("second Finalize() error: %v", err)
	}
	if !result.Finalized {
		t.Fatalf("expected repeat Finalize() to report Finalized=true, reason=%q", result.Reason)
	}
	secondPut, _ := fake.counts()
	if secondPut != firstPut {
		t.Errorf("expected no additional publish for an unchanged finalized set: first=%d second=%d", firstPut, secondPut)
	}
}

func TestFinalizeProceedsPastDeadLetteredGap(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	sess, err := st.CreateSession(ctx, "evt1", "ingest1", "pb-1", time.Now())
	if err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}

	fake := newFakeObjectStore()
	s1 := setupQueuedSegment(t, st, "evt1", sess.ID, 1, []byte("a"))
	confirmSegment(t, st, fake, s1, "pb1")

	// A second segment permanently failed upload (e.g. local corruption
	// detected) - a real gap, but must not block finalization.
	s2 := setupQueuedSegment(t, st, "evt1", sess.ID, 2, []byte("b"))
	if err := st.DeadLetterUpload(ctx, s2.ID, "corrupted file", time.Now().UTC()); err != nil {
		t.Fatalf("DeadLetterUpload() error: %v", err)
	}

	if err := st.MarkDisconnected(ctx, sess.ID, store.EndReasonUnpublish, time.Now()); err != nil {
		t.Fatalf("MarkDisconnected() error: %v", err)
	}

	f := testVODFinalizer(t, st, fake)
	result, err := f.Finalize(ctx, "evt1")
	if err != nil {
		t.Fatalf("Finalize() error: %v", err)
	}
	if !result.Finalized {
		t.Fatalf("expected Finalized=true despite a dead-lettered segment, reason=%q", result.Reason)
	}

	body := fakeBody(t, fake, VODPlaylistKey("", "pb1"))
	if strings.Count(body, "#EXTINF") != 1 {
		t.Errorf("expected only the 1 confirmed segment in the playlist, got:\n%s", body)
	}

	// The gap must be durably recorded as an explicit, operator-reviewable
	// state, not silently absorbed into a "finalized" status that looks
	// fully healthy (02_V1_ARCHITECTURE_SPEC.md "VOD finalization").
	fin, found, err := st.GetVODFinalization(ctx, "evt1")
	if err != nil || !found {
		t.Fatalf("GetVODFinalization() found=%v err=%v", found, err)
	}
	if fin.GapCount != 1 || fin.GapStatus != store.VODGapPendingReview {
		t.Errorf("got GapCount=%d GapStatus=%q, want GapCount=1 GapStatus=%q", fin.GapCount, fin.GapStatus, store.VODGapPendingReview)
	}
}

// TestFinalizeAddressesSegmentsByTheirOwnPinnedKeyAfterAssignmentRotates
// is the VOD-finalization counterpart of the manifestmanager_test.go
// regression of the same name: a finalized playlist's own object address
// tracks the event's current/enabled assignment playback_id, but every
// segment it references - both in the pre-publish HeadObject validation
// pass and in the playlist body itself - must resolve to that segment's
// own already-recorded r2_key, never a path reconstructed under the
// finalized playlist's playback_id.
func TestFinalizeAddressesSegmentsByTheirOwnPinnedKeyAfterAssignmentRotates(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb-old")
	sess := pinTestSession(t, st, "evt1", "ingest1", "pb-old")

	fake := newFakeObjectStore()
	s1 := setupQueuedSegment(t, st, "evt1", sess.ID, 1, []byte("a"))
	confirmSegment(t, st, fake, s1, "pb-old")
	if err := st.MarkDisconnected(ctx, sess.ID, store.EndReasonUnpublish, time.Now()); err != nil {
		t.Fatalf("MarkDisconnected() error: %v", err)
	}

	// Rotate the assignment's playback_id after the session ended, exactly
	// as a later re-activation would before finalization ever runs.
	importTestAssignment(t, st, "evt1", "ingest1", "pb-new")

	f := testVODFinalizer(t, st, fake)
	result, err := f.Finalize(ctx, "evt1")
	if err != nil {
		t.Fatalf("Finalize() error: %v", err)
	}
	if !result.Finalized {
		t.Fatalf("expected Finalized=true, reason=%q", result.Reason)
	}

	body := fakeBody(t, fake, VODPlaylistKey("", "pb-new"))
	wantSegmentKey := SegmentKey("", "pb-old", sess.ID, s1.LocalFileIdentity)
	if !strings.Contains(body, wantSegmentKey) {
		t.Errorf("VOD playlist does not reference the segment's actual key %q:\n%s", wantSegmentKey, body)
	}
	unwantedSegmentKey := SegmentKey("", "pb-new", sess.ID, s1.LocalFileIdentity)
	if strings.Contains(body, unwantedSegmentKey) {
		t.Errorf("VOD playlist must not reference a reconstructed key under the rotated playback_id %q:\n%s", unwantedSegmentKey, body)
	}
}

func TestFinalizeFailsIfAReferencedObjectIsMissing(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	sess, err := st.CreateSession(ctx, "evt1", "ingest1", "pb-1", time.Now())
	if err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}
	s1 := setupQueuedSegment(t, st, "evt1", sess.ID, 1, []byte("a"))
	// Deliberately calling ConfirmUpload directly (not the confirmSegment
	// helper, which also uploads): this updates the database only,
	// simulating an object that vanished from the provider after
	// confirmation.
	key := SegmentKey("", "pb1", s1.SessionID, s1.LocalFileIdentity)
	if err := st.ConfirmUpload(ctx, s1.ID, key, time.Now().UTC()); err != nil {
		t.Fatalf("ConfirmUpload() error: %v", err)
	}
	if err := st.MarkDisconnected(ctx, sess.ID, store.EndReasonUnpublish, time.Now()); err != nil {
		t.Fatalf("MarkDisconnected() error: %v", err)
	}

	fake := newFakeObjectStore()
	f := testVODFinalizer(t, st, fake)

	if _, err := f.Finalize(ctx, "evt1"); err == nil {
		t.Fatal("expected Finalize() to fail validation for a missing referenced object")
	}
}
