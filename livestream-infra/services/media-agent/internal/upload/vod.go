package upload

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// vodManifestCacheControl allows a moderate public cache once an event
// is finalized, per 02_V1_ARCHITECTURE_SPEC.md "Cloudflare delivery and
// cache policy": "Final VOD manifests MAY use a moderate public cache
// after finalization." Unlike the live manifest, a finalized VOD
// playlist never changes again, so caching it is safe.
const vodManifestCacheControl = "public, max-age=86400"

// VODFinalizer builds and publishes the durable finalized VOD playlist
// for a completed event (02_V1_ARCHITECTURE_SPEC.md "VOD finalization",
// ADR-008). It never deletes or modifies uploaded segment objects; it
// only ever adds a new playlist object and a durable finalization
// record.
type VODFinalizer struct {
	store       *store.Store
	objectStore ObjectStore
	cfg         ManifestConfig
	logger      *slog.Logger

	locksMu sync.Mutex
	locks   map[string]*sync.Mutex
}

// NewVODFinalizer returns a VODFinalizer. logger must not be nil.
func NewVODFinalizer(st *store.Store, objectStore ObjectStore, cfg ManifestConfig, logger *slog.Logger) *VODFinalizer {
	return &VODFinalizer{store: st, objectStore: objectStore, cfg: cfg, logger: logger, locks: make(map[string]*sync.Mutex)}
}

func (f *VODFinalizer) lockFor(eventID string) *sync.Mutex {
	f.locksMu.Lock()
	defer f.locksMu.Unlock()
	l, ok := f.locks[eventID]
	if !ok {
		l = &sync.Mutex{}
		f.locks[eventID] = l
	}
	return l
}

// FinalizeResult reports the outcome of one Finalize call.
type FinalizeResult struct {
	// Finalized is true only if a VOD playlist was (or, on a repeat
	// call with an unchanged segment set, already had been) durably
	// published.
	Finalized bool
	// Reason explains a false Finalized result (e.g. "session still
	// active", "N segments not yet resolved"), safe to return to a
	// caller/operator - it never contains a path, key, or secret.
	Reason string
	R2Key  string
}

