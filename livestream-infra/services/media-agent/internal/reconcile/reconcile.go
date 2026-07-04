// Package reconcile implements the Media Agent's startup and periodic
// recovery pass: it recovers incomplete session and segment-queue
// state, discovers durable spool files that lack a queue record,
// reports (without deleting) queue records whose file is missing, and
// bounds cleanup to this service's own exactly-named temporary files.
// See 02_V1_ARCHITECTURE_SPEC.md "A reconciliation process MUST scan
// both staging and durable-spool paths at startup and periodically to
// recover completed files that lack a queue row."
package reconcile

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// capturingStuckAfter bounds how long a segment_jobs row may remain in
// "capturing" status before reconciliation treats it as abandoned by a
// crashed or killed process rather than a genuinely in-flight capture
// running concurrently with this reconciliation pass. A real capture
// completes in well under a second; this margin is deliberately
// generous to avoid ever racing live traffic. It is an internal safety
// margin, not operator-facing behavior, so it is not configuration.
const capturingStuckAfter = 30 * time.Second

// tempFileMaxAge bounds how long an orphaned ".tmp-eventcast-*" file
// (left behind only if a process was killed between CreateTemp and the
// rename that would have replaced it) may exist before periodic
// reconciliation removes it. This is the only cleanup this package ever
// performs, and only for files matching this exact, service-owned name
// pattern.
const tempFileMaxAge = 1 * time.Hour

const tempFilePrefix = ".tmp-eventcast-"

// Config configures one Reconciler.
type Config struct {
	SpoolRoot           string
	SessionStaleTimeout time.Duration
}

// Report summarizes one reconciliation pass for logging. All fields are
// bounded counts; no file paths, identifiers, or secrets.
type Report struct {
	OrphanSegmentsReconciled int
	StuckCapturesResolved    int
	SegmentsMarkedMissing    int
	SessionsMarkedStale      int
	TempFilesCleaned         int
	// IntegrityOK is false only if the periodic SQLite integrity check
	// reported a problem; a checkpoint or integrity-check failure never
	// aborts the rest of a reconciliation pass (see RunOnce), since a
	// database-level fault is exactly the condition operators most need
	// this pass to keep running and reporting, not crash-loop on.
	IntegrityOK bool
}

// Reconciler runs recovery passes against a Store and the configured
// spool root. now and stuckAfter are overridable only from within this
// package (by tests constructing a Reconciler literal directly) so the
// 30-second real-world stuck-capture margin does not force unit tests
// to sleep 30 seconds; production callers always get the defaults via
// New.
type Reconciler struct {
	store      *store.Store
	cfg        Config
	logger     *slog.Logger
	now        func() time.Time
	stuckAfter time.Duration

	// OnComplete, if set, is called after every successful RunOnce pass
	// (both the explicit startup call in cmd/media-agent/main.go and each
	// RunPeriodic iteration) with that pass's Report and completion time.
	// It exists so metrics can reflect the latest reconciliation outcome
	// without a separate durable table - reconciliation reports are
	// operational telemetry, not business state - and must return
	// quickly and never panic; a slow or misbehaving hook would otherwise
	// delay the next scheduled pass.
	OnComplete func(Report, time.Time)
}

// New returns a Reconciler. logger must not be nil.
func New(st *store.Store, cfg Config, logger *slog.Logger) *Reconciler {
	return &Reconciler{store: st, cfg: cfg, logger: logger, now: time.Now, stuckAfter: capturingStuckAfter}
}

