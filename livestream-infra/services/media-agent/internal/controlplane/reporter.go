package controlplane

import (
	"context"
	"log/slog"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// reportBatchSize bounds how many events one reporter pass handles, so a
// large backlog is drained steadily instead of in one long burst.
const reportBatchSize = 32

// RecordingReporterConfig configures RecordingReporter.
type RecordingReporterConfig struct {
	NodeID         string
	RetryBaseDelay time.Duration
	RetryMaxDelay  time.Duration
}

// RecordingReporter durably delivers recording-state evidence to the
// control plane.
//
// It is a separate loop from the archival worker on purpose: a
// control-plane outage must never stall or corrupt local archival, and a
// slow B2 transfer must never delay reporting evidence the control plane
// could already act on. Both keep their state in the same durable
// b2_archives row, so either can restart independently.
//
// Delivery is at-least-once. That is safe because the control-plane
// transition is idempotent, which is also why a lost response needs no
// special handling - it is simply retried.
type RecordingReporter struct {
	store  *store.Store
	client RecordingReporterClient
	cfg    RecordingReporterConfig
	logger *slog.Logger
	now    func() time.Time
}

// NewRecordingReporter returns a RecordingReporter. logger must not be nil.
func NewRecordingReporter(st *store.Store, client RecordingReporterClient, cfg RecordingReporterConfig, logger *slog.Logger) *RecordingReporter {
	return &RecordingReporter{store: st, client: client, cfg: cfg, logger: logger, now: time.Now}
}

// Run performs an immediate pass and then one every interval until ctx is
// cancelled.
func (r *RecordingReporter) Run(ctx context.Context, interval time.Duration) {
	r.RunOnce(ctx)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.RunOnce(ctx)
		}
	}
}

// RunOnce reports every archive whose current generation/state the control
// plane has not yet acknowledged.
func (r *RecordingReporter) RunOnce(ctx context.Context) {
	now := r.now().UTC()
	due, err := r.store.ListB2ReportsDue(ctx, now, reportBatchSize)
	if err != nil {
		r.logger.Error("recording reporter: list due failed", slog.String("error", err.Error()))
		return
	}

	for _, archive := range due {
		select {
		case <-ctx.Done():
			return
		default:
		}
		r.report(ctx, archive)
	}
}

func (r *RecordingReporter) report(ctx context.Context, archive store.B2Archive) {
	state := recordingStateFor(archive.State)
	if state == "" {
		return
	}

	report := RecordingStateReport{
		State:                  state,
		FinalizationGeneration: archive.Generation,
		GapCount:               archive.GapCount,
		GapStatus:              archive.GapStatus,
		CoveredPlaybackIDs:     archive.CoveredPlaybackIDs,
		// Never derived from "the upload succeeded". Until an isolated
		// connectivity test proves a real byte-integrity mechanism against
		// the actual endpoint, this stays false and the control plane
		// correctly refuses to freeze retention.
		StrongIntegrityVerified: archive.StrongVerified,
	}
	if !archive.LocalFinalizedAt.IsZero() {
		report.LocalFinalizedAt = archive.LocalFinalizedAt.UTC().Format(time.RFC3339Nano)
	}
	if archive.State == store.B2ArchiveArchived {
		report.B2ObjectKey = archive.PlaylistKey
		report.B2Bucket = archive.Bucket
	}
	if archive.State == store.B2ArchiveFailed {
		report.FailureReason = archive.LastError
	}

	now := r.now().UTC()
	resp, err := r.client.ReportRecordingState(ctx, r.cfg.NodeID, archive.EventID, report)
	if err != nil {
		delay := reportBackoff(archive.ReportAttempts+1, r.cfg.RetryBaseDelay, r.cfg.RetryMaxDelay)
		if markErr := r.store.MarkB2ReportFailed(ctx, archive.EventID, err.Error(), now.Add(delay), now); markErr != nil {
			r.logger.Error("recording reporter: record failure failed",
				slog.String("event_id", archive.EventID), slog.String("error", markErr.Error()))
		}
		r.logger.Warn("recording report will be retried",
			slog.String("event_id", archive.EventID), slog.Duration("delay", delay))
		return
	}

	// Acknowledged. Recorded against the generation actually reported, so a
	// row that converged forward mid-flight is not mistakenly treated as
	// acknowledged for its newer generation.
	if err := r.store.MarkB2Reported(ctx, archive.EventID, archive.Generation, archive.State, now); err != nil {
		r.logger.Error("recording reporter: record acknowledgement failed",
			slog.String("event_id", archive.EventID), slog.String("error", err.Error()))
		return
	}

	if resp.FinalizationGeneration != "" && resp.FinalizationGeneration != archive.Generation {
		// The control plane kept a different generation as authoritative -
		// expected when an earlier, strongly-verified generation must not be
		// displaced by this one. The report is settled, not retried.
		r.logger.Info("recording report accepted but this generation is not authoritative",
			slog.String("event_id", archive.EventID))
	}
}

// recordingStateFor maps this node's local archival state onto the control
// plane's recording_state vocabulary.
//
// 'pending' reports local_finalized rather than b2_finalizing: at that
// point local finalization has genuinely completed but no B2 write has
// been attempted, and overstating that would blur exactly the local vs
// authoritative distinction the whole design keeps separate.
func recordingStateFor(archiveState string) string {
	switch archiveState {
	case store.B2ArchivePending:
		return "local_finalized"
	case store.B2ArchiveArchiving:
		return "b2_finalizing"
	case store.B2ArchiveArchived:
		return "b2_finalized"
	case store.B2ArchiveFailed:
		return "failed"
	default:
		return ""
	}
}

// reportBackoff grows the retry delay exponentially, bounded by max.
func reportBackoff(attempt int, base, max time.Duration) time.Duration {
	if base <= 0 {
		base = time.Second
	}
	delay := base
	for i := 1; i < attempt && delay < max; i++ {
		delay *= 2
	}
	if max > 0 && delay > max {
		delay = max
	}
	return delay
}
