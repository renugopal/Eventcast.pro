package upload

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// b2PlaylistCacheControl matches the R2 VOD manifest policy: a finalized
// archive playlist never changes again, so a moderate public cache is
// safe if a delivery path is ever put in front of it.
const b2PlaylistCacheControl = "public, max-age=86400"

// ErrB2ContentAddressMismatch is returned when an object already exists at
// a deterministic content-addressed key but does not match the expected
// size and sha256 metadata.
//
// This is an invariant violation, not a retryable condition: the key is
// derived from the content's own digest, so a mismatch means two different
// byte sequences claim the same digest, or an object was written by
// something other than this pipeline. Overwriting would risk mutating
// bytes underneath a previously verified generation's playlist, so the
// archiver fails closed instead.
var ErrB2ContentAddressMismatch = errors.New("upload: existing B2 object does not match its content address")

// B2ArchiveConfig configures B2Archiver.
type B2ArchiveConfig struct {
	Bucket         string
	ObjectPrefix   string
	RequestTimeout time.Duration
	// IntegrityMode selects strong byte-integrity verification. The zero
	// value is B2IntegrityNone, preserving the original behaviour exactly:
	// an existing caller that does not set it gets no strong claim and no
	// extra provider request.
	IntegrityMode B2IntegrityMode
}

// B2Archiver copies one event's authoritative finalized recording - the
// confirmed .ts segment set plus a rebuilt relative-URI playlist - from
// the local spool into Backblaze B2.
//
// Deliberate boundaries:
//
//   - It never runs unless production archival is explicitly enabled; the
//     caller gates construction on config.B2ArchivalEnabled.
//   - It reads bytes from the local spool, never from R2. No GetObject
//     backfill path exists.
//   - It never sets strong byte-integrity verification. Completing an
//     archive is strictly weaker evidence, and conflating the two would
//     let retention freeze on an unproven claim.
//   - It never deletes anything, in B2 or locally.
type B2Archiver struct {
	store       *store.Store
	objectStore ObjectStore
	cfg         B2ArchiveConfig
	logger      *slog.Logger
}

// NewB2Archiver returns a B2Archiver. logger must not be nil.
func NewB2Archiver(st *store.Store, objectStore ObjectStore, cfg B2ArchiveConfig, logger *slog.Logger) *B2Archiver {
	return &B2Archiver{store: st, objectStore: objectStore, cfg: cfg, logger: logger}
}

// B2ArchiveResult reports the outcome of one archival pass.
type B2ArchiveResult struct {
	// Archived is true only if every segment object and the playlist are
	// present in B2 and passed post-PUT verification for this exact
	// generation.
	Archived bool
	// Superseded is true when the local finalization moved to a different
	// generation during or before this pass, so the work performed does not
	// describe the current authoritative segment set.
	Superseded bool
	// Reason explains a non-archived outcome. Safe to log: never a path,
	// key, or secret.
	Reason      string
	PlaylistKey string
	ObjectCount int
}

// ArchiveEvent performs one archival pass for eventID at the given
// generation.
//
// Restart-safety and idempotency come from the same mechanisms the R2
// upload worker already proves: every key is deterministic, so a retry
// recomputes the identical key, and each object is HEAD-checked before
// being written. A pass interrupted at any point can simply be run again.
//
// The generation is re-derived from durable state at the start and
// re-checked before completion. If it no longer matches, the pass reports
// Superseded rather than recording a stale archive as authoritative.
func (a *B2Archiver) ArchiveEvent(ctx context.Context, eventID, generation string) (B2ArchiveResult, error) {
	confirmed, err := a.store.ListConfirmedSegmentsByEvent(ctx, eventID)
	if err != nil {
		return B2ArchiveResult{}, fmt.Errorf("b2: list confirmed segments for %s: %w", eventID, err)
	}
	if len(confirmed) == 0 {
		return B2ArchiveResult{Reason: "no confirmed segments to archive"}, nil
	}

	if current := FinalizationGeneration(confirmed); current != generation {
		return B2ArchiveResult{Superseded: true, Reason: "finalization generation changed before archival started"}, nil
	}

	for _, s := range confirmed {
		if err := a.archiveSegment(ctx, eventID, s); err != nil {
			return B2ArchiveResult{}, err
		}
	}

	playlistKey := B2VODPlaylistKey(a.cfg.ObjectPrefix, eventID, generation)
	body := buildB2Playlist(confirmed)
	// The playlist carries its own digest, both as user metadata (mirroring
	// segments) and as the expected value strong integrity modes verify
	// against - otherwise the rebuilt manifest, which is what a replay
	// actually resolves segments through, would be the one archived object
	// no strong mode covered.
	playlistSHA256 := sha256HexOfBytes([]byte(body))
	if err := a.putAndVerify(ctx, PutObjectInput{
		Key:          playlistKey,
		Body:         strings.NewReader(body),
		Size:         int64(len(body)),
		ContentType:  manifestContentType,
		CacheControl: b2PlaylistCacheControl,
		Metadata:     map[string]string{"sha256": playlistSHA256},
	}, int64(len(body)), playlistSHA256); err != nil {
		return B2ArchiveResult{}, fmt.Errorf("b2: publish archive playlist for %s: %w", eventID, err)
	}

	// Re-check after the work, not only before it: a late segment could
	// have confirmed while this pass was uploading, in which case the
	// playlist just written describes a superseded set. The objects
	// themselves remain valid and content-addressed, so nothing is wasted -
	// the next pass reuses them under the new generation's playlist.
	after, err := a.store.ListConfirmedSegmentsByEvent(ctx, eventID)
	if err != nil {
		return B2ArchiveResult{}, fmt.Errorf("b2: re-read confirmed segments for %s: %w", eventID, err)
	}
	if FinalizationGeneration(after) != generation {
		return B2ArchiveResult{Superseded: true, Reason: "finalization generation changed during archival"}, nil
	}

	return B2ArchiveResult{
		Archived:    true,
		PlaylistKey: playlistKey,
		ObjectCount: len(confirmed) + 1, // segments plus the playlist
	}, nil
}

