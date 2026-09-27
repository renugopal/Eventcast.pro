package controlplane

import (
	"context"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/telemetry"
)

// addRelayAndManifest enriches one StreamTelemetry entry with relay runtime
// state and live-manifest age. Every query failure leaves the affected
// fields nil (unmeasured) - never a fabricated value - and never fails the
// report.
func (r *TelemetryReporter) addRelayAndManifest(ctx context.Context, st *telemetry.StreamTelemetry, sess store.Session, now time.Time) {
	relay, found, err := r.store.GetRelayBySessionID(ctx, sess.ID)
	switch {
	case err != nil:
		r.logger.Warn("telemetry reporter: relay lookup failed; omitting relay fields",
			slog.String("session_id", sess.ID))
	case found:
		status := relay.Status
		count := relay.RestartCount
		st.RelayStatus = &status
		st.RelayRestartCount = &count
		if cat := telemetry.RelayErrorCategory(relay.Status, relay.LastError); cat != "" {
			st.RelayErrorCategory = &cat
		}
		// relay.LastError itself is deliberately never copied anywhere.
	}

	gen, found, err := r.store.GetLatestManifestGeneration(ctx, sess.EventID, store.ManifestTypeLive)
	switch {
	case err != nil:
		r.logger.Warn("telemetry reporter: live manifest lookup failed; omitting manifest age",
			slog.String("event_id", sess.EventID))
	case found:
		age := telemetry.NonNegativeSeconds(now, gen.PublishedAt)
		st.ManifestAgeSeconds = &age
	}
}

// playbackComponentRE is the render Worker's exact COMPONENT_RE
// (workers/render-event-page/src/hls-playback.mjs, isValidPlaybackId).
var playbackComponentRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

const vodKeySuffix = "/vod/index.m3u8"

// playbackIDFromVODKey extracts the playback id from a durable
// vod_finalizations.r2_key written by upload.VODPlaylistKey:
//
//	events/<playback_id>/vod/index.m3u8
//	<prefix>/events/<playback_id>/vod/index.m3u8
//
// It requires that exact structure and validates <playback_id> with the
// Worker's component rule. Anything else yields ok=false (omit, never
// guess).
func playbackIDFromVODKey(key string) (string, bool) {
	rest, ok := strings.CutSuffix(key, vodKeySuffix)
	if !ok {
		return "", false
	}
	idx := strings.LastIndex(rest, "/")
	if idx < 0 {
		return "", false
	}
	eventsPart, id := rest[:idx], rest[idx+1:]
	if eventsPart != "events" && !strings.HasSuffix(eventsPart, "/events") {
		return "", false
	}
	if !playbackComponentRE.MatchString(id) {
		return "", false
	}
	return id, true
}