// RunOnce performs one full reconciliation pass: orphan spool file
// discovery, stuck-capture resolution, missing-file detection, stale
// session recovery, and bounded temp-file cleanup. It is safe to call
// at startup (before serving traffic) and periodically thereafter.
func (r *Reconciler) RunOnce(ctx context.Context) (Report, error) {
	var report Report

	if err := r.reconcileSpoolFiles(ctx, &report); err != nil {
		return report, fmt.Errorf("reconcile: spool scan: %w", err)
	}

	if err := r.resolveStuckCaptures(ctx, &report); err != nil {
		return report, fmt.Errorf("reconcile: stuck captures: %w", err)
	}

	if err := r.markMissingFiles(ctx, &report); err != nil {
		return report, fmt.Errorf("reconcile: missing files: %w", err)
	}

	now := r.now().UTC()
	staleCount, err := r.store.ReconcileStaleActive(ctx, now.Add(-r.cfg.SessionStaleTimeout), now)
	if err != nil {
		return report, fmt.Errorf("reconcile: stale sessions: %w", err)
	}
	report.SessionsMarkedStale = staleCount

	// Periodic checkpointing and integrity checks
	// (03_DATA_MODEL_AND_API_CONTRACTS.md "Local SQLite schema
	// responsibilities"). Neither failure aborts this reconciliation
	// pass or is treated as fatal: a checkpoint is a routine maintenance
	// operation, and an unhealthy database is a critical operational
	// signal to log and report, not a reason to stop recovering
	// everything else this pass already found.
	if err := r.store.Checkpoint(ctx); err != nil {
		r.logger.Error("reconciliation: WAL checkpoint failed", slog.String("error", err.Error()))
	}
	if err := r.store.IntegrityCheck(ctx); err != nil {
		r.logger.Error("reconciliation: database integrity check failed", slog.String("error", err.Error()))
		report.IntegrityOK = false
	} else {
		report.IntegrityOK = true
	}

	return report, nil
}

// RunPeriodic runs RunOnce immediately and then every interval until ctx
// is cancelled, logging each pass. It returns when ctx is done, so
// callers can wait on it as part of graceful shutdown.
func (r *Reconciler) RunPeriodic(ctx context.Context, interval time.Duration) {
	r.runAndLog(ctx)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.runAndLog(ctx)
		}
	}
}

func (r *Reconciler) runAndLog(ctx context.Context) {
	report, err := r.RunOnce(ctx)
	if err != nil {
		r.logger.Error("reconciliation pass failed", slog.String("error", err.Error()))
		return
	}
	if r.OnComplete != nil {
		r.OnComplete(report, r.now().UTC())
	}
	r.logger.Info("reconciliation pass complete",
		slog.Int("orphan_segments_reconciled", report.OrphanSegmentsReconciled),
		slog.Int("stuck_captures_resolved", report.StuckCapturesResolved),
		slog.Int("segments_marked_missing", report.SegmentsMarkedMissing),
		slog.Int("sessions_marked_stale", report.SessionsMarkedStale),
		slog.Int("temp_files_cleaned", report.TempFilesCleaned),
		slog.Bool("integrity_ok", report.IntegrityOK),
	)
}

// reconcileSpoolFiles walks the spool root. Files matching this
// service's exact temporary-file name pattern are handled by the
// bounded cleanup rule; every other regular file is expected to sit at
// spoolRoot/<event_id>/<session_id>/<local_file_identity> (the layout
// internal/spool.Capture always produces). A file at that exact depth
// with no matching segment_jobs row is a durable capture that survived
// a crash between fsync and the finalizing database write; it is
// reconciled into a queued row using its own name as the idempotency
// key components, never duplicated on repeated runs. A file with
// unexpected structure is left untouched and only logged - this package
// never deletes or moves a file it does not fully recognize.
func (r *Reconciler) reconcileSpoolFiles(ctx context.Context, report *Report) error {
	root := r.cfg.SpoolRoot
	now := r.now()

	return filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) && path == root {
				return nil // spool root not created yet; nothing to reconcile
			}
			return err
		}
		if d.IsDir() {
			return nil
		}

		name := d.Name()
		if strings.HasPrefix(name, tempFilePrefix) {
			return r.maybeCleanTempFile(path, d, now, report)
		}

		rel, err := filepath.Rel(root, path)
		if err != nil {
			return fmt.Errorf("relativize %s: %w", path, err)
		}
		parts := strings.Split(filepath.ToSlash(rel), "/")
		if len(parts) != 3 {
			r.logger.Warn("reconciliation found a spool file with unexpected layout; leaving it untouched",
				slog.Int("path_depth", len(parts)))
			return nil
		}
		eventID, sessionID, fileName := parts[0], parts[1], parts[2]

		idempotencyKey := eventID + "|" + sessionID + "|" + fileName
		_, found, err := r.store.GetSegmentByIdempotencyKey(ctx, idempotencyKey)
		if err != nil {
			return err
		}
		if found {
			return nil
		}

		seqNo, ok := parseSeqNoPrefix(fileName)
		if !ok {
			r.logger.Warn("reconciliation found an untracked spool file with an unrecognized name; leaving it untouched")
			return nil
		}

		size, sum, err := hashFile(path)
		if err != nil {
			return fmt.Errorf("hash orphan spool file: %w", err)
		}

		if err := r.store.InsertReconciledSegment(ctx, store.ClaimSegmentInput{
			IdempotencyKey:    idempotencyKey,
			EventID:           eventID,
			SessionID:         sessionID,
			LocalFileIdentity: fileName,
			SeqNo:             seqNo,
		}, path, size, sum, now); err != nil {
			return err
		}
		report.OrphanSegmentsReconciled++
		return nil
	})
}

