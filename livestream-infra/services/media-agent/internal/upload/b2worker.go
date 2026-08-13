package upload

import (
	"context"
	"log/slog"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// B2ArchiveWorkerConfig configures B2ArchiveWorker.
type B2ArchiveWorkerConfig struct {
	RetryBaseDelay time.Duration
	RetryMaxDelay  time.Duration
	// LeaseDuration bounds how long a claimed archive stays invisible to
	// other workers. It must comfortably exceed a realistic archival pass
	// (an event's whole segment set), because expiring mid-pass would let a
	// second worker start the same generation concurrently. Defaults to
	// defaultB2ArchiveLease when unset.
	LeaseDuration time.Duration
}

// defaultB2ArchiveLease is generous on purpose: re-doing an interrupted
// pass is cheap and safe (archival is idempotent and content-addressed),
// whereas an over-short lease risks duplicated concurrent work.
const defaultB2ArchiveLease = 15 * time.Minute

// B2ArchiveWorker drains pending b2_archives work in the background.
//
// Archival is deliberately NOT performed inside the operator finalize
// request. A finalize call only records the generation that must be
// archived and returns; a slow transfer, a B2 outage, or report retries
// must never hold that HTTP request open. This worker then does the
// network work on its own schedule and survives restarts, because all of
// its state is durable in SQLite rather than in an in-flight request.
type B2ArchiveWorker struct {
	store    *store.Store
	archiver *B2Archiver
	cfg      B2ArchiveWorkerConfig
	logger   *slog.Logger
	now      func() time.Time
}

// NewB2ArchiveWorker returns a B2ArchiveWorker. logger must not be nil.
func NewB2ArchiveWorker(st *store.Store, archiver *B2Archiver, cfg B2ArchiveWorkerConfig, logger *slog.Logger) *B2ArchiveWorker {
	if cfg.LeaseDuration <= 0 {
		cfg.LeaseDuration = defaultB2ArchiveLease
	}
	return &B2ArchiveWorker{store: st, archiver: archiver, cfg: cfg, logger: logger, now: time.Now}
}

// Run performs an immediate pass and then one every interval until ctx is
// cancelled, matching RetentionWorker's shape.
func (w *B2ArchiveWorker) Run(ctx context.Context, interval time.Duration) {
	w.RunOnce(ctx)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			w.RunOnce(ctx)
		}
	}
}

// RunOnce claims and processes every archive currently due, one at a time.
// Claiming is atomic in SQLite, so two workers (or a restarted process
// racing its own predecessor) can never archive the same row concurrently.
func (w *B2ArchiveWorker) RunOnce(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		work, found, err := w.store.ClaimB2ArchiveWork(ctx, w.now().UTC(), w.cfg.LeaseDuration)
		if err != nil {
			w.logger.Error("b2 archive worker: claim failed", slog.String("error", err.Error()))
			return
		}
		if !found {
			return
		}
		w.process(ctx, work)
	}
}

func (w *B2ArchiveWorker) process(ctx context.Context, work store.B2Archive) {
	result, err := w.archiver.ArchiveEvent(ctx, work.EventID, work.Generation)
	now := w.now().UTC()

	if err != nil {
		delay := backoffDelay(work.ArchiveAttempts+1, w.cfg.RetryBaseDelay, w.cfg.RetryMaxDelay)
		if markErr := w.store.MarkB2ArchiveFailed(ctx, work.EventID, work.Generation,
			sanitizeErrorMessage(err.Error()), now.Add(delay), now); markErr != nil {
			w.logger.Error("b2 archive worker: record failure failed",
				slog.String("event_id", work.EventID), slog.String("error", markErr.Error()))
		}
		w.logger.Warn("b2 archival will be retried",
			slog.String("event_id", work.EventID), slog.Duration("delay", delay), slog.String("error", err.Error()))
		return
	}

	if result.Superseded {
		// The row has already converged (or is about to converge) to a newer
		// generation. Leave it to the next pass rather than recording work
		// that describes a superseded segment set as authoritative.
		w.logger.Info("b2 archival superseded by a newer finalization generation",
			slog.String("event_id", work.EventID), slog.String("reason", result.Reason))
		return
	}

	if !result.Archived {
		delay := backoffDelay(work.ArchiveAttempts+1, w.cfg.RetryBaseDelay, w.cfg.RetryMaxDelay)
		if markErr := w.store.MarkB2ArchiveFailed(ctx, work.EventID, work.Generation,
			sanitizeErrorMessage(result.Reason), now.Add(delay), now); markErr != nil {
			w.logger.Error("b2 archive worker: record non-archival failed",
				slog.String("event_id", work.EventID), slog.String("error", markErr.Error()))
		}
		return
	}

	applied, err := w.store.MarkB2Archived(ctx, work.EventID, work.Generation,
		w.archiver.cfg.Bucket, result.PlaylistKey, result.ObjectCount, now)
	if err != nil {
		w.logger.Error("b2 archive worker: record success failed",
			slog.String("event_id", work.EventID), slog.String("error", err.Error()))
		return
	}
	if !applied {
		// The generation guard rejected the write: the row moved on while
		// this pass ran. Correct outcome, not an error.
		w.logger.Info("b2 archival completed for a superseded generation; discarding",
			slog.String("event_id", work.EventID))
		return
	}

	w.logger.Info("b2 archive completed",
		slog.String("event_id", work.EventID),
		slog.Int("object_count", result.ObjectCount))
}
