package upload

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// contentTypeSegment is the required content type for every HLS media
// segment object (02_V1_ARCHITECTURE_SPEC.md "R2 object layout": "Every
// segment upload MUST set the correct video/MP2T content type").
const contentTypeSegment = "video/MP2T"

// segmentCacheControl gives immutable segment objects a long cache
// lifetime, per 02_V1_ARCHITECTURE_SPEC.md "Cloudflare delivery and
// cache policy": "Immutable segment responses MUST use a long cache
// lifetime, preferably Cache-Control: public, max-age=31536000,
// immutable."
const segmentCacheControl = "public, max-age=31536000, immutable"

// WorkerConfig configures Worker.
type WorkerConfig struct {
	ObjectPrefix   string
	Concurrency    int
	LeaseDuration  time.Duration
	RequestTimeout time.Duration
	RetryBaseDelay time.Duration
	RetryMaxDelay  time.Duration
	// OnConfirmed is called (non-blocking) after a segment's upload is
	// durably confirmed, so a manifest rebuild can be triggered for its
	// event. May be nil in tests that only exercise upload behavior.
	OnConfirmed func(eventID string)
}

// Worker is the durable upload worker: a pool of goroutines that
// atomically claim pending segment jobs, upload them to R2, verify
// success, and finalize queue state - never before confirmation. See
// 02_V1_ARCHITECTURE_SPEC.md "Segment upload and verification" and
// "Durable Media Agent queue".
type Worker struct {
	store       *store.Store
	objectStore ObjectStore
	cfg         WorkerConfig
	logger      *slog.Logger

	idleDelay time.Duration // overridable by tests only, via newWorkerForTest
}

// NewWorker returns a Worker. logger must not be nil.
func NewWorker(st *store.Store, objectStore ObjectStore, cfg WorkerConfig, logger *slog.Logger) *Worker {
	return &Worker{store: st, objectStore: objectStore, cfg: cfg, logger: logger, idleDelay: 500 * time.Millisecond}
}

// Run starts cfg.Concurrency claim/upload goroutines and blocks until
// ctx is cancelled and every goroutine has exited, so callers can run it
// in its own goroutine and WaitGroup.Wait it during graceful shutdown
// (the same pattern internal/reconcile.RunPeriodic uses).
func (w *Worker) Run(ctx context.Context) {
	concurrency := w.cfg.Concurrency
	if concurrency < 1 {
		concurrency = 1
	}

	var wg sync.WaitGroup
	for i := 0; i < concurrency; i++ {
		workerID := fmt.Sprintf("upload-worker-%d-%d", os.Getpid(), i)
		wg.Add(1)
		go func() {
			defer wg.Done()
			w.runLoop(ctx, workerID)
		}()
	}
	wg.Wait()
}

func (w *Worker) runLoop(ctx context.Context, workerID string) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		claimed, err := w.processOnce(ctx, workerID)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			w.logger.Error("upload worker: process failed", slog.String("worker_id", workerID), slog.String("error", err.Error()))
		}
		if !claimed {
			select {
			case <-ctx.Done():
				return
			case <-time.After(w.idleDelay):
			}
		}
	}
}

// processOnce claims and fully processes at most one segment. claimed
// reports whether a segment was available to claim at all (used only to
// decide whether to idle before the next attempt); it is true even if
// processing that segment ultimately failed.
func (w *Worker) processOnce(ctx context.Context, workerID string) (claimed bool, err error) {
	now := time.Now().UTC()
	job, found, err := w.store.ClaimUploadableSegment(ctx, workerID, w.cfg.LeaseDuration, now)
	if err != nil {
		return false, fmt.Errorf("claim uploadable segment: %w", err)
	}
	if !found {
		return false, nil
	}

	w.upload(ctx, job)
	return true, nil
}

