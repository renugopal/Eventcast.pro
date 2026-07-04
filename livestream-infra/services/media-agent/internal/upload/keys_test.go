package upload

import "testing"

func TestSegmentKeyIsDeterministicAndCollisionSafe(t *testing.T) {
	k1 := SegmentKey("", "pb_abc", "sess_1", "42-1700000000-42.ts")
	k2 := SegmentKey("", "pb_abc", "sess_1", "42-1700000000-42.ts")
	if k1 != k2 {
		t.Fatalf("SegmentKey is not deterministic: %q vs %q", k1, k2)
	}
	want := "events/pb_abc/media/sess_1/42-1700000000-42.ts"
	if k1 != want {
		t.Errorf("SegmentKey = %q, want %q", k1, want)
	}

	// Different sessions or sequences must never collide.
	other := SegmentKey("", "pb_abc", "sess_2", "42-1700000000-42.ts")
	if other == k1 {
		t.Errorf("SegmentKey collided across sessions: %q", other)
	}
}

func TestObjectKeysRespectPrefix(t *testing.T) {
	if got, want := SegmentKey("node-a", "pb", "s", "f.ts"), "node-a/events/pb/media/s/f.ts"; got != want {
		t.Errorf("SegmentKey with prefix = %q, want %q", got, want)
	}
	if got, want := SegmentKey("node-a/", "pb", "s", "f.ts"), "node-a/events/pb/media/s/f.ts"; got != want {
		t.Errorf("SegmentKey with trailing-slash prefix = %q, want %q", got, want)
	}
	if got, want := LivePlaylistKey("node-a", "pb"), "node-a/events/pb/live/index.m3u8"; got != want {
		t.Errorf("LivePlaylistKey = %q, want %q", got, want)
	}
	if got, want := VODPlaylistKey("", "pb"), "events/pb/vod/index.m3u8"; got != want {
		t.Errorf("VODPlaylistKey = %q, want %q", got, want)
	}
}
