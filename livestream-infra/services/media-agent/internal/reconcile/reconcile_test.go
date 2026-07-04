package reconcile

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/spool"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

func testStore(t *testing.T) *store.Store {
	t.Helper()
	path := filepath.Join(t.TempDir(), "media-agent.sqlite3")
	st, err := store.Open(context.Background(), path, 5*time.Second)
	if err != nil {
		t.Fatalf("store.Open() error: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func silentLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func writeFile(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o640); err != nil {
		t.Fatalf("write file: %v", err)
	}
}

func TestRunOnceReconcilesOrphanSpoolFile(t *testing.T) {
	spoolRoot := t.TempDir()
	st := testStore(t)
	r := New(st, Config{SpoolRoot: spoolRoot, SessionStaleTimeout: time.Hour}, silentLogger())

	fileName := spool.SegmentFileName(1, "1700000000-1.ts")
	orphanPath := filepath.Join(spoolRoot, "event-1", "session-1", fileName)
	writeFile(t, orphanPath, "orphan-bytes")

	report, err := r.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce() error: %v", err)
	}
	if report.OrphanSegmentsReconciled != 1 {
		t.Errorf("OrphanSegmentsReconciled = %d, want 1", report.OrphanSegmentsReconciled)
	}

	job, found, err := st.GetSegmentByIdempotencyKey(context.Background(), "event-1|session-1|"+fileName)
	if err != nil {
		t.Fatalf("GetSegmentByIdempotencyKey() error: %v", err)
	}
	if !found {
		t.Fatal("orphan segment was not reconciled into a queue row")
	}
	if job.Status != store.SegmentQueued {
		t.Errorf("Status = %q, want %q", job.Status, store.SegmentQueued)
	}
	if job.SpoolPath != orphanPath {
		t.Errorf("SpoolPath = %q, want %q", job.SpoolPath, orphanPath)
	}
}

func TestRunOnceIsIdempotentForOrphanFiles(t *testing.T) {
	spoolRoot := t.TempDir()
	st := testStore(t)
	r := New(st, Config{SpoolRoot: spoolRoot, SessionStaleTimeout: time.Hour}, silentLogger())

	fileName := spool.SegmentFileName(1, "1700000000-1.ts")
	writeFile(t, filepath.Join(spoolRoot, "event-1", "session-1", fileName), "orphan-bytes")

	if _, err := r.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() first pass error: %v", err)
	}
	report, err := r.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce() second pass error: %v", err)
	}
	if report.OrphanSegmentsReconciled != 0 {
		t.Errorf("second pass OrphanSegmentsReconciled = %d, want 0 (already tracked)", report.OrphanSegmentsReconciled)
	}

	jobs, err := st.ListSegmentsByStatus(context.Background(), store.SegmentQueued)
	if err != nil {
		t.Fatalf("ListSegmentsByStatus() error: %v", err)
	}
	if len(jobs) != 1 {
		t.Fatalf("len(jobs) = %d, want 1 (no duplicate row across repeated reconciliation)", len(jobs))
	}
}

func TestRunOnceLeavesUnrecognizedSpoolLayoutUntouched(t *testing.T) {
	spoolRoot := t.TempDir()
	st := testStore(t)
	r := New(st, Config{SpoolRoot: spoolRoot, SessionStaleTimeout: time.Hour}, silentLogger())

	// Wrong depth: not event/session/file.
	weirdPath := filepath.Join(spoolRoot, "just-a-file.ts")
	writeFile(t, weirdPath, "unexpected")

	if _, err := r.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error: %v", err)
	}

	if _, err := os.Stat(weirdPath); err != nil {
		t.Errorf("unrecognized file was removed or moved: %v", err)
	}
}