// archiveSegment uploads one segment, reusing an existing content-addressed
// object when it already matches.
func (a *B2Archiver) archiveSegment(ctx context.Context, eventID string, s store.SegmentJob) error {
	key := B2SegmentKey(a.cfg.ObjectPrefix, eventID, s.SessionID, s.SHA256, s.LocalFileIdentity)

	headCtx, cancel := context.WithTimeout(ctx, a.cfg.RequestTimeout)
	existing, headErr := a.objectStore.HeadObject(headCtx, key)
	cancel()

	switch {
	case headErr == nil && existing.Exists:
		// Reuse only on an exact match. Because the key embeds the content
		// digest, an object that is present but different is an invariant
		// violation - fail closed rather than overwrite, which would mutate
		// bytes a previously verified generation's playlist may reference.
		if !objectMatches(existing, s) {
			return fmt.Errorf("%w: key %s", ErrB2ContentAddressMismatch, key)
		}
		return nil
	case headErr != nil && !isObjectNotFound(headErr):
		return fmt.Errorf("b2: head segment object %s: %w", key, headErr)
	}

	file, err := os.Open(s.SpoolPath)
	if err != nil {
		// The spool copy is the archiver's only byte source. Its absence is
		// reported as a failure so the event is retried and, critically, so
		// the retention gate keeps refusing to release anything for it -
		// never silently treated as a successful archive.
		return fmt.Errorf("b2: open spool file for segment %d: %w", s.ID, err)
	}
	defer file.Close()

	return a.putAndVerify(ctx, PutObjectInput{
		Key:          key,
		Body:         file,
		Size:         s.ByteSize,
		ContentType:  contentTypeSegment,
		CacheControl: segmentCacheControl,
		Metadata:     segmentMetadata(s),
	}, s.ByteSize, s.SHA256)
}

// putAndVerify writes one object and then re-reads it to confirm the store
// actually holds what was sent.
//
// expectedSHA256 empty means "verify size only". This post-PUT HEAD is why
// a 200 from the provider is never on its own treated as archival success -
// but on its own it still proves only presence and metadata consistency,
// since the provider is echoing back metadata this same process supplied.
//
// When cfg.IntegrityMode requests strong verification, that weaker check is
// additionally backed by a real claim about the stored bytes:
//
//   - B2IntegrityProviderChecksum sends x-amz-checksum-sha256 on the PUT,
//     so a corrupted upload is rejected server-side. It never retries
//     without the header - a downgrade would silently void the claim.
//   - B2IntegrityReadBack re-reads the object and hashes what was actually
//     returned.
//
// A strong mode with no expected digest to verify against is treated as a
// programming error rather than quietly skipped, so no object can pass
// through a strong mode unverified.
func (a *B2Archiver) putAndVerify(ctx context.Context, in PutObjectInput, expectedSize int64, expectedSHA256 string) error {
	strong := a.cfg.IntegrityMode.StrongVerification()
	if strong && expectedSHA256 == "" {
		return fmt.Errorf("b2: integrity mode %q requires an expected sha256 for key %s", a.cfg.IntegrityMode, in.Key)
	}

	if a.cfg.IntegrityMode == B2IntegrityProviderChecksum {
		checksum, err := sha256HexToBase64(expectedSHA256)
		if err != nil {
			return fmt.Errorf("b2: build provider checksum for key %s: %w", in.Key, err)
		}
		in.ChecksumSHA256 = checksum
	}

	putCtx, cancel := context.WithTimeout(ctx, a.cfg.RequestTimeout)
	err := a.objectStore.PutObject(putCtx, in)
	cancel()
	if err != nil {
		return fmt.Errorf("b2: put object %s: %w", in.Key, err)
	}

	headCtx, cancel := context.WithTimeout(ctx, a.cfg.RequestTimeout)
	info, err := a.objectStore.HeadObject(headCtx, in.Key)
	cancel()
	if err != nil {
		return fmt.Errorf("b2: verify object %s: %w", in.Key, err)
	}
	if info.Size != expectedSize {
		return fmt.Errorf("b2: size mismatch after upload for key %s", in.Key)
	}
	if expectedSHA256 != "" && info.Metadata["sha256"] != expectedSHA256 {
		return fmt.Errorf("b2: sha256 metadata mismatch after upload for key %s", in.Key)
	}

	if a.cfg.IntegrityMode == B2IntegrityReadBack {
		readCtx, cancel := context.WithTimeout(ctx, a.cfg.RequestTimeout)
		err := verifyObjectReadBack(readCtx, a.objectStore, in.Key, expectedSHA256)
		cancel()
		if err != nil {
			return fmt.Errorf("b2: %w", err)
		}
	}

	return nil
}

// isObjectNotFound reports whether err is the object-store "not found"
// sentinel, wrapped or otherwise.
func isObjectNotFound(err error) bool {
	return errors.Is(err, ErrObjectNotFound)
}
