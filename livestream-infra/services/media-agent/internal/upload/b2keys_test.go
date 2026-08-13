package upload

import (
	"strings"
	"testing"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

func TestB2VODPlaylistKeyIsGenerationSpecific(t *testing.T) {
	a := B2VODPlaylistKey("", "evt-1", "gen-aaa")
	b := B2VODPlaylistKey("", "evt-1", "gen-bbb")

	if a == b {
		t.Fatal("two generations produced the same playlist key; an unverified replacement could overwrite a verified generation's playlist")
	}
	if want := "events/evt-1/vod/gen-aaa.m3u8"; a != want {
		t.Errorf("playlist key = %q, want %q", a, want)
	}
}

func TestB2SegmentKeyIsContentAddressed(t *testing.T) {
	// Same logical segment, different bytes: the keys must differ, so a
	// changed segment can never overwrite the object an earlier verified
	// generation's playlist still references.
	original := B2SegmentKey("", "evt-1", "sess-1", "digest-a", "1-seg.ts")
	changed := B2SegmentKey("", "evt-1", "sess-1", "digest-b", "1-seg.ts")

	if original == changed {
		t.Fatal("changed segment bytes produced the same object key")
	}

	// Unchanged bytes must resolve to the identical key so two generations
	// safely share the object instead of re-uploading it.
	if again := B2SegmentKey("", "evt-1", "sess-1", "digest-a", "1-seg.ts"); again != original {
		t.Errorf("unchanged bytes produced a different key: %q vs %q", again, original)
	}

	if want := "events/evt-1/media/sess-1/digest-a-1-seg.ts"; original != want {
		t.Errorf("segment key = %q, want %q", original, want)
	}
}

// The archive must not carry mutable playback identity: playback_id
// rotates on every re-activation, so a key built from it cannot address a
// durable archive.
func TestB2KeysUseImmutableEventIdentityOnly(t *testing.T) {
	playlist := B2VODPlaylistKey("", "evt-1", "gen-aaa")
	segment := B2SegmentKey("", "evt-1", "sess-1", "digest-a", "1-seg.ts")

	for _, key := range []string{playlist, segment} {
		if !strings.HasPrefix(key, "events/evt-1/") {
			t.Errorf("key %q is not rooted at the immutable event identity", key)
		}
	}
}

func TestB2KeysApplyConfiguredPrefix(t *testing.T) {
	if got, want := B2VODPlaylistKey("archive", "evt-1", "gen"), "archive/events/evt-1/vod/gen.m3u8"; got != want {
		t.Errorf("prefixed playlist key = %q, want %q", got, want)
	}
	if got, want := B2SegmentKey("archive/", "evt-1", "s", "d", "f.ts"), "archive/events/evt-1/media/s/d-f.ts"; got != want {
		t.Errorf("prefixed segment key = %q, want %q", got, want)
	}
}

func TestB2ConnectivityTestKeyIsIsolatedFromEventData(t *testing.T) {
	key := B2ConnectivityTestKey("", "node-1", "token")
	if strings.Contains(key, "events/") {
		t.Errorf("connectivity-test key %q must never live under events/", key)
	}
	if !strings.HasPrefix(key, "_connectivity-test/") {
		t.Errorf("connectivity-test key = %q, want the isolated _connectivity-test/ prefix", key)
	}
}

func TestBuildB2PlaylistUsesRelativeContentAddressedURIs(t *testing.T) {
	playlist := buildB2Playlist([]store.SegmentJob{
		{ID: 1, SessionID: "sess-1", SeqNo: 1, DurationSeconds: 4, LocalFileIdentity: "1-seg.ts", SHA256: "digest-a", R2Key: "events/pb-1/media/sess-1/1-seg.ts"},
	})

	if !strings.Contains(playlist, "../media/sess-1/digest-a-1-seg.ts") {
		t.Errorf("playlist does not reference the relative content-addressed URI:\n%s", playlist)
	}
	// A byte-copied R2 playlist would point back at hot storage, defeating
	// the whole purpose of an authoritative archive.
	if strings.Contains(playlist, "events/pb-1/") {
		t.Errorf("playlist leaked an R2 key, so the archive still depends on R2:\n%s", playlist)
	}
	if !strings.Contains(playlist, "#EXT-X-ENDLIST") {
		t.Error("archive playlist must be finalized with EXT-X-ENDLIST")
	}
}