func TestRunOnceMarksMissingFiles(t *testing.T) {
	spoolRoot := t.TempDir()
	st := testStore(t)
	r := New(st, Config{SpoolRoot: spoolRoot, SessionStaleTimeout: time.Hour}, silentLogger())

	job, _, err := st.ClaimSegment(context.Background(), store.ClaimSegmentInput{
		IdempotencyKey: "k1", EventID: "event-1", SessionID: "session-1", LocalFileIdentity: "1-x.ts", SeqNo: 1,
	})
	if err != nil {
		t.Fatalf("ClaimSegment() error: %v", err)
	}
	missingPath := filepath.Join(spoolRoot, "event-1", "session-1", "1-x.ts")
	if err := st.FinalizeSegment(context.Background(), job.ID, missingPath, 10, "abc", time.Now()); err != nil {
		t.Fatalf("FinalizeSegment() error: %v", err)
	}
	// The finalized path is never actually created on disk, simulating a
	// file that disappeared after being durably recorded.

	report, err := r.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce() error: %v", err)
	}
	if report.SegmentsMarkedMissing != 1 {
		t.Errorf("SegmentsMarkedMissing = %d, want 1", report.SegmentsMarkedMissing)
	}

	got, err := st.GetSegmentByID(context.Background(), job.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.Status != store.SegmentMissing {
		t.Errorf("Status = %q, want %q", got.Status, store.SegmentMissing)
	}
}

func TestRunOnceDoesNotDeleteUnknownSpoolFiles(t *testing.T) {
	spoolRoot := t.TempDir()
	st := testStore(t)
	r := New(st, Config{SpoolRoot: spoolRoot, SessionStaleTimeout: time.Hour}, silentLogger())

	fileName := spool.SegmentFileName(1, "1700000000-1.ts")
	path := filepath.Join(spoolRoot, "event-1", "session-1", fileName)
	writeFile(t, path, "orphan-bytes")

	if _, err := r.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error: %v", err)
	}

	if _, err := os.Stat(path); err != nil {
		t.Errorf("reconciliation deleted a durable file instead of recording it: %v", err)
	}
}

func TestRunOnceResolvesStuckCapturingWithFilePresent(t *testing.T) {
	spoolRoot := t.TempDir()
	st := testStore(t)
	r := New(st, Config{SpoolRoot: spoolRoot, SessionStaleTimeout: time.Hour}, silentLogger())
	r.stuckAfter = 0 // treat every "capturing" row as stuck immediately for this test

	job, _, err := st.ClaimSegment(context.Background(), store.ClaimSegmentInput{
		IdempotencyKey: "k1", EventID: "event-1", SessionID: "session-1", LocalFileIdentity: "1-x.ts", SeqNo: 1,
	})
	if err != nil {
		t.Fatalf("ClaimSegment() error: %v", err)
	}
	// The file exists at the deterministic expected path even though the
	// finalizing UPDATE never ran - simulating a crash between the fsync
	// and the database write.
	expectedPath := filepath.Join(spoolRoot, job.EventID, job.SessionID, job.LocalFileIdentity)
	writeFile(t, expectedPath, "durably-written")

	report, err := r.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce() error: %v", err)
	}
	if report.StuckCapturesResolved != 1 {
		t.Errorf("StuckCapturesResolved = %d, want 1", report.StuckCapturesResolved)
	}

	got, err := st.GetSegmentByID(context.Background(), job.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.Status != store.SegmentQueued {
		t.Errorf("Status = %q, want %q (file existed, so it should finalize)", got.Status, store.SegmentQueued)
	}
}

func TestRunOnceResolvesStuckCapturingWithFileAbsent(t *testing.T) {
	spoolRoot := t.TempDir()
	st := testStore(t)
	r := New(st, Config{SpoolRoot: spoolRoot, SessionStaleTimeout: time.Hour}, silentLogger())
	r.stuckAfter = 0

	job, _, err := st.ClaimSegment(context.Background(), store.ClaimSegmentInput{
		IdempotencyKey: "k1", EventID: "event-1", SessionID: "session-1", LocalFileIdentity: "1-x.ts", SeqNo: 1,
	})
	if err != nil {
		t.Fatalf("ClaimSegment() error: %v", err)
	}

	report, err := r.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce() error: %v", err)
	}
	if report.StuckCapturesResolved != 1 {
		t.Errorf("StuckCapturesResolved = %d, want 1", report.StuckCapturesResolved)
	}

	got, err := st.GetSegmentByID(context.Background(), job.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.Status != store.SegmentFailed {
		t.Errorf("Status = %q, want %q (file never existed, so it should fail)", got.Status, store.SegmentFailed)
	}
}

