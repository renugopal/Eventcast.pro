package upload

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strconv"
	"strings"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// Canonical-form separators. Neither byte can occur in a segment id,
// session id, sanitized local file identity (internal/spool.SegmentFileName),
// hex digest, or decimal number, so no combination of field values from one
// segment set can ever forge another set's canonical form.
const (
	generationFieldSep  = "\x1f" // ASCII unit separator
	generationRecordSep = "\x1e" // ASCII record separator
)

// FinalizationGeneration returns a deterministic fingerprint identifying
// one authoritative finalized segment set.
//
// Governing rule: any change capable of altering the authoritative B2
// playlist, or a segment's provenance, MUST change this value. Hashing
// only (id, byte_size, sha256) would be insufficient - a duration change
// alone rewrites the playlist's #EXTINF line while leaving such a digest
// identical - so every playlist-defining field is covered (session
// identity, sequence, duration, local file identity) alongside the
// integrity ledger (byte size, SHA-256) and the durable row id.
//
// Duration is hashed at full float precision rather than the playlist's
// three-decimal rendering. That is deliberately stricter than the minimum
// the rule demands: an over-sensitive fingerprint can only cause a
// redundant re-archive, which is safe, whereas an under-sensitive one
// would let a stale archive masquerade as current, which is not.
//
// Input is canonicalized (by sequence, then id) before hashing, so the
// same logical finalized set presented in a different input order yields
// the same generation, while genuinely reordering distinct segments -
// which would reorder the playlist - does not.
func FinalizationGeneration(confirmed []store.SegmentJob) string {
	ordered := make([]store.SegmentJob, len(confirmed))
	copy(ordered, confirmed)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].SeqNo != ordered[j].SeqNo {
			return ordered[i].SeqNo < ordered[j].SeqNo
		}
		return ordered[i].ID < ordered[j].ID
	})

	h := sha256.New()
	for _, s := range ordered {
		h.Write([]byte(strings.Join([]string{
			strconv.FormatInt(s.ID, 10),
			s.SessionID,
			strconv.FormatInt(s.SeqNo, 10),
			strconv.FormatFloat(s.DurationSeconds, 'f', -1, 64),
			s.LocalFileIdentity,
			strconv.FormatInt(s.ByteSize, 10),
			s.SHA256,
		}, generationFieldSep)))
		h.Write([]byte(generationRecordSep))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// CoveredPlaybackIDs returns the distinct playback identities represented
// by a finalized segment set, given a resolver from session id to that
// session's pinned playback id (internal/store.Store.GetSessionPlaybackID).
//
// This is the provenance the control plane compares against the event's
// complete activation history: a finalization may only become
// Event-authoritative if it covers every activation's playback id. Sending
// playback ids rather than raw session ids keeps the reported evidence to
// the smallest set that answers that question, and matches the identity
// the control plane already stores per activation.
//
// The result is sorted and de-duplicated so it is deterministic. A session
// whose playback id cannot be resolved is reported via ok=false rather
// than silently omitted - an unresolvable session would understate
// coverage, and understated coverage must never be able to pass a
// completeness gate.
func CoveredPlaybackIDs(confirmed []store.SegmentJob, resolve func(sessionID string) (string, bool)) ([]string, bool) {
	seen := make(map[string]struct{})
	for _, s := range confirmed {
		playbackID, ok := resolve(s.SessionID)
		if !ok || playbackID == "" {
			return nil, false
		}
		seen[playbackID] = struct{}{}
	}

	out := make([]string, 0, len(seen))
	for id := range seen {
		out = append(out, id)
	}
	sort.Strings(out)
	return out, true
}
