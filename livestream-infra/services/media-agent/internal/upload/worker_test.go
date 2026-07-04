package upload

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

func testLogger(t *testing.T) *slog.Logger {
	t.Helper()
	return slog.New(slog.NewTextHandler(testWriter{t}, &slog.HandlerOptions{Level: slog.LevelError}))
}

// testWriter routes slog output into t.Log so failures show relevant
// context without polluting normal passing-test output.
type testWriter struct{ t *testing.T }

func (w testWriter) Write(p []byte) (int, error) {
	w.t.Log(string(p))
	return len(p), nil
}

func openTestStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "media-agent.sqlite3"), 5*time.Second)
	if err != nil {
		t.Fatalf("store.Open() error: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func importTestAssignment(t *testing.T, st *store.Store, eventID, ingestID, playbackID string) {
	t.Helper()
	now := time.Now().UTC()
	_, err := st.ImportAssignments(context.Background(), []store.Assignment{{
		IngestID:             ingestID,
		EventID:              eventID,
		PlaybackID:           playbackID,
		SecretTokenHash:      store.HashToken("test-secret"),
		Enabled:              true,
		PublishWindowStartAt: now.Add(-time.Hour),
		PublishWindowEndAt:   now.Add(time.Hour),
		UpdatedAt:            now,
	}})
	if err != nil {
		t.Fatalf("ImportAssignments() error: %v", err)
	}
}

// setupQueuedSegment writes content to a real spool file and creates a
// fully finalized (status=queued) segment_jobs row for it, matching how
// internal/spool + internal/srs would have left it after a real on_hls
// callback.
func setupQueuedSegment(t *testing.T, st *store.Store, eventID, sessionID string, seqNo int64, content []byte) store.SegmentJob {
	t.Helper()
	ctx := context.Background()

	dir := t.TempDir()
	localFileIdentity := seqAndName(seqNo)
	spoolPath := filepath.Join(dir, localFileIdentity)
	if err := os.WriteFile(spoolPath, content, 0o640); err != nil {
		t.Fatalf("write spool file: %v", err)
	}
	sum := sha256.Sum256(content)
	sha256Hex := hex.EncodeToString(sum[:])

	idempotencyKey := eventID + "|" + sessionID + "|" + localFileIdentity
	job, owned, err := st.ClaimSegment(ctx, store.ClaimSegmentInput{
		IdempotencyKey: idempotencyKey, EventID: eventID, SessionID: sessionID,
		LocalFileIdentity: localFileIdentity, SeqNo: seqNo, DurationSeconds: 4,
	})
	if err != nil || !owned {
		t.Fatalf("ClaimSegment() error=%v owned=%v", err, owned)
	}
	if err := st.FinalizeSegment(ctx, job.ID, spoolPath, int64(len(content)), sha256Hex, time.Now().UTC()); err != nil {
		t.Fatalf("FinalizeSegment() error: %v", err)
	}
	got, err := st.GetSegmentByID(ctx, job.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	return got
}

var testSegCounter atomic.Int64

// seqAndName returns a globally unique (within this test binary run)
// local file identity, so segments created in a tight loop (e.g. the
// concurrency test) never collide on idempotency_key regardless of
// clock resolution.
func seqAndName(seqNo int64) string {
	return fmt.Sprintf("seg-%d-%d.ts", seqNo, testSegCounter.Add(1))
}

func testWorker(st *store.Store, fake *fakeObjectStore, logger *slog.Logger) *Worker {
	return NewWorker(st, fake, WorkerConfig{
		ObjectPrefix:   "",
		Concurrency:    1,
		LeaseDuration:  30 * time.Second,
		RequestTimeout: 5 * time.Second,
		RetryBaseDelay: time.Millisecond,
		RetryMaxDelay:  10 * time.Millisecond,
	}, logger)
}

func TestWorkerUploadsAndConfirmsSegment(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	seg := setupQueuedSegment(t, st, "evt1", "sess1", 1, []byte("hello ts data"))

	fake := newFakeObjectStore()
	w := testWorker(st, fake, testLogger(t))

	claimed, err := w.processOnce(ctx, "worker-1")
	if err != nil || !claimed {
		t.Fatalf("processOnce() claimed=%v err=%v", claimed, err)
	}

	got, err := st.GetSegmentByID(ctx, seg.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.UploadStatus != store.UploadConfirmed {
		t.Fatalf("UploadStatus = %q, want %q (last_error=%q)", got.UploadStatus, store.UploadConfirmed, got.UploadLastError)
	}
	wantKey := SegmentKey("", "pb1", "sess1", seg.LocalFileIdentity)
	if got.R2Key != wantKey {
		t.Errorf("R2Key = %q, want %q", got.R2Key, wantKey)
	}
	if !fake.has(wantKey) {
		t.Errorf("expected object store to contain key %q", wantKey)
	}
	if put, _ := fake.counts(); put != 1 {
		t.Errorf("PutObject called %d times, want 1", put)
	}
}

func TestWorkerIsIdempotentWhenObjectAlreadyUploaded(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	seg := setupQueuedSegment(t, st, "evt1", "sess1", 1, []byte("crash after upload"))

	key := SegmentKey("", "pb1", "sess1", seg.LocalFileIdentity)
	fake := newFakeObjectStore()
	// Simulate a prior worker that PUT the object successfully but
	// crashed before it could call ConfirmUpload: the object already
	// exists with matching metadata, but the database row is still
	// "leased"/"pending".
	if err := fake.PutObject(ctx, PutObjectInput{
		Key: key, Body: strings.NewReader("crash after upload"), Size: int64(len("crash after upload")),
		ContentType: contentTypeSegment, Metadata: segmentMetadata(seg),
	}); err != nil {
		t.Fatalf("seed PutObject() error: %v", err)
	}

	w := testWorker(st, fake, testLogger(t))
	claimed, err := w.processOnce(ctx, "worker-1")
	if err != nil || !claimed {
		t.Fatalf("processOnce() claimed=%v err=%v", claimed, err)
	}

	got, err := st.GetSegmentByID(ctx, seg.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.UploadStatus != store.UploadConfirmed {
		t.Fatalf("UploadStatus = %q, want %q", got.UploadStatus, store.UploadConfirmed)
	}
	if put, head := fake.counts(); put != 1 || head < 1 {
		t.Errorf("expected exactly the one seeded PutObject and at least one HeadObject, got put=%d head=%d", put, head)
	}
}

func TestWorkerRetriesTransientProviderErrorThenSucceeds(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	seg := setupQueuedSegment(t, st, "evt1", "sess1", 1, []byte("retry me"))

	fake := newFakeObjectStore()
	fake.failPutNTimes = 1
	fake.failErr = errRetryable

	w := testWorker(st, fake, testLogger(t))

	job, owned, err := st.ClaimUploadableSegment(ctx, "worker-1", 30*time.Second, time.Now().UTC())
	if err != nil || !owned {
		t.Fatalf("ClaimUploadableSegment() owned=%v err=%v", owned, err)
	}
	w.upload(ctx, job)

	got, err := st.GetSegmentByID(ctx, seg.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.UploadStatus != store.UploadPending {
		t.Fatalf("after first failed attempt, UploadStatus = %q, want %q", got.UploadStatus, store.UploadPending)
	}
	if got.UploadAttemptCount != 1 {
		t.Errorf("UploadAttemptCount = %d, want 1", got.UploadAttemptCount)
	}
	if got.UploadNextAttemptAt.IsZero() {
		t.Error("expected upload_next_attempt_at to be set after a retryable failure")
	}

	// Simulate the retry delay having elapsed and claim again.
	job2, owned, err := st.ClaimUploadableSegment(ctx, "worker-1", 30*time.Second, time.Now().UTC().Add(time.Hour))
	if err != nil || !owned {
		t.Fatalf("second ClaimUploadableSegment() owned=%v err=%v", owned, err)
	}
	w.upload(ctx, job2)

	final, err := st.GetSegmentByID(ctx, seg.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if final.UploadStatus != store.UploadConfirmed {
		t.Fatalf("final UploadStatus = %q, want %q (last_error=%q)", final.UploadStatus, store.UploadConfirmed, final.UploadLastError)
	}
}

func TestWorkerDeadLettersMissingLocalFile(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	seg := setupQueuedSegment(t, st, "evt1", "sess1", 1, []byte("will be deleted"))
	if err := os.Remove(seg.SpoolPath); err != nil {
		t.Fatalf("remove spool file: %v", err)
	}

	w := testWorker(st, newFakeObjectStore(), testLogger(t))
	claimed, err := w.processOnce(ctx, "worker-1")
	if err != nil || !claimed {
		t.Fatalf("processOnce() claimed=%v err=%v", claimed, err)
	}

	got, err := st.GetSegmentByID(ctx, seg.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.UploadStatus != store.UploadDeadLetter {
		t.Fatalf("UploadStatus = %q, want %q", got.UploadStatus, store.UploadDeadLetter)
	}
}

func TestWorkerDeadLettersCorruptedLocalFile(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	seg := setupQueuedSegment(t, st, "evt1", "sess1", 1, []byte("original content"))
	if err := os.WriteFile(seg.SpoolPath, []byte("tampered content!!"), 0o640); err != nil {
		t.Fatalf("tamper with spool file: %v", err)
	}

	w := testWorker(st, newFakeObjectStore(), testLogger(t))
	claimed, err := w.processOnce(ctx, "worker-1")
	if err != nil || !claimed {
		t.Fatalf("processOnce() claimed=%v err=%v", claimed, err)
	}

	got, err := st.GetSegmentByID(ctx, seg.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.UploadStatus != store.UploadDeadLetter {
		t.Fatalf("UploadStatus = %q, want %q", got.UploadStatus, store.UploadDeadLetter)
	}
}

func TestWorkerDeadLettersObjectMismatchNeverOverwrites(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	seg := setupQueuedSegment(t, st, "evt1", "sess1", 1, []byte("expected content"))

	key := SegmentKey("", "pb1", "sess1", seg.LocalFileIdentity)
	fake := newFakeObjectStore()
	if err := fake.PutObject(ctx, PutObjectInput{
		Key: key, Body: strings.NewReader("different content!"), Size: int64(len("different content!")),
		ContentType: contentTypeSegment, Metadata: map[string]string{"sha256": "not-the-real-sha"},
	}); err != nil {
		t.Fatalf("seed conflicting object: %v", err)
	}
	before := mustHeadMetadata(ctx, t, fake, key)

	w := testWorker(st, fake, testLogger(t))
	claimed, err := w.processOnce(ctx, "worker-1")
	if err != nil || !claimed {
		t.Fatalf("processOnce() claimed=%v err=%v", claimed, err)
	}

	got, err := st.GetSegmentByID(ctx, seg.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.UploadStatus != store.UploadDeadLetter {
		t.Fatalf("UploadStatus = %q, want %q", got.UploadStatus, store.UploadDeadLetter)
	}
	after := mustHeadMetadata(ctx, t, fake, key)
	if before["sha256"] != after["sha256"] {
		t.Errorf("conflicting object must never be overwritten: before=%v after=%v", before, after)
	}
}

func TestWorkerRetriesForeverWithoutAssignmentInsteadOfDeadLettering(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	// Deliberately no ImportAssignments call for "evt-unknown".
	seg := setupQueuedSegment(t, st, "evt-unknown", "sess1", 1, []byte("waiting for assignment"))

	w := testWorker(st, newFakeObjectStore(), testLogger(t))
	claimed, err := w.processOnce(ctx, "worker-1")
	if err != nil || !claimed {
		t.Fatalf("processOnce() claimed=%v err=%v", claimed, err)
	}

	got, err := st.GetSegmentByID(ctx, seg.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.UploadStatus != store.UploadPending {
		t.Fatalf("UploadStatus = %q, want %q (must retry, never dead-letter, when only the assignment is missing)", got.UploadStatus, store.UploadPending)
	}
}

func TestClaimUploadableSegmentReclaimsExpiredLease(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")
	seg := setupQueuedSegment(t, st, "evt1", "sess1", 1, []byte("stale lease"))

	past := time.Now().UTC().Add(-time.Hour)
	job, owned, err := st.ClaimUploadableSegment(ctx, "worker-dead", time.Second, past)
	if err != nil || !owned || job.ID != seg.ID {
		t.Fatalf("first claim: owned=%v err=%v job.ID=%d", owned, err, job.ID)
	}

	// The lease (1s from `past`, an hour ago) has long since expired;
	// a different worker must be able to reclaim it now.
	job2, owned, err := st.ClaimUploadableSegment(ctx, "worker-alive", 30*time.Second, time.Now().UTC())
	if err != nil || !owned || job2.ID != seg.ID {
		t.Fatalf("reclaim: owned=%v err=%v job.ID=%d", owned, err, job2.ID)
	}
}

func TestClaimUploadableSegmentIsRaceFreeAcrossConcurrentWorkers(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	importTestAssignment(t, st, "evt1", "ingest1", "pb1")

	const n = 8
	var ids []int64
	for i := int64(1); i <= n; i++ {
		s := setupQueuedSegment(t, st, "evt1", "sess1", i, []byte("payload"))
		ids = append(ids, s.ID)
	}

	var mu sync.Mutex
	claimed := make(map[int64]int)
	var wg sync.WaitGroup
	for w := 0; w < n; w++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for {
				job, owned, err := st.ClaimUploadableSegment(ctx, "worker", time.Minute, time.Now().UTC())
				if err != nil {
					t.Errorf("ClaimUploadableSegment() error: %v", err)
					return
				}
				if !owned {
					return
				}
				mu.Lock()
				claimed[job.ID]++
				mu.Unlock()
			}
		}(w)
	}
	wg.Wait()

	if len(claimed) != n {
		t.Fatalf("distinct segments claimed = %d, want %d", len(claimed), n)
	}
	for id, count := range claimed {
		if count != 1 {
			t.Errorf("segment %d claimed %d times, want exactly 1", id, count)
		}
	}
}

func mustHeadMetadata(ctx context.Context, t *testing.T, objStore *fakeObjectStore, key string) map[string]string {
	t.Helper()
	info, err := objStore.HeadObject(ctx, key)
	if err != nil {
		t.Fatalf("HeadObject(%s) error: %v", key, err)
	}
	return info.Metadata
}
