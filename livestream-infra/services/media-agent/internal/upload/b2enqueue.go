package upload

import (
	"context"
	"fmt"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// B2Enqueuer turns a completed local VOD finalization into durable B2
// archive work.
//
// This is the whole of what an operator finalize request does for B2: it
// records which generation must be archived and returns. The network
// transfer itself belongs to B2ArchiveWorker, so a slow upload, a B2
// outage, or a control-plane retry can never hold that request open or be
// lost with it.
//
// Everything it records is derived from durable state (confirmed segments
// and the vod_finalizations row), never from request input, so re-running
// it after a restart reconstructs exactly the same work.
type B2Enqueuer struct {
	store *store.Store
}

// NewB2Enqueuer returns a B2Enqueuer.
func NewB2Enqueuer(st *store.Store) *B2Enqueuer {
	return &B2Enqueuer{store: st}
}

// Enqueue records the current authoritative finalized generation for
// eventID as the generation that must be archived.
//
// Idempotent and convergent: enqueuing an unchanged generation leaves a
// completed archive untouched and creates no competing job, while a newer
// generation converges the single row forward. Repeated operator finalize
// calls are therefore harmless.
func (e *B2Enqueuer) Enqueue(ctx context.Context, eventID string) error {
	confirmed, err := e.store.ListConfirmedSegmentsByEvent(ctx, eventID)
	if err != nil {
		return fmt.Errorf("b2: list confirmed segments for %s: %w", eventID, err)
	}
	if len(confirmed) == 0 {
		// Nothing authoritative to archive. Deliberately not an error and
		// deliberately no row: an event with no confirmed segments must not
		// acquire archival history, because that would permanently block its
		// spool release under the fail-closed retention gate.
		return nil
	}

	covered, ok := CoveredPlaybackIDs(confirmed, func(sessionID string) (string, bool) {
		playbackID, found, err := e.store.GetSessionPlaybackID(ctx, sessionID)
		if err != nil || !found {
			return "", false
		}
		return playbackID, true
	})
	if !ok {
		// An unresolvable session would understate playback coverage, and
		// understated coverage must never reach the control plane's
		// completeness gate - it could let a partial recording look
		// Event-authoritative. Fail rather than report weaker provenance.
		return fmt.Errorf("b2: cannot resolve playback provenance for every session of event %s", eventID)
	}

	finalization, found, err := e.store.GetVODFinalization(ctx, eventID)
	if err != nil {
		return fmt.Errorf("b2: read finalization for %s: %w", eventID, err)
	}
	if !found {
		return fmt.Errorf("b2: no local finalization on record for event %s", eventID)
	}

	_, err = e.store.EnqueueB2Archive(ctx, store.EnqueueB2ArchiveInput{
		EventID:            eventID,
		Generation:         FinalizationGeneration(confirmed),
		CoveredPlaybackIDs: covered,
		// Gap facts are copied from the authoritative local source rather
		// than recomputed, so the control plane sees exactly the semantics
		// vod_finalizations already established.
		GapCount:         finalization.GapCount,
		GapStatus:        finalization.GapStatus,
		LocalFinalizedAt: finalization.FinalizedAt,
	}, time.Now().UTC())
	if err != nil {
		return err
	}
	return nil
}
