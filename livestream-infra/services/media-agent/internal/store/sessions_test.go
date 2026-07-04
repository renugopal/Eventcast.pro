package store

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestCreateSessionSucceeds(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now()

	sess, err := st.CreateSession(ctx, "event-1", "ingest-1", now)
	if err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}
	if sess.ID == "" {
		t.Error("session ID is empty")
	}
	if sess.Status != SessionActive {
		t.Errorf("Status = %q, want %q", sess.Status, SessionActive)
	}
	if sess.EventID != "event-1" || sess.IngestID != "ingest-1" {
		t.Errorf("session = %+v, want event-1/ingest-1", sess)
	}
}

func TestCreateSessionRejectsConflictingActivePublisher(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now()

	if _, err := st.CreateSession(ctx, "event-1", "ingest-1", now); err != nil {
		t.Fatalf("CreateSession() first error: %v", err)
	}

	_, err := st.CreateSession(ctx, "event-1", "ingest-1-second-connection", now)
	if !errors.Is(err, ErrConflictingActivePublisher) {
		t.Fatalf("CreateSession() second error = %v, want ErrConflictingActivePublisher", err)
	}
}

func TestCreateSessionAllowsReconnectAfterDisconnect(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now()

	first, err := st.CreateSession(ctx, "event-1", "ingest-1", now)
	if err != nil {
		t.Fatalf("CreateSession() first error: %v", err)
	}
	if err := st.MarkDisconnected(ctx, first.ID, EndReasonUnpublish, now); err != nil {
		t.Fatalf("MarkDisconnected() error: %v", err)
	}

	second, err := st.CreateSession(ctx, "event-1", "ingest-1", now.Add(time.Second))
	if err != nil {
		t.Fatalf("CreateSession() reconnect error: %v", err)
	}
	if second.ID == first.ID {
		t.Error("reconnect must create a new session identity, not reopen the old one")
	}
}

func TestCreateSessionConcurrentOnlyOneWins(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now()

	const attempts = 8
	var wg sync.WaitGroup
	successes := make(chan string, attempts)
	conflicts := make(chan error, attempts)

	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sess, err := st.CreateSession(ctx, "event-race", "ingest-race", now)
			if err == nil {
				successes <- sess.ID
				return
			}
			conflicts <- err
		}(i)
	}
	wg.Wait()
	close(successes)
	close(conflicts)

	successCount := 0
	for range successes {
		successCount++
	}
	if successCount != 1 {
		t.Errorf("concurrent CreateSession successes = %d, want exactly 1", successCount)
	}

	conflictCount := 0
	for err := range conflicts {
		if !errors.Is(err, ErrConflictingActivePublisher) {
			t.Errorf("unexpected error from concurrent CreateSession: %v", err)
		}
		conflictCount++
	}
	if conflictCount != attempts-1 {
		t.Errorf("concurrent CreateSession conflicts = %d, want %d", conflictCount, attempts-1)
	}
}

func TestFindMostRecentByIngestIDReturnsLatest(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now()

	first, err := st.CreateSession(ctx, "event-1", "ingest-1", now)
	if err != nil {
		t.Fatalf("CreateSession() first error: %v", err)
	}
	if err := st.MarkDisconnected(ctx, first.ID, EndReasonUnpublish, now); err != nil {
		t.Fatalf("MarkDisconnected() error: %v", err)
	}
	second, err := st.CreateSession(ctx, "event-1", "ingest-1", now.Add(time.Minute))
	if err != nil {
		t.Fatalf("CreateSession() second error: %v", err)
	}

	got, found, err := st.FindMostRecentByIngestID(ctx, "ingest-1")
	if err != nil {
		t.Fatalf("FindMostRecentByIngestID() error: %v", err)
	}
	if !found {
		t.Fatal("FindMostRecentByIngestID() found = false, want true")
	}
	if got.ID != second.ID {
		t.Errorf("FindMostRecentByIngestID() = %s, want the most recent session %s", got.ID, second.ID)
	}
}

func TestFindMostRecentByIngestIDNotFound(t *testing.T) {
	st := openTestStore(t)
	_, found, err := st.FindMostRecentByIngestID(context.Background(), "unknown")
	if err != nil {
		t.Fatalf("FindMostRecentByIngestID() error: %v", err)
	}
	if found {
		t.Error("FindMostRecentByIngestID() found = true for unknown ingest id, want false")
	}
}

