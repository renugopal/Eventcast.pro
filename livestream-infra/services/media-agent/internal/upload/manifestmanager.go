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

const manifestContentType = "application/vnd.apple.mpegurl"

// liveManifestCacheControl matches ADR-021 / 02_V1_ARCHITECTURE_SPEC.md
// "Cloudflare delivery and cache policy": "Live manifests MUST use
// Cache-Control: no-store or an explicitly tested edge TTL no greater
// than one second."
const liveManifestCacheControl = "no-store"

// ManifestConfig configures ManifestManager.
type ManifestConfig struct {
	ObjectPrefix   string
	PublicBaseURL  string
	DVRWindow      time.Duration
	RequestTimeout time.Duration
}

// ManifestManager builds and publishes the authoritative live/DVR
// manifest per 02_V1_ARCHITECTURE_SPEC.md "Authoritative live manifest"
// (ADR-006: "The Media Agent, not SRS, MUST build the public live
// manifest"). Exactly one rebuild for a given event runs at a time (a
// per-event mutex), matching "Only one active manifest writer lease may
// exist per event."
type ManifestManager struct {
	store       *store.Store
	objectStore ObjectStore
	cfg         ManifestConfig
	logger      *slog.Logger

	locksMu sync.Mutex
	locks   map[string]*sync.Mutex

	touch chan string
}

// NewManifestManager returns a ManifestManager. logger must not be nil.
func NewManifestManager(st *store.Store, objectStore ObjectStore, cfg ManifestConfig, logger *slog.Logger) *ManifestManager {
	return &ManifestManager{
		store:       st,
		objectStore: objectStore,
		cfg:         cfg,
		logger:      logger,
		locks:       make(map[string]*sync.Mutex),
		touch:       make(chan string, 256),
	}
}

func (m *ManifestManager) lockFor(eventID string) *sync.Mutex {
	m.locksMu.Lock()
	defer m.locksMu.Unlock()
	l, ok := m.locks[eventID]
	if !ok {
		l = &sync.Mutex{}
		m.locks[eventID] = l
	}
	return l
}

// Touch requests a near-immediate live-manifest rebuild for eventID
// (the low-latency path, called after every upload confirmation). It
// never blocks: if the request channel is momentarily full, the
// periodic backstop sweep in Run will still find and rebuild this event
// shortly afterward, so a dropped Touch is never a correctness problem,
// only a latency one.
func (m *ManifestManager) Touch(eventID string) {
	select {
	case m.touch <- eventID:
	default:
	}
}

// Run drains Touch requests and, independently, sweeps for any event
// with a confirmed-but-not-yet-committed segment every rebuildInterval,
// until ctx is cancelled. The sweep is the correctness backstop
// required to tolerate duplicate callbacks, delayed uploads,
// out-of-order completion, a worker restart, and temporary storage
// unavailability: it is driven entirely by durable state, so it needs
// no memory of what happened before a restart.
func (m *ManifestManager) Run(ctx context.Context, rebuildInterval time.Duration) {
	ticker := time.NewTicker(rebuildInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case eventID := <-m.touch:
			if err := m.RebuildLive(ctx, eventID); err != nil && ctx.Err() == nil {
				m.logger.Error("manifest: touch-triggered rebuild failed", slog.String("event_id", eventID), slog.String("error", err.Error()))
			}
		case <-ticker.C:
			m.sweep(ctx)
		}
	}
}

func (m *ManifestManager) sweep(ctx context.Context) {
	eventIDs, err := m.store.ListEventsNeedingManifestRebuild(ctx)
	if err != nil {
		m.logger.Error("manifest: sweep: list events failed", slog.String("error", err.Error()))
		return
	}
	for _, eventID := range eventIDs {
		if err := m.RebuildLive(ctx, eventID); err != nil && ctx.Err() == nil {
			m.logger.Error("manifest: sweep-triggered rebuild failed", slog.String("event_id", eventID), slog.String("error", err.Error()))
		}
	}
}

// RebuildLive recomputes eventID's live/DVR manifest from currently
// UploadConfirmed segments and republishes it only if the exact ordered
// segment set actually changed since the last publish (idempotent: a
// duplicate trigger for an unchanged set is a cheap no-op, not a
// redundant R2 write).
func (m *ManifestManager) RebuildLive(ctx context.Context, eventID string) error {
	lock := m.lockFor(eventID)
	lock.Lock()
	defer lock.Unlock()

	assignment, found, err := m.store.GetAssignmentByEventID(ctx, eventID)
	if err != nil {
		return fmt.Errorf("manifest: resolve playback id for %s: %w", eventID, err)
	}
	if !found {
		// No cached assignment yet: the opaque playback_id needed to
		// address this event's objects is unavailable. Nothing to
		// publish until it appears; the next Touch or sweep retries.
		return nil
	}

	confirmed, err := m.store.ListConfirmedSegmentsByEvent(ctx, eventID)
	if err != nil {
		return fmt.Errorf("manifest: list confirmed segments for %s: %w", eventID, err)
	}

	kept := windowLiveSegments(confirmed, m.cfg.DVRWindow.Seconds())
	mediaSeq := mediaSequenceOf(confirmed, kept)
	segmentIDs := idsOf(kept)

	latest, hasLatest, err := m.store.GetLatestManifestGeneration(ctx, eventID, store.ManifestTypeLive)
	if err != nil {
		return fmt.Errorf("manifest: read latest generation for %s: %w", eventID, err)
	}
	if hasLatest && int64SlicesEqual(latest.SegmentIDs, segmentIDs) {
		return nil
	}

	body := buildPlaylist(kept, mediaSeq, m.cfg.PublicBaseURL, false)
	key := LivePlaylistKey(m.cfg.ObjectPrefix, assignment.PlaybackID)

	putCtx, cancel := context.WithTimeout(ctx, m.cfg.RequestTimeout)
	defer cancel()
	// A single PutObject call with the complete in-memory playlist body
	// *is* the "generated atomically ... published as one complete
	// object" requirement for an S3-compatible store: R2/S3 always
	// replaces an object's full content in one request, so there is no
	// partial-write state a concurrent reader could observe, and no
	// separate temporary-key-plus-rename step is needed or available on
	// this class of object store.
	if err := m.objectStore.PutObject(putCtx, PutObjectInput{
		Key:          key,
		Body:         strings.NewReader(body),
		Size:         int64(len(body)),
		ContentType:  manifestContentType,
		CacheControl: liveManifestCacheControl,
	}); err != nil {
		return fmt.Errorf("manifest: publish live manifest for %s: %w", eventID, err)
	}

	now := time.Now().UTC()
	if _, err := m.store.RecordManifestGeneration(ctx, eventID, store.ManifestTypeLive, segmentIDs, mediaSeq, key, now); err != nil {
		return fmt.Errorf("manifest: record generation for %s: %w", eventID, err)
	}
	if err := m.store.MarkManifestCommitted(ctx, segmentIDs, now); err != nil {
		return fmt.Errorf("manifest: mark committed for %s: %w", eventID, err)
	}

	m.logger.Info("live manifest published",
		slog.String("event_id", eventID), slog.Int("segment_count", len(kept)), slog.Int("media_sequence", mediaSeq))
	return nil
}
