package upload

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// setupConfirmedSegmentUnder creates a queued, upload-confirmed segment
// whose spool file lives directly under root, for retention tests that
// need to control the exact directory the containment check evaluates.
func setupConfirmedSegmentUnder(t *testing.T, st *store.Store, root, eventID, sessionID string, seqNo int64) store.SegmentJob {
	t.Helper()
	ctx := context.Background()

	content := []byte("retention test content")
	localFileIdentity := seqAndName(seqNo)
	spoolPath := filepath.Join(root, localFileIdentity)
	if err := os.WriteFile(spoolPath, content, 0o640); err != nil {
		t.Fatalf("write spool file: %v", err)
	}
	sum := sha256.Sum256(content)

	job, owned, err := st.ClaimSegment(ctx, store.ClaimSegmentInput{
		IdempotencyKey: eventID + "|" + sessionID + "|" + localFileIdentity, EventID: eventID, SessionID: sessionID,
		LocalFileIdentity: localFileIdentity, SeqNo: seqNo, DurationSeconds: 4,
	})
	if err != nil || !owned {
		t.Fatalf("ClaimSegment() owned=%v err=%v", owned, err)
	}
	if err := st.FinalizeSegment(ctx, job.ID, spoolPath, int64(len(content)), hex.EncodeToString(sum[:]), time.Now().UTC()); err != nil {
		t.Fatalf("FinalizeSegment() error: %v", err)
	}
	if err := st.ConfirmUpload(ctx, job.ID, "events/pb/media/"+sessionID+"/"+localFileIdentity, time.Now().UTC()); err != nil {
		t.Fatalf("ConfirmUpload() error: %v", err)
	}
	got, err := st.GetSegmentByID(ctx, job.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	return got
}

func TestRetentionDeletesEligibleConfirmedSegments(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	root := t.TempDir()
	seg := setupConfirmedSegmentUnder(t, st, root, "evt1", "sess1", 1)

	longAgo := time.Now().UTC().Add(-48 * time.Hour)
	if err := st.UpsertVODFinalized(ctx, "evt1", []int64{seg.ID}, 1, "events/pb/vod/index.m3u8", 0, longAgo); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}

	w := NewRetentionWorker(st, RetentionConfig{SpoolRoot: root, LocalRetentionDelay: 24 * time.Hour}, testLogger(t))
	w.RunOnce(ctx)

	if _, err := os.Stat(seg.SpoolPath); !os.IsNotExist(err) {
		t.Errorf("expected spool file to be deleted, stat error: %v", err)
	}
	got, err := st.GetSegmentByID(ctx, seg.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.LocalDeletedAt.IsZero() {
		t.Error("expected LocalDeletedAt to be recorded")
	}
}

func TestRetentionSkipsSegmentsNotYetPastRetentionDelay(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	root := t.TempDir()
	seg := setupConfirmedSegmentUnder(t, st, root, "evt1", "sess1", 1)

	if err := st.UpsertVODFinalized(ctx, "evt1", []int64{seg.ID}, 1, "events/pb/vod/index.m3u8", 0, time.Now().UTC()); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}

	w := NewRetentionWorker(st, RetentionConfig{SpoolRoot: root, LocalRetentionDelay: 24 * time.Hour}, testLogger(t))
	w.RunOnce(ctx)

	if _, err := os.Stat(seg.SpoolPath); err != nil {
		t.Errorf("expected spool file to remain (retention delay not elapsed), stat error: %v", err)
	}
}

func TestRetentionRefusesToDeletePathOutsideSpoolRoot(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	root := t.TempDir()
	outside := t.TempDir() // a sibling directory, not under root
	seg := setupConfirmedSegmentUnder(t, st, outside, "evt1", "sess1", 1)

	longAgo := time.Now().UTC().Add(-48 * time.Hour)
	if err := st.UpsertVODFinalized(ctx, "evt1", []int64{seg.ID}, 1, "events/pb/vod/index.m3u8", 0, longAgo); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}

	w := NewRetentionWorker(st, RetentionConfig{SpoolRoot: root, LocalRetentionDelay: 24 * time.Hour}, testLogger(t))
	w.RunOnce(ctx)

	if _, err := os.Stat(seg.SpoolPath); err != nil {
		t.Errorf("expected file outside the configured spool root to be left untouched, stat error: %v", err)
	}
	got, err := st.GetSegmentByID(ctx, seg.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if !got.LocalDeletedAt.IsZero() {
		t.Error("expected LocalDeletedAt to remain unset when deletion was refused")
	}
}

func TestRetentionTreatsAlreadyMissingFileAsSuccess(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	root := t.TempDir()
	seg := setupConfirmedSegmentUnder(t, st, root, "evt1", "sess1", 1)
	if err := os.Remove(seg.SpoolPath); err != nil {
		t.Fatalf("pre-remove spool file: %v", err)
	}

	longAgo := time.Now().UTC().Add(-48 * time.Hour)
	if err := st.UpsertVODFinalized(ctx, "evt1", []int64{seg.ID}, 1, "events/pb/vod/index.m3u8", 0, longAgo); err != nil {
		t.Fatalf("UpsertVODFinalized() error: %v", err)
	}

	w := NewRetentionWorker(st, RetentionConfig{SpoolRoot: root, LocalRetentionDelay: 24 * time.Hour}, testLogger(t))
	w.RunOnce(ctx)

	got, err := st.GetSegmentByID(ctx, seg.ID)
	if err != nil {
		t.Fatalf("GetSegmentByID() error: %v", err)
	}
	if got.LocalDeletedAt.IsZero() {
		t.Error("expected an already-missing file to still be recorded as locally deleted")
	}
}

func TestIsWithinRoot(t *testing.T) {
	tests := []struct {
		root, candidate string
		want            bool
	}{
		{"/data/spool", "/data/spool/a/b.ts", true},
		{"/data/spool", "/data/spool", true},
		{"/data/spool", "/data/spool-other/a.ts", false},
		{"/data/spool", "/etc/passwd", false},
		{"", "/data/spool/a.ts", false},
	}
	for _, tt := range tests {
		if got := isWithinRoot(tt.root, tt.candidate); got != tt.want {
			t.Errorf("isWithinRoot(%q, %q) = %v, want %v", tt.root, tt.candidate, got, tt.want)
		}
	}
}