func TestMarkDisconnectedIsIdempotent(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now()

	sess, err := st.CreateSession(ctx, "event-1", "ingest-1", now)
	if err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}

	if err := st.MarkDisconnected(ctx, sess.ID, EndReasonUnpublish, now); err != nil {
		t.Fatalf("MarkDisconnected() first call error: %v", err)
	}
	// A second, redundant call (a duplicate/late on_unpublish) must not error.
	if err := st.MarkDisconnected(ctx, sess.ID, EndReasonUnpublish, now.Add(time.Second)); err != nil {
		t.Fatalf("MarkDisconnected() second call error: %v", err)
	}

	got, found, err := st.FindMostRecentByIngestID(ctx, "ingest-1")
	if err != nil {
		t.Fatalf("FindMostRecentByIngestID() error: %v", err)
	}
	if !found {
		t.Fatal("session missing after MarkDisconnected")
	}
	if got.Status != SessionDisconnected {
		t.Errorf("Status = %q, want %q", got.Status, SessionDisconnected)
	}
}

func TestMarkDisconnectedUnknownSessionIsNoop(t *testing.T) {
	st := openTestStore(t)
	if err := st.MarkDisconnected(context.Background(), "does-not-exist", EndReasonUnpublish, time.Now()); err != nil {
		t.Errorf("MarkDisconnected() for unknown session id error: %v, want nil", err)
	}
}

func TestTouchActivityIncrementsSegmentCount(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now()

	sess, err := st.CreateSession(ctx, "event-1", "ingest-1", now)
	if err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}

	later := now.Add(5 * time.Second)
	if err := st.TouchActivity(ctx, sess.ID, later); err != nil {
		t.Fatalf("TouchActivity() error: %v", err)
	}
	if err := st.TouchActivity(ctx, sess.ID, later.Add(time.Second)); err != nil {
		t.Fatalf("TouchActivity() second call error: %v", err)
	}

	got, found, err := st.FindMostRecentByIngestID(ctx, "ingest-1")
	if err != nil {
		t.Fatalf("FindMostRecentByIngestID() error: %v", err)
	}
	if !found {
		t.Fatal("session not found")
	}
	if got.SegmentCount != 2 {
		t.Errorf("SegmentCount = %d, want 2", got.SegmentCount)
	}
	if !got.LastActivityAt.After(now) {
		t.Errorf("LastActivityAt = %v, want after %v", got.LastActivityAt, now)
	}
}

func TestReconcileStaleActiveOnlyAffectsOldSessions(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now()

	stale, err := st.CreateSession(ctx, "event-stale", "ingest-stale", now.Add(-time.Hour))
	if err != nil {
		t.Fatalf("CreateSession() stale error: %v", err)
	}
	fresh, err := st.CreateSession(ctx, "event-fresh", "ingest-fresh", now)
	if err != nil {
		t.Fatalf("CreateSession() fresh error: %v", err)
	}

	n, err := st.ReconcileStaleActive(ctx, now.Add(-30*time.Minute), now)
	if err != nil {
		t.Fatalf("ReconcileStaleActive() error: %v", err)
	}
	if n != 1 {
		t.Fatalf("ReconcileStaleActive() affected = %d, want 1", n)
	}

	staleGot, _, err := st.FindMostRecentByIngestID(ctx, "ingest-stale")
	if err != nil {
		t.Fatalf("FindMostRecentByIngestID() stale error: %v", err)
	}
	if staleGot.Status != SessionDisconnected || staleGot.EndReason != EndReasonStaleTimeout {
		t.Errorf("stale session = %+v, want disconnected/stale_timeout", staleGot)
	}
	if staleGot.ID != stale.ID {
		t.Fatalf("unexpected stale session id")
	}

	freshGot, _, err := st.FindMostRecentByIngestID(ctx, "ingest-fresh")
	if err != nil {
		t.Fatalf("FindMostRecentByIngestID() fresh error: %v", err)
	}
	if freshGot.Status != SessionActive {
		t.Errorf("fresh session status = %q, want %q (must not be reconciled away)", freshGot.Status, SessionActive)
	}
	if freshGot.ID != fresh.ID {
		t.Fatalf("unexpected fresh session id")
	}
}

func TestReconcileStaleActiveFreesEventForNewPublisher(t *testing.T) {
	st := openTestStore(t)
	ctx := context.Background()
	now := time.Now()

	if _, err := st.CreateSession(ctx, "event-1", "ingest-1", now.Add(-time.Hour)); err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}

	if _, err := st.ReconcileStaleActive(ctx, now.Add(-30*time.Minute), now); err != nil {
		t.Fatalf("ReconcileStaleActive() error: %v", err)
	}

	if _, err := st.CreateSession(ctx, "event-1", "ingest-1", now); err != nil {
		t.Fatalf("CreateSession() after stale reconciliation should succeed, got error: %v", err)
	}
}
