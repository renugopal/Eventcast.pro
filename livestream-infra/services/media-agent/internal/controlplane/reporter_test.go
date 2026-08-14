package controlplane

import (
	"context"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// captureClient records the reports the reporter would deliver.
type captureClient struct {
	reports []RecordingStateReport
}

func (c *captureClient) ReportRecordingState(_ context.Context, _, _ string, report RecordingStateReport) (RecordingReportResponse, error) {
	c.reports = append(c.reports, report)
	return RecordingReportResponse{}, nil
}

// reportOneArchivedEvent archives one event with the given durable strong
// claim and returns the single report the reporter emitted for it.
func reportOneArchivedEvent(t *testing.T, strongVerified bool) RecordingStateReport {
	t.Helper()
	ctx := context.Background()
	st := openTestStore(t)
	now := time.Now().UTC()

	if _, err := st.EnqueueB2Archive(ctx, store.EnqueueB2ArchiveInput{
		EventID:            "evt-1",
		Generation:         "gen-a",
		CoveredPlaybackIDs: []string{"pb-1"},
		LocalFinalizedAt:   now,
	}, now); err != nil {
		t.Fatalf("EnqueueB2Archive() error: %v", err)
	}
	if _, err := st.MarkB2Archived(ctx, "evt-1", "gen-a", "bucket", "playlist-key", 3, strongVerified, now); err != nil {
		t.Fatalf("MarkB2Archived() error: %v", err)
	}

	client := &captureClient{}
	NewRecordingReporter(st, client, RecordingReporterConfig{
		NodeID:         "media-node-test",
		RetryBaseDelay: time.Millisecond,
		RetryMaxDelay:  10 * time.Millisecond,
	}, testLogger(t)).RunOnce(ctx)

	if len(client.reports) != 1 {
		t.Fatalf("reports = %d, want exactly 1", len(client.reports))
	}
	return client.reports[0]
}

// The control plane grants integrity-verified state (and therefore allows
// retention freeze) only on this flag, so it must reflect the DURABLE
// strong claim rather than "the upload succeeded".
func TestReporterEmitsStrongIntegrityVerifiedForAStronglyVerifiedArchive(t *testing.T) {
	report := reportOneArchivedEvent(t, true)
	if !report.StrongIntegrityVerified {
		t.Error("a durably strong-verified archive was reported as unverified")
	}
	if report.B2ObjectKey == "" || report.B2Bucket == "" {
		t.Error("an archived report must carry its non-secret B2 object identity")
	}
}

func TestReporterNeverClaimsIntegrityForAnUnverifiedArchive(t *testing.T) {
	report := reportOneArchivedEvent(t, false)
	if report.StrongIntegrityVerified {
		t.Error("an archive with no strong verification was reported as integrity verified")
	}
}