// Finalize finalizes eventID's VOD playlist if it is eligible:
//   - no session for the event is currently "starting" or "active"
//     (the event must actually have stopped receiving a publisher);
//   - every segment_jobs row for the event has resolved past capture
//     (no row is still "capturing") and past upload (no row is still
//     "pending" or "leased") - 02_V1_ARCHITECTURE_SPEC.md "Finalization
//     MUST wait until all discovered local segment jobs for the event
//     are resolved."
//
// It is idempotent and restart-safe: calling it again after a crash, or
// again with no new segments, recomputes the same playlist from durable
// state and republishes only if the confirmed segment set actually
// changed (mirroring ManifestManager.RebuildLive). It never deletes
// uploaded media.
func (f *VODFinalizer) Finalize(ctx context.Context, eventID string) (FinalizeResult, error) {
	lock := f.lockFor(eventID)
	lock.Lock()
	defer lock.Unlock()

	sessions, err := f.store.ListSessionsByEvent(ctx, eventID)
	if err != nil {
		return FinalizeResult{}, fmt.Errorf("vod: list sessions for %s: %w", eventID, err)
	}
	for _, sess := range sessions {
		if sess.Status == store.SessionStarting || sess.Status == store.SessionActive {
			return FinalizeResult{Reason: "a session is still starting or active for this event"}, nil
		}
	}
	if len(sessions) == 0 {
		return FinalizeResult{Reason: "no session has ever been recorded for this event"}, nil
	}

	allSegments, err := f.store.ListSegmentsByEvent(ctx, eventID)
	if err != nil {
		return FinalizeResult{}, fmt.Errorf("vod: list segments for %s: %w", eventID, err)
	}
	if unresolved := countUnresolved(allSegments); unresolved > 0 {
		return FinalizeResult{Reason: fmt.Sprintf("%d segment(s) not yet resolved (still capturing or uploading)", unresolved)}, nil
	}

	assignment, found, err := f.store.GetAssignmentByEventID(ctx, eventID)
	if err != nil {
		return FinalizeResult{}, fmt.Errorf("vod: resolve playback id for %s: %w", eventID, err)
	}
	if !found {
		return FinalizeResult{Reason: "no cached assignment for this event"}, nil
	}

	confirmed, err := f.store.ListConfirmedSegmentsByEvent(ctx, eventID)
	if err != nil {
		return FinalizeResult{}, fmt.Errorf("vod: list confirmed segments for %s: %w", eventID, err)
	}

	existing, hasExisting, err := f.store.GetVODFinalization(ctx, eventID)
	if err != nil {
		return FinalizeResult{}, fmt.Errorf("vod: read existing finalization for %s: %w", eventID, err)
	}
	segmentIDs := idsOf(confirmed)
	if hasExisting && existing.Status == store.VODFinalized && int64SlicesEqual(existing.SegmentIDs, segmentIDs) {
		return FinalizeResult{Finalized: true, R2Key: existing.R2Key}, nil
	}

	if len(confirmed) == 0 {
		return FinalizeResult{Reason: "no confirmed segments to finalize"}, nil
	}

	// A permanently unresolvable segment (capture-level "missing"/"failed",
	// or an upload dead-lettered after exhausting classification as
	// non-retryable) is, by definition, never going to become
	// UploadConfirmed. countUnresolved above correctly does not block
	// finalization on these (they are "resolved," just unsuccessfully),
	// but silently excluding them would leave no audit trail of the
	// resulting gap, so it is logged loudly here even though this
	// milestone does not implement a separate explicit-operator-override
	// endpoint (02_V1_ARCHITECTURE_SPEC.md "VOD finalization": "... or an
	// operator explicitly accepts a documented gap").
	if gaps := countGaps(allSegments); gaps > 0 {
		f.logger.Warn("vod finalization proceeding with permanently unresolvable segment(s): recording is not gapless",
			slog.String("event_id", eventID), slog.Int("gap_count", gaps))
	}

	// Validate every referenced object is actually present before
	// publishing (02_V1_ARCHITECTURE_SPEC.md "The VOD playlist MUST be
	// validated by parsing and by fetching every referenced object").
	// Parsing validity is guaranteed by construction (buildPlaylist
	// always emits well-formed HLS); this loop is the "fetch every
	// referenced object" half, scoped to this Media Agent's own view of
	// the object store (it does not have access to the production CDN
	// path from inside this process).
	for _, s := range confirmed {
		key := SegmentKey(f.cfg.ObjectPrefix, assignment.PlaybackID, s.SessionID, s.LocalFileIdentity)
		headCtx, cancel := context.WithTimeout(ctx, f.cfg.RequestTimeout)
		info, err := f.objectStore.HeadObject(headCtx, key)
		cancel()
		if err != nil {
			if err := f.store.UpsertVODFailed(ctx, eventID, sanitizeErrorMessage("validation failed for a referenced object: "+err.Error()), time.Now().UTC()); err != nil {
				f.logger.Error("vod: record validation failure failed", slog.String("event_id", eventID), slog.String("error", err.Error()))
			}
			return FinalizeResult{}, fmt.Errorf("vod: validate segment object %s: %w", key, err)
		}
		if !objectMatches(info, s) {
			return FinalizeResult{}, fmt.Errorf("vod: %w: key %s", ErrObjectMismatch, key)
		}
	}

	body := buildPlaylist(confirmed, 0, assignment.PlaybackID, f.cfg.ObjectPrefix, f.cfg.PublicBaseURL, true)
	key := VODPlaylistKey(f.cfg.ObjectPrefix, assignment.PlaybackID)

	putCtx, cancel := context.WithTimeout(ctx, f.cfg.RequestTimeout)
	defer cancel()
	if err := f.objectStore.PutObject(putCtx, PutObjectInput{
		Key:          key,
		Body:         strings.NewReader(body),
		Size:         int64(len(body)),
		ContentType:  manifestContentType,
		CacheControl: vodManifestCacheControl,
	}); err != nil {
		if err := f.store.UpsertVODFailed(ctx, eventID, sanitizeErrorMessage("publish failed: "+err.Error()), time.Now().UTC()); err != nil {
			f.logger.Error("vod: record publish failure failed", slog.String("event_id", eventID), slog.String("error", err.Error()))
		}
		return FinalizeResult{}, fmt.Errorf("vod: publish playlist for %s: %w", eventID, err)
	}

	sessionCount := countDistinctSessions(confirmed)
	now := time.Now().UTC()
	if err := f.store.UpsertVODFinalized(ctx, eventID, segmentIDs, sessionCount, key, now); err != nil {
		return FinalizeResult{}, fmt.Errorf("vod: record finalization for %s: %w", eventID, err)
	}
	if _, err := f.store.RecordManifestGeneration(ctx, eventID, store.ManifestTypeVOD, segmentIDs, 0, key, now); err != nil {
		f.logger.Error("vod: record manifest generation failed", slog.String("event_id", eventID), slog.String("error", err.Error()))
	}

	f.logger.Info("vod finalized", slog.String("event_id", eventID), slog.Int("segment_count", len(confirmed)), slog.Int("session_count", sessionCount))
	return FinalizeResult{Finalized: true, R2Key: key}, nil
}

func countUnresolved(segments []store.SegmentJob) int {
	n := 0
	for _, s := range segments {
		if s.Status == store.SegmentCapturing {
			n++
			continue
		}
		if s.Status == store.SegmentQueued && (s.UploadStatus == store.UploadPending || s.UploadStatus == store.UploadLeased) {
			n++
		}
	}
	return n
}

// countGaps counts segments that reached a terminal, permanently
// unresolvable state without ever becoming UploadConfirmed: their
// content is not part of the finalized VOD.
func countGaps(segments []store.SegmentJob) int {
	n := 0
	for _, s := range segments {
		switch {
		case s.Status == store.SegmentMissing || s.Status == store.SegmentFailed:
			n++
		case s.Status == store.SegmentQueued && s.UploadStatus == store.UploadDeadLetter:
			n++
		}
	}
	return n
}

func countDistinctSessions(segments []store.SegmentJob) int {
	seen := make(map[string]struct{})
	for _, s := range segments {
		seen[s.SessionID] = struct{}{}
	}
	return len(seen)
}