func (w *Worker) upload(ctx context.Context, job store.SegmentJob) {
	reqCtx, cancel := context.WithTimeout(ctx, w.cfg.RequestTimeout)
	defer cancel()

	assignment, found, err := w.store.GetAssignmentByEventID(reqCtx, job.EventID)
	if err != nil || !found {
		// No cached assignment yet (or a lookup error): the playback_id
		// needed to compute this segment's object key is not available.
		// This is not a data-loss or corruption condition - it resolves
		// itself once the assignment is seeded - so it is always
		// retryable, never dead-lettered.
		msg := "no cached assignment for event"
		if err != nil {
			msg = "assignment lookup failed: " + err.Error()
		}
		w.retryLater(reqCtx, job, msg)
		return
	}

	key := SegmentKey(w.cfg.ObjectPrefix, assignment.PlaybackID, job.SessionID, job.LocalFileIdentity)

	file, err := os.Open(job.SpoolPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			w.deadLetter(reqCtx, job, fmt.Errorf("%w: %s", errLocalFileMissing, "spool file absent at upload time"))
			return
		}
		w.retryLater(reqCtx, job, "open spool file: "+err.Error())
		return
	}
	defer file.Close()

	hasher := sha256.New()
	size, err := io.Copy(hasher, file)
	if err != nil {
		w.retryLater(reqCtx, job, "read spool file: "+err.Error())
		return
	}
	sum := hex.EncodeToString(hasher.Sum(nil))
	if size != job.ByteSize || sum != job.SHA256 {
		w.deadLetter(reqCtx, job, fmt.Errorf("%w: recorded size=%d sha256=%s, on-disk size=%d sha256=%s",
			errLocalFileCorrupted, job.ByteSize, job.SHA256, size, sum))
		return
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		w.retryLater(reqCtx, job, "rewind spool file: "+err.Error())
		return
	}

	// HEAD-before-PUT: this is the idempotency mechanism that makes
	// upload safe to retry after a crash between a successful PUT and
	// the finalizing database write, and safe against two workers
	// racing the same segment (only one can hold the SQLite lease at a
	// time, but a defensive HEAD check costs nothing and covers a
	// worker that crashed after PUT but before its lease-holding
	// process could call ConfirmUpload). An existing object whose
	// metadata does not match is never overwritten - see ErrObjectMismatch.
	existing, headErr := w.objectStore.HeadObject(reqCtx, key)
	switch {
	case headErr == nil && existing.Exists:
		if !objectMatches(existing, job) {
			w.deadLetter(reqCtx, job, fmt.Errorf("%w: key %s", ErrObjectMismatch, key))
			return
		}
		// Already uploaded and verified by a prior attempt; confirm
		// without re-uploading.
	case headErr != nil && errors.Is(headErr, ErrObjectNotFound):
		if err := w.objectStore.PutObject(reqCtx, PutObjectInput{
			Key:          key,
			Body:         file,
			Size:         size,
			ContentType:  contentTypeSegment,
			CacheControl: segmentCacheControl,
			Metadata:     segmentMetadata(job),
		}); err != nil {
			w.handleProviderError(reqCtx, job, err)
			return
		}

		confirmed, err := w.objectStore.HeadObject(reqCtx, key)
		if err != nil {
			w.handleProviderError(reqCtx, job, err)
			return
		}
		if !objectMatches(confirmed, job) {
			w.deadLetter(reqCtx, job, fmt.Errorf("%w: key %s (post-upload verification)", ErrObjectMismatch, key))
			return
		}
	default:
		w.handleProviderError(reqCtx, job, headErr)
		return
	}

	now := time.Now().UTC()
	if err := w.store.ConfirmUpload(reqCtx, job.ID, key, now); err != nil {
		w.logger.Error("upload worker: confirm upload failed", slog.Int64("segment_id", job.ID), slog.String("error", err.Error()))
		return
	}
	w.logger.Info("segment upload confirmed",
		slog.String("event_id", job.EventID), slog.String("session_id", job.SessionID), slog.Int64("segment_id", job.ID))

	if w.cfg.OnConfirmed != nil {
		w.cfg.OnConfirmed(job.EventID)
	}
}

func (w *Worker) handleProviderError(ctx context.Context, job store.SegmentJob, err error) {
	c := classifyUploadError(err)
	if c.retryable {
		w.retryLater(ctx, job, err.Error())
		return
	}
	w.deadLetter(ctx, job, err)
}

func (w *Worker) retryLater(ctx context.Context, job store.SegmentJob, message string) {
	now := time.Now().UTC()
	delay := backoffDelay(job.UploadAttemptCount+1, w.cfg.RetryBaseDelay, w.cfg.RetryMaxDelay)
	if err := w.store.ReleaseUploadForRetry(ctx, job.ID, sanitizeErrorMessage(message), now.Add(delay), now); err != nil {
		w.logger.Error("upload worker: release for retry failed", slog.Int64("segment_id", job.ID), slog.String("error", err.Error()))
	}
	w.logger.Warn("segment upload will be retried",
		slog.String("event_id", job.EventID), slog.Int64("segment_id", job.ID), slog.Duration("delay", delay))
}

func (w *Worker) deadLetter(ctx context.Context, job store.SegmentJob, err error) {
	now := time.Now().UTC()
	if dbErr := w.store.DeadLetterUpload(ctx, job.ID, sanitizeErrorMessage(err.Error()), now); dbErr != nil {
		w.logger.Error("upload worker: dead-letter failed", slog.Int64("segment_id", job.ID), slog.String("error", dbErr.Error()))
	}
	w.logger.Error("segment upload dead-lettered: requires operator intervention",
		slog.String("event_id", job.EventID), slog.Int64("segment_id", job.ID), slog.String("error", err.Error()))
}

// objectMatches reports whether info (from HeadObject) is consistent
// with job's recorded byte size and sha256. It never trusts ETag as a
// content checksum (02_V1_ARCHITECTURE_SPEC.md), relying only on
// ContentLength and the custom sha256 metadata this worker itself
// writes.
func objectMatches(info ObjectInfo, job store.SegmentJob) bool {
	if info.Size != job.ByteSize {
		return false
	}
	got, ok := info.Metadata["sha256"]
	return ok && got == job.SHA256
}

func segmentMetadata(job store.SegmentJob) map[string]string {
	return map[string]string{
		"sha256":     job.SHA256,
		"event_id":   job.EventID,
		"session_id": job.SessionID,
		"sequence":   strconv.FormatInt(job.SeqNo, 10),
		"duration":   strconv.FormatFloat(job.DurationSeconds, 'f', -1, 64),
	}
}

// sanitizeErrorMessage bounds and flattens a stored error message.
// Provider/network errors can legitimately be long (wrapped chains,
// endpoint URLs); credentials and stream tokens never appear in any
// error this package produces (see errors.go classification - no path
// here formats a raw secret into an error string), but this is a
// defense-in-depth length/shape bound so a database column never
// receives an unbounded or newline-laden value.
func sanitizeErrorMessage(msg string) string {
	const maxLen = 2048
	clean := make([]rune, 0, len(msg))
	for _, r := range msg {
		if r == '\n' || r == '\r' {
			r = ' '
		}
		clean = append(clean, r)
	}
	s := string(clean)
	if len(s) > maxLen {
		s = s[:maxLen]
	}
	return s
}
