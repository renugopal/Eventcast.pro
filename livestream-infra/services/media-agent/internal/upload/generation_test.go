package upload

import (
	"testing"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// genSegments returns a small, deterministic confirmed segment set.
func genSegments() []store.SegmentJob {
	return []store.SegmentJob{
		{ID: 1, SessionID: "sess-a", SeqNo: 1, DurationSeconds: 4.0, LocalFileIdentity: "1-seg.ts", ByteSize: 100, SHA256: "aaa"},
		{ID: 2, SessionID: "sess-a", SeqNo: 2, DurationSeconds: 4.0, LocalFileIdentity: "2-seg.ts", ByteSize: 200, SHA256: "bbb"},
	}
}

func TestFinalizationGenerationIsStableForTheSameSet(t *testing.T) {
	if got, want := FinalizationGeneration(genSegments()), FinalizationGeneration(genSegments()); got != want {
		t.Errorf("generation is not stable: %s vs %s", got, want)
	}
}

// The canonical form must be order-insensitive on INPUT, so a differently
// ordered query result for the same logical set does not spuriously look
// like a new generation and trigger a pointless re-archive.
func TestFinalizationGenerationIgnoresNonCanonicalInputOrder(t *testing.T) {
	ordered := genSegments()
	reversed := []store.SegmentJob{ordered[1], ordered[0]}

	if FinalizationGeneration(ordered) != FinalizationGeneration(reversed) {
		t.Error("generation changed for the same logical set presented in a different input order")
	}
}

// Governing rule: anything capable of changing the authoritative playlist
// or a segment's provenance must change the fingerprint. Hashing only
// (id, size, sha256) would miss several of these - duration in particular
// rewrites #EXTINF while leaving such a digest identical.
func TestFinalizationGenerationChangesForEveryPlaylistDefiningField(t *testing.T) {
	baseline := FinalizationGeneration(genSegments())

	cases := map[string]func(s []store.SegmentJob){
		"duration":            func(s []store.SegmentJob) { s[0].DurationSeconds = 4.5 },
		"sequence":            func(s []store.SegmentJob) { s[0].SeqNo = 99 },
		"session identity":    func(s []store.SegmentJob) { s[0].SessionID = "sess-b" },
		"local file identity": func(s []store.SegmentJob) { s[0].LocalFileIdentity = "1-other.ts" },
		"byte size":           func(s []store.SegmentJob) { s[0].ByteSize = 101 },
		"content digest":      func(s []store.SegmentJob) { s[0].SHA256 = "zzz" },
		"row id":              func(s []store.SegmentJob) { s[0].ID = 42 },
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			segments := genSegments()
			mutate(segments)
			if FinalizationGeneration(segments) == baseline {
				t.Errorf("generation did not change when %s changed", name)
			}
		})
	}
}

// A genuine reordering of distinct segments reorders the playlist, so it
// must change the generation - distinct from the input-order case above.
func TestFinalizationGenerationChangesWhenSegmentsAreGenuinelyReordered(t *testing.T) {
	baseline := FinalizationGeneration(genSegments())

	swapped := genSegments()
	swapped[0].SeqNo, swapped[1].SeqNo = swapped[1].SeqNo, swapped[0].SeqNo

	if FinalizationGeneration(swapped) == baseline {
		t.Error("generation did not change when the segments' playlist order genuinely changed")
	}
}

func TestFinalizationGenerationChangesOnSegmentAdditionAndRemoval(t *testing.T) {
	baseline := FinalizationGeneration(genSegments())

	added := append(genSegments(), store.SegmentJob{
		ID: 3, SessionID: "sess-a", SeqNo: 3, DurationSeconds: 4.0, LocalFileIdentity: "3-seg.ts", ByteSize: 300, SHA256: "ccc",
	})
	if FinalizationGeneration(added) == baseline {
		t.Error("generation did not change when a segment was added")
	}

	removed := genSegments()[:1]
	if FinalizationGeneration(removed) == baseline {
		t.Error("generation did not change when a segment was removed")
	}
}

func TestCoveredPlaybackIDsIsDistinctAndSorted(t *testing.T) {
	segments := []store.SegmentJob{
		{SessionID: "s1"}, {SessionID: "s2"}, {SessionID: "s1"},
	}
	resolve := func(sessionID string) (string, bool) {
		return map[string]string{"s1": "pb-b", "s2": "pb-a"}[sessionID], true
	}

	got, ok := CoveredPlaybackIDs(segments, resolve)
	if !ok {
		t.Fatal("CoveredPlaybackIDs() reported failure for fully resolvable sessions")
	}
	if len(got) != 2 || got[0] != "pb-a" || got[1] != "pb-b" {
		t.Errorf("covered = %v, want sorted distinct [pb-a pb-b]", got)
	}
}

// Understated coverage must never silently reach the control plane's
// completeness gate: it could let a partial recording look complete.
func TestCoveredPlaybackIDsFailsClosedOnAnUnresolvableSession(t *testing.T) {
	segments := []store.SegmentJob{{SessionID: "s1"}, {SessionID: "missing"}}
	resolve := func(sessionID string) (string, bool) {
		if sessionID == "s1" {
			return "pb-a", true
		}
		return "", false
	}

	if _, ok := CoveredPlaybackIDs(segments, resolve); ok {
		t.Error("CoveredPlaybackIDs() reported success despite an unresolvable session")
	}
}
