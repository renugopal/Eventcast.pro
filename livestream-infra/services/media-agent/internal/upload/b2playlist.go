package upload

import (
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// buildB2Playlist renders the authoritative B2 archive playlist for one
// finalized generation.
//
// It is always a finalized VOD playlist: media sequence 0 and
// EXT-X-ENDLIST, because an archive is by definition complete and never
// a sliding live window.
//
// Segments are addressed by playlist-relative, content-addressed URI
// (b2SegmentRelativeURI), never by R2 key and never by absolute URL. The
// R2 playlist is deliberately NOT copied: its own segment references are
// built against the R2 public base URL, so a byte-copy would produce an
// "archive" that still points back at hot storage - exactly the
// dependency the authoritative archive exists to remove.
//
// All other playlist mechanics (target duration, per-session
// EXT-X-DISCONTINUITY, EXTINF rendering) come from the shared
// renderPlaylist used by the live and R2 VOD manifests, so the two can
// never drift.
func buildB2Playlist(confirmed []store.SegmentJob) string {
	return renderPlaylist(confirmed, 0, true, func(s store.SegmentJob) string {
		return b2SegmentRelativeURI(s.SessionID, s.SHA256, s.LocalFileIdentity)
	})
}
