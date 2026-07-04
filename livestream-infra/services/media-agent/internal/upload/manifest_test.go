package upload

import (
	"strings"
	"testing"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

func seg(id int64, sessionID string, duration float64) store.SegmentJob {
	return store.SegmentJob{ID: id, SessionID: sessionID, LocalFileIdentity: sessionID + "-seg", DurationSeconds: duration}
}

func TestWindowLiveSegmentsKeepsApproximatelyTheWindow(t *testing.T) {
	var all []store.SegmentJob
	for i := int64(1); i <= 10; i++ {
		all = append(all, seg(i, "s1", 4))
	}

	kept := windowLiveSegments(all, 16) // ~4 segments at 4s each
	if len(kept) < 4 {
		t.Fatalf("len(kept) = %d, want >= 4 for a 16s window of 4s segments", len(kept))
	}
	if kept[len(kept)-1].ID != 10 {
		t.Errorf("last kept segment ID = %d, want 10 (must include the most recent)", kept[len(kept)-1].ID)
	}
}

func TestWindowLiveSegmentsAlwaysKeepsAtLeastOne(t *testing.T) {
	all := []store.SegmentJob{seg(1, "s1", 4)}
	kept := windowLiveSegments(all, 900)
	if len(kept) != 1 {
		t.Fatalf("len(kept) = %d, want 1", len(kept))
	}

	if got := windowLiveSegments(nil, 900); got != nil {
		t.Errorf("windowLiveSegments(nil, ...) = %v, want nil", got)
	}
}

func TestMediaSequenceOfTracksTrimmedPrefix(t *testing.T) {
	all := []store.SegmentJob{seg(1, "s1", 4), seg(2, "s1", 4), seg(3, "s1", 4)}
	kept := all[1:] // segments 2,3 kept; segment 1 trimmed
	if got := mediaSequenceOf(all, kept); got != 1 {
		t.Errorf("mediaSequenceOf = %d, want 1", got)
	}
}

func TestBuildPlaylistInsertsDiscontinuityAtSessionBoundary(t *testing.T) {
	kept := []store.SegmentJob{seg(1, "s1", 4), seg(2, "s1", 4), seg(3, "s2", 4)}
	body := buildPlaylist(kept, 0, "pb", "", "", false)

	if !strings.HasPrefix(body, "#EXTM3U\n") {
		t.Fatalf("playlist does not start with #EXTM3U:\n%s", body)
	}
	if strings.Count(body, "#EXT-X-DISCONTINUITY") != 1 {
		t.Errorf("expected exactly one discontinuity tag, got:\n%s", body)
	}
	if strings.Contains(body, "#EXT-X-ENDLIST") {
		t.Errorf("live playlist must not contain ENDLIST:\n%s", body)
	}
	if !strings.Contains(body, "events/pb/media/s1/s1-seg") || !strings.Contains(body, "events/pb/media/s2/s2-seg") {
		t.Errorf("playlist missing expected segment URLs:\n%s", body)
	}
}

func TestBuildPlaylistVODIncludesEndlist(t *testing.T) {
	kept := []store.SegmentJob{seg(1, "s1", 4)}
	body := buildPlaylist(kept, 0, "pb", "", "", true)
	if !strings.HasSuffix(strings.TrimRight(body, "\n"), "#EXT-X-ENDLIST") {
		t.Errorf("VOD playlist must end with ENDLIST:\n%s", body)
	}
}

func TestBuildPlaylistUsesPublicBaseURLWhenSet(t *testing.T) {
	kept := []store.SegmentJob{seg(1, "s1", 4)}
	body := buildPlaylist(kept, 0, "pb", "", "https://cdn.example.com", false)
	if !strings.Contains(body, "https://cdn.example.com/events/pb/media/s1/s1-seg") {
		t.Errorf("expected absolute segment URL, got:\n%s", body)
	}
}

func TestBuildPlaylistTargetDurationCoversLongestSegment(t *testing.T) {
	kept := []store.SegmentJob{seg(1, "s1", 3.2), seg(2, "s1", 6.1)}
	body := buildPlaylist(kept, 0, "pb", "", "", false)
	if !strings.Contains(body, "#EXT-X-TARGETDURATION:7\n") {
		t.Errorf("expected target duration 7 (ceil of 6.1), got:\n%s", body)
	}
}

func TestInt64SlicesEqual(t *testing.T) {
	if !int64SlicesEqual([]int64{1, 2, 3}, []int64{1, 2, 3}) {
		t.Error("expected equal slices to compare equal")
	}
	if int64SlicesEqual([]int64{1, 2}, []int64{1, 2, 3}) {
		t.Error("expected different-length slices to compare unequal")
	}
	if int64SlicesEqual([]int64{1, 2, 3}, []int64{1, 2, 4}) {
		t.Error("expected differing-content slices to compare unequal")
	}
}
