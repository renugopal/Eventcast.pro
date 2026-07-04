package upload

import "strings"

// Object key layout (02_V1_ARCHITECTURE_SPEC.md "R2 object layout"):
//
//	events/{playback_id}/media/{session_id}/{local_file_identity}
//	events/{playback_id}/live/index.m3u8
//	events/{playback_id}/vod/index.m3u8
//
// V1 has exactly one media rendition (source-quality passthrough, no
// ABR - ADR-011), so no rendition path segment is required; a future
// multi-rendition design would add one here as an explicit architecture
// change, not by overloading this layout.
//
// SegmentKey reuses local_file_identity (internal/spool.SegmentFileName:
// "<seq_no>-<sanitized source basename>") verbatim as the final path
// component instead of recomputing a name from raw inputs. This
// guarantees the R2 key can never disagree with the spool path's
// already-established collision-safe, deterministic identity, and means
// retrying an upload (or a duplicate worker racing the same segment)
// always computes the exact same key - the core precondition for the
// HEAD-before-PUT idempotency check in worker.go.

// SegmentKey returns the deterministic, immutable object key for one
// segment.
func SegmentKey(prefix, playbackID, sessionID, localFileIdentity string) string {
	return withPrefix(prefix, "events/"+playbackID+"/media/"+sessionID+"/"+localFileIdentity)
}

// LivePlaylistKey returns the mutable public live-manifest key for an
// event.
func LivePlaylistKey(prefix, playbackID string) string {
	return withPrefix(prefix, "events/"+playbackID+"/live/index.m3u8")
}

// VODPlaylistKey returns the mutable public VOD-manifest key for an
// event.
func VODPlaylistKey(prefix, playbackID string) string {
	return withPrefix(prefix, "events/"+playbackID+"/vod/index.m3u8")
}

func withPrefix(prefix, key string) string {
	if prefix == "" {
		return key
	}
	return strings.TrimSuffix(prefix, "/") + "/" + key
}
