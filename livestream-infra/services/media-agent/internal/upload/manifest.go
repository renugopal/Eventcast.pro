package upload

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// defaultTargetDuration matches ADR-003's four-second target segment;
// it is only a floor for EXT-X-TARGETDURATION when a manifest happens to
// have zero segments (a live manifest key published before the first
// segment confirms - see 02_V1_ARCHITECTURE_SPEC.md "A live manifest key
// SHOULD be created before the player URL is exposed").
const defaultTargetDuration = 4

// windowLiveSegments returns the suffix of all (which must be in
// ascending, i.e. chronological, order) whose combined duration is at
// least window - "approximately" per ADR-004, since the segment that
// first crosses the threshold is always included whole rather than
// split. It always returns at least the single most recent segment, even
// if that segment alone exceeds window.
func windowLiveSegments(all []store.SegmentJob, windowSeconds float64) []store.SegmentJob {
	if len(all) == 0 {
		return nil
	}
	var total float64
	start := len(all) - 1
	for i := len(all) - 1; i >= 0; i-- {
		total += all[i].DurationSeconds
		start = i
		if total >= windowSeconds {
			break
		}
	}
	return all[start:]
}

// mediaSequenceOf returns the 0-based index of kept's first element
// within the full ascending confirmed list. Because confirmed segments
// are only ever appended (never reordered or removed from the
// underlying id-ordered history - only trimmed from the *window*), this
// index strictly increases from one rebuild to the next for a given
// event, satisfying the HLS requirement that EXT-X-MEDIA-SEQUENCE only
// advances.
func mediaSequenceOf(all, kept []store.SegmentJob) int {
	if len(kept) == 0 {
		return 0
	}
	for i, s := range all {
		if s.ID == kept[0].ID {
			return i
		}
	}
	return 0
}

// buildPlaylist renders an HLS media playlist from kept, in order.
// mediaSequence is EXT-X-MEDIA-SEQUENCE; endlist appends
// EXT-X-ENDLIST for a finalized VOD playlist and is false for a live
// playlist. Every referenced segment is addressed by its own already
// server-confirmed r2_key (never a locally-captured-but-unconfirmed
// path, and never reconstructed from the manifest's own playback_id),
// satisfying "Never publish a manifest that references an object that
// has not been confirmed available" by construction: kept is only ever
// populated from Store.ListConfirmedSegmentsByEvent. Using each
// segment's own recorded key - rather than rebuilding
// events/{playback_id}/media/... from the caller's playbackID - matters
// because a segment's key is pinned to the playback_id its own ingest
// session had at upload time (see internal/upload/worker.go), while the
// manifest's own object address intentionally tracks the event's
// current/enabled assignment playback_id; those two can differ once an
// event's assignment has rotated to a new playback_id since an earlier
// session uploaded. Addressing segments by their own key keeps every
// manifest correct regardless of that difference.
func buildPlaylist(kept []store.SegmentJob, mediaSequence int, publicBaseURL string, endlist bool) string {
	return renderPlaylist(kept, mediaSequence, endlist, func(s store.SegmentJob) string {
		return segmentURL(publicBaseURL, s.R2Key)
	})
}

// renderPlaylist is the single HLS media-playlist renderer. It exists so
// the B2 archive playlist (b2playlist.go), which must address segments by
// playlist-relative content-addressed URI rather than by R2 key, reuses
// exactly this target-duration, discontinuity, and EXTINF logic instead of
// growing a parallel copy that could silently drift. buildPlaylist's
// output is unchanged: it passes the same R2-key URI function it always
// used.
func renderPlaylist(kept []store.SegmentJob, mediaSequence int, endlist bool, uriFor func(store.SegmentJob) string) string {
	target := defaultTargetDuration
	for _, s := range kept {
		if d := int(math.Ceil(s.DurationSeconds)); d > target {
			target = d
		}
	}

	var b strings.Builder
	b.WriteString("#EXTM3U\n")
	b.WriteString("#EXT-X-VERSION:3\n")
	fmt.Fprintf(&b, "#EXT-X-TARGETDURATION:%d\n", target)
	fmt.Fprintf(&b, "#EXT-X-MEDIA-SEQUENCE:%d\n", mediaSequence)

	var previousSession string
	for i, s := range kept {
		if i > 0 && s.SessionID != previousSession {
			b.WriteString("#EXT-X-DISCONTINUITY\n")
		}
		previousSession = s.SessionID

		fmt.Fprintf(&b, "#EXTINF:%s,\n", strconv.FormatFloat(s.DurationSeconds, 'f', 3, 64))
		b.WriteString(uriFor(s))
		b.WriteString("\n")
	}

	if endlist {
		b.WriteString("#EXT-X-ENDLIST\n")
	}
	return b.String()
}

func segmentURL(publicBaseURL, r2Key string) string {
	if publicBaseURL == "" {
		return "/" + r2Key
	}
	return strings.TrimSuffix(publicBaseURL, "/") + "/" + r2Key
}

func idsOf(segments []store.SegmentJob) []int64 {
	ids := make([]int64, len(segments))
	for i, s := range segments {
		ids[i] = s.ID
	}
	return ids
}

func int64SlicesEqual(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