func (r *Reconciler) maybeCleanTempFile(path string, d fs.DirEntry, now time.Time, report *Report) error {
	info, err := d.Info()
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil // removed concurrently; nothing to do
		}
		return fmt.Errorf("stat temp file: %w", err)
	}
	if now.Sub(info.ModTime()) < tempFileMaxAge {
		return nil // may still be a genuinely in-flight copy
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove stale temp file: %w", err)
	}
	report.TempFilesCleaned++
	return nil
}

// resolveStuckCaptures finds segment_jobs rows a process claimed
// (status = "capturing") but never finalized or failed, because it was
// killed or crashed mid-capture. The expected destination path is
// deterministic from the row's own identifiers, so reconciliation can
// tell the two possible outcomes apart: the file exists (the durable
// write actually completed; only the finalizing UPDATE was lost) or it
// does not (capture never completed).
func (r *Reconciler) resolveStuckCaptures(ctx context.Context, report *Report) error {
	stuck, err := r.store.ListStuckCapturing(ctx, r.now().Add(-r.stuckAfter))
	if err != nil {
		return err
	}

	now := r.now()
	for _, job := range stuck {
		expectedPath := filepath.Join(r.cfg.SpoolRoot, job.EventID, job.SessionID, job.LocalFileIdentity)
		if info, statErr := os.Stat(expectedPath); statErr == nil && info.Mode().IsRegular() {
			size, sum, hashErr := hashFile(expectedPath)
			if hashErr != nil {
				return fmt.Errorf("hash stuck-capture file: %w", hashErr)
			}
			if err := r.store.FinalizeSegment(ctx, job.ID, expectedPath, size, sum, now); err != nil {
				return err
			}
		} else {
			if err := r.store.FailSegment(ctx, job.ID, "capture never completed before process restart", now); err != nil {
				return err
			}
		}
		report.StuckCapturesResolved++
	}
	return nil
}

// markMissingFiles reports (without deleting anything) every queued
// segment_jobs row whose spool file is no longer present on disk, per
// the frozen failure policy: unexplained absence of protected media is
// surfaced, never silently repaired or the row silently dropped.
func (r *Reconciler) markMissingFiles(ctx context.Context, report *Report) error {
	queued, err := r.store.ListSegmentsByStatus(ctx, store.SegmentQueued)
	if err != nil {
		return err
	}

	now := r.now()
	for _, job := range queued {
		if _, statErr := os.Stat(job.SpoolPath); statErr != nil {
			if !errors.Is(statErr, fs.ErrNotExist) {
				return fmt.Errorf("stat segment %d: %w", job.ID, statErr)
			}
			if err := r.store.MarkSegmentMissing(ctx, job.ID, now); err != nil {
				return err
			}
			report.SegmentsMarkedMissing++
		}
	}
	return nil
}

func parseSeqNoPrefix(fileName string) (int64, bool) {
	prefix, _, ok := strings.Cut(fileName, "-")
	if !ok {
		return 0, false
	}
	n, err := strconv.ParseInt(prefix, 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

func hashFile(path string) (int64, string, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, "", err
	}
	defer f.Close()
	h := sha256.New()
	written, err := io.Copy(h, f)
	if err != nil {
		return 0, "", err
	}
	return written, hex.EncodeToString(h.Sum(nil)), nil
}