func TestRunOnceDoesNotTouchRecentlyClaimingRows(t *testing.T) {
	spoolRoot := t.TempDir()
	st := testStore(t)
	// Default stuckAfter (30s): a row claimed "just now" must be left alone,
	// since it may be a genuinely in-flight concurrent capture.
	r := New(st, Config{SpoolRoot: spoolRoot, SessionStaleTimeout: time.Hour}, silentLogger())

	job, _, err := st.ClaimSegment(context.Background(), store.ClaimSegmentInput{
		IdempotencyKey: "k1", EventID: "event-1", SessionID: "session-1", LocalFileIdentity: "1-x.ts", SeqNo: 1,
	})
	if err != nil {
		t.Fatalf("ClaimSegment() error: %v", err)
	}

	report, err := r.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce() error: %v", err)
	}
	if report.StuckCapturesResolved != 0 {
		t.Errorf("StuckCapturesResolved = %d, want 0 for a freshly-claimed row", report.StuckCapturesResolved)
	}

	got, err := st.GetSegmentByID(context.Background(), job.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.Status != store.SegmentCapturing {
		t.Errorf("Status = %q, want %q (must not race a genuinely in-flight capture)", got.Status, store.SegmentCapturing)
	}
}

func TestRunOnceReconcilesStaleSessions(t *testing.T) {
	spoolRoot := t.TempDir()
	st := testStore(t)
	r := New(st, Config{SpoolRoot: spoolRoot, SessionStaleTimeout: 10 * time.Second}, silentLogger())

	if _, err := st.CreateSession(context.Background(), "event-1", "ingest-1", time.Now().Add(-time.Hour)); err != nil {
		t.Fatalf("CreateSession() error: %v", err)
	}

	report, err := r.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce() error: %v", err)
	}
	if report.SessionsMarkedStale != 1 {
		t.Errorf("SessionsMarkedStale = %d, want 1", report.SessionsMarkedStale)
	}
}

func TestRunOnceReportsIntegrityOK(t *testing.T) {
	spoolRoot := t.TempDir()
	st := testStore(t)
	r := New(st, Config{SpoolRoot: spoolRoot, SessionStaleTimeout: time.Hour}, silentLogger())

	report, err := r.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce() error: %v", err)
	}
	if !report.IntegrityOK {
		t.Error("IntegrityOK = false for a fresh, undamaged database, want true")
	}
}

func TestRunOnceCleansOnlyOldExactTempFiles(t *testing.T) {
	spoolRoot := t.TempDir()
	st := testStore(t)
	r := New(st, Config{SpoolRoot: spoolRoot, SessionStaleTimeout: time.Hour}, silentLogger())

	oldTemp := filepath.Join(spoolRoot, "event-1", "session-1", ".tmp-eventcast-old")
	writeFile(t, oldTemp, "leftover")
	oldTime := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(oldTemp, oldTime, oldTime); err != nil {
		t.Fatalf("chtimes: %v", err)
	}

	recentTemp := filepath.Join(spoolRoot, "event-1", "session-1", ".tmp-eventcast-recent")
	writeFile(t, recentTemp, "in-flight")

	unrelatedTemp := filepath.Join(spoolRoot, "unrelated.tmp")
	writeFile(t, unrelatedTemp, "not ours")
	if err := os.Chtimes(unrelatedTemp, oldTime, oldTime); err != nil {
		t.Fatalf("chtimes: %v", err)
	}

	report, err := r.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce() error: %v", err)
	}
	if report.TempFilesCleaned != 1 {
		t.Errorf("TempFilesCleaned = %d, want 1", report.TempFilesCleaned)
	}

	if _, err := os.Stat(oldTemp); !os.IsNotExist(err) {
		t.Error("old temp file was not cleaned up")
	}
	if _, err := os.Stat(recentTemp); err != nil {
		t.Error("recent temp file was incorrectly cleaned up")
	}
	if _, err := os.Stat(unrelatedTemp); err != nil {
		t.Error("unrelated file (not matching our temp naming pattern) was incorrectly cleaned up")
	}
}

func TestRunPeriodicStopsOnContextCancellation(t *testing.T) {
	spoolRoot := t.TempDir()
	st := testStore(t)
	r := New(st, Config{SpoolRoot: spoolRoot, SessionStaleTimeout: time.Hour}, silentLogger())

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		r.RunPeriodic(ctx, 10*time.Millisecond)
		close(done)
	}()

	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("RunPeriodic() did not return after context cancellation")
	}
}
