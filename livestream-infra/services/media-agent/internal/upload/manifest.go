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
// playlist. Every referenced segment is addressed by its already
// server-confirmed R2 key (never a locally-captured-but-unconfirmed
// path), satisfying "Never publish a manifest that references an object
// that has not been confirmed available" by construction: kept is only
// ever populated from Store.ListConfirmedSegmentsByEvent.
func buildPlaylist(kept []store.SegmentJob, mediaSequence int, playbackID, objectPrefix, publicBaseURL string, endlist bool) string {
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
		b.WriteString(segmentURL(objectPrefix, publicBaseURL, playbackID, s.SessionID, s.LocalFileIdentity))
		b.WriteString("\n")
	}

	if endlist {
		b.WriteString("#EXT-X-ENDLIST\n")
	}
	return b.String()
}

func segmentURL(objectPrefix, publicBaseURL, playbackID, sessionID, localFileIdentity string) string {
	key := SegmentKey(objectPrefix, playbackID, sessionID, localFileIdentity)
	if publicBaseURL == "" {
		return "/" + key
	}
	return strings.TrimSuffix(publicBaseURL, "/") + "/" + key
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
