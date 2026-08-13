package upload

// Backblaze B2 authoritative archive key layout. Two deliberate
// differences from the R2 live/DVR layout in keys.go:
//
//	{prefix}/events/{event_id}/vod/{finalization_generation}.m3u8
//	{prefix}/events/{event_id}/media/{session_id}/{sha256}-{local_file_identity}
//
// 1. Event identity is the immutable Supabase event UUID, never
//    playback_id. A playback_id rotates on every re-activation (proven by
//    a real production A->B rotation), so it cannot address a durable
//    archive. No customer name, event title, slug, or other mutable or
//    public identity appears anywhere in these keys.
//
// 2. The playlist is generation-specific and segments are
//    content-addressed. Together these make an archived generation
//    physically immutable: a replacement generation that has not yet been
//    strongly verified writes its playlist to a different key and, for any
//    segment whose bytes actually changed, to a different segment key -
//    so it can never alter the bytes underneath a previously verified
//    generation's playlist. Segments whose bytes are unchanged across
//    generations resolve to the identical key and are safely shared rather
//    than re-uploaded.
//
// Sanitization follows the existing convention in keys.go rather than
// re-sanitizing here: local_file_identity is already the sanitized,
// collision-safe name produced by internal/spool.SegmentFileName, sha256
// is hex by construction, and event/session ids are server-generated
// identifiers. Reusing those values verbatim guarantees the B2 key can
// never disagree with the identity the rest of the pipeline already
// recorded.

// B2VODPlaylistKey returns the generation-specific authoritative playlist
// key for one event. This is the value persisted as
// event_recordings.b2_object_key for the currently authoritative
// generation.
func B2VODPlaylistKey(prefix, eventID, generation string) string {
	return withPrefix(prefix, "events/"+eventID+"/vod/"+generation+".m3u8")
}

// B2SegmentKey returns the deterministic, content-addressed object key for
// one archived segment.
func B2SegmentKey(prefix, eventID, sessionID, sha256Hex, localFileIdentity string) string {
	return withPrefix(prefix, "events/"+eventID+"/media/"+sessionID+"/"+sha256Hex+"-"+localFileIdentity)
}

// b2SegmentRelativeURI returns the playlist-relative reference to a
// segment, resolved from the playlist's own location at
// events/{event_id}/vod/. Relative rather than absolute because the
// bucket is private and no playback-delivery path (presigned URL, Worker
// proxy, or CDN origin) has been approved yet - a relative URI stays
// correct under whichever one is chosen later, whereas an absolute URI
// would bake in a base that does not exist.
func b2SegmentRelativeURI(sessionID, sha256Hex, localFileIdentity string) string {
	return "../media/" + sessionID + "/" + sha256Hex + "-" + localFileIdentity
}

// B2ConnectivityTestKey returns the key for one isolated connectivity-test
// object. The `_connectivity-test/` prefix is deliberately outside
// `events/`, so a test object can never be mistaken for, or collide with,
// real recording data.
func B2ConnectivityTestKey(prefix, nodeID, token string) string {
	return withPrefix(prefix, "_connectivity-test/"+nodeID+"/"+token+".txt")
}
