package upload

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// RetentionConfig configures RetentionWorker.
type RetentionConfig struct {
	// SpoolRoot bounds every deletion this worker ever performs: a
	// segment row whose recorded spool_path does not resolve inside
	// SpoolRoot is never touched, logged as a warning instead
	// (02_V1_ARCHITECTURE_SPEC.md "Retention and deletion",
	// 09_CLAUDE_CODE_EXECUTION_RULES.md "All file paths must be
	// validated against the spool root").
	SpoolRoot string
	// LocalRetentionDelay is how long after VOD finalization a
	// confirmed segment's local spool copy remains before deletion
	// becomes eligible. Default 24h (02_V1_ARCHITECTURE_SPEC.md
	// "Retention and deletion").
	LocalRetentionDelay time.Duration
}

// RetentionWorker deletes local spool copies only once they are fully
// safe to remove: confirmed in R2, referenced by a finalized VOD
// playlist, and past the configured local safety delay. It never
// deletes an R2 object - remote lifecycle is left to the documented R2
// lifecycle policy (02_V1_ARCHITECTURE_SPEC.md "Retention and
// deletion": "Cleanup MUST be application-driven and guarded ...
// R2 lifecycle rule MAY act as a delayed backstop but MUST NOT be the
// only archive-safety check" - the inverse case, an R2-side rule as
// backstop for hot-storage cleanup this worker does not perform, is
// exactly the intended division of responsibility here).
type RetentionWorker struct {
	store  *store.Store
	cfg    RetentionConfig
	logger *slog.Logger
	now    func() time.Time
}

// NewRetentionWorker returns a RetentionWorker. logger must not be nil.
func NewRetentionWorker(st *store.Store, cfg RetentionConfig, logger *slog.Logger) *RetentionWorker {
	return &RetentionWorker{store: st, cfg: cfg, logger: logger, now: time.Now}
}

// Run performs an immediate pass and then one every interval, until ctx
// is cancelled.
func (w *RetentionWorker) Run(ctx context.Context, interval time.Duration) {
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

// RunOnce evaluates every VOD-finalized event past its retention delay
// and deletes each eligible segment's local spool copy.
func (w *RetentionWorker) RunOnce(ctx context.Context) {
	cutoff := w.now().UTC().Add(-w.cfg.LocalRetentionDelay)
	eventIDs, err := w.store.ListFinalizedEventsEligibleForCleanup(ctx, cutoff)
	if err != nil {
		w.logger.Error("retention: list eligible events failed", slog.String("error", err.Error()))
		return
	}

	var deleted, skipped int
	for _, eventID := range eventIDs {
		candidates, err := w.store.ListRetentionCandidates(ctx, eventID)
		if err != nil {
			w.logger.Error("retention: list candidates failed", slog.String("event_id", eventID), slog.String("error", err.Error()))
			continue
		}
		for _, seg := range candidates {
			ok, err := w.deleteIfEligible(ctx, seg)
			if err != nil {
				w.logger.Error("retention: delete failed", slog.String("event_id", eventID), slog.Int64("segment_id", seg.ID), slog.String("error", err.Error()))
				continue
			}
			if ok {
				deleted++
			} else {
				skipped++
			}
		}
	}
	if deleted > 0 || skipped > 0 {
		w.logger.Info("retention pass complete", slog.Int("deleted", deleted), slog.Int("skipped", skipped))
	}
}

// deleteIfEligible removes seg's local spool file, if and only if its
// recorded path resolves inside the configured spool root. It never
// deletes anything else: not a directory, not a glob match, not a file
// merely "near" the recorded path - exactly the one path this
// database row owns.
func (w *RetentionWorker) deleteIfEligible(ctx context.Context, seg store.SegmentJob) (bool, error) {
	if seg.SpoolPath == "" || !isWithinRoot(w.cfg.SpoolRoot, seg.SpoolPath) {
		w.logger.Warn("retention: refusing to delete a segment whose recorded path is outside the configured spool root",
			slog.Int64("segment_id", seg.ID))
		return false, nil
	}

	if err := os.Remove(seg.SpoolPath); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return false, fmt.Errorf("remove spool file: %w", err)
	}

	if err := w.store.MarkLocalDeleted(ctx, seg.ID, w.now().UTC()); err != nil {
		return false, fmt.Errorf("mark locally deleted: %w", err)
	}
	return true, nil
}

// isWithinRoot reports whether candidate is root itself or lives inside
// it, using path-segment comparison (not a string prefix check, which
// would incorrectly treat "/data" as containing "/data-other"). It
// mirrors internal/config's pathContains, kept as its own small copy
// here rather than a shared export: the two packages' path-safety
// checks are deliberately independent so a change to one can never
// silently weaken the other.
func isWithinRoot(root, candidate string) bool {
	if root == "" {
		return false
	}
	cleanRoot := filepath.Clean(root)
	cleanCandidate := filepath.Clean(candidate)
	if cleanRoot == cleanCandidate {
		return true
	}
	rel, err := filepath.Rel(cleanRoot, cleanCandidate)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
