package controlplane

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/telemetry"
)

// ------------------------------------------------------ relay + manifest

func enrich(t *testing.T, st *store.Store, sess store.Session, now time.Time) telemetry.StreamTelemetry {
	t.Helper()
	r := &TelemetryReporter{store: st, logger: testLogger(t), now: time.Now}
	out := telemetry.BuildStreamTelemetry(sess.EventID, sess.StartedAt, sess.LastActivityAt, nil, nil, nil, now)
	r.addRelayAndManifest(context.Background(), &out, sess, now)
	return out
}

func activeSession(t *testing.T, st *store.Store) store.Session {
	t.Helper()
	s, err := st.CreateSession(context.Background(), "evt-1", "ing-1", "pb-1", time.Now().UTC().Add(-10*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestTelemetry_NoRelay_OmitsAllRelayFields(t *testing.T) {
	st := openTestStore(t)
	sess := activeSession(t, st)
	got := enrich(t, st, sess, time.Now().UTC())
	if got.RelayStatus != nil || got.RelayRestartCount != nil || got.RelayErrorCategory != nil {
		t.Fatalf("relay fields present without relay: %+v", got)
	}
}

func TestTelemetry_RelayRunning_StatusAndCount(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	sess := activeSession(t, st)
	now := time.Now().UTC()
	if err := st.UpsertRelayStarting(ctx, sess.EventID, sess.ID, now); err != nil {
		t.Fatal(err)
	}
	if err := st.IncrementRelayRestart(ctx, sess.ID, "ffmpeg exited: exit status 1 (stderr: rtmp://a.rtmp.youtube.com/live2/SECRETKEY)", now); err != nil {
		t.Fatal(err)
	}
	if err := st.MarkRelayRunning(ctx, sess.ID, now); err != nil {
		t.Fatal(err)
	}
	got := enrich(t, st, sess, now)
	if got.RelayStatus == nil || *got.RelayStatus != store.RelayRunning || got.RelayRestartCount == nil || *got.RelayRestartCount != 1 {
		t.Fatalf("relay = %+v", got)
	}
	if got.RelayErrorCategory != nil {
		t.Fatalf("running relay (last_error cleared) reported category %q", *got.RelayErrorCategory)
	}
}

func TestTelemetry_RelayFailed_CategoryAndNoRawErrorInJSON(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	sess := activeSession(t, st)
	now := time.Now().UTC()
	raw := "ffmpeg exited: exit status 1 (stderr: rtmp://a.rtmp.youtube.com/live2/SECRETKEY)"
	if err := st.UpsertRelayStarting(ctx, sess.EventID, sess.ID, now); err != nil {
		t.Fatal(err)
	}
	if err := st.MarkRelayFailed(ctx, sess.ID, raw, now); err != nil {
		t.Fatal(err)
	}
	got := enrich(t, st, sess, now)
	if got.RelayErrorCategory == nil || *got.RelayErrorCategory != telemetry.RelayErrorRestartBudgetExhausted {
		t.Fatalf("category = %v, want restart_budget_exhausted", got.RelayErrorCategory)
	}
	b, _ := json.Marshal(TelemetryReport{Streams: []telemetry.StreamTelemetry{got}})
	for _, leak := range []string{"SECRETKEY", "stderr", "rtmp://", "ffmpeg exited"} {
		if strings.Contains(string(b), leak) {
			t.Fatalf("raw relay error text %q leaked into telemetry JSON: %s", leak, b)
		}
	}
}

func TestTelemetry_ManifestAge_NilWithoutManifest_ComputedAndClamped(t *testing.T) {
	ctx := context.Background()
	st := openTestStore(t)
	sess := activeSession(t, st)
	now := time.Now().UTC()
	if got := enrich(t, st, sess, now); got.ManifestAgeSeconds != nil {
		t.Fatalf("manifest age = %v, want nil with no live manifest", *got.ManifestAgeSeconds)
	}
	if _, err := st.RecordManifestGeneration(ctx, sess.EventID, store.ManifestTypeLive, []int64{1}, 0, "k", now.Add(-45*time.Second)); err != nil {
		t.Fatal(err)
	}
	got := enrich(t, st, sess, now)
	if got.ManifestAgeSeconds == nil || *got.ManifestAgeSeconds != 45 {
		t.Fatalf("manifest age = %v, want 45", got.ManifestAgeSeconds)
	}
	if _, err := st.RecordManifestGeneration(ctx, sess.EventID, store.ManifestTypeLive, []int64{1, 2}, 0, "k", now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got := enrich(t, st, sess, now); got.ManifestAgeSeconds == nil || *got.ManifestAgeSeconds != 0 {
		t.Fatalf("future-published manifest age = %v, want clamped 0", got.ManifestAgeSeconds)
	}
}

// ------------------------------------------------------ r2 playback id

func TestPlaybackIDFromVODKey(t *testing.T) {
	cases := []struct {
		key    string
		wantID string
		wantOK bool
	}{
		{"events/pb-123/vod/index.m3u8", "pb-123", true},
		{"prod/eventcast/events/abcDEF_0.9/vod/index.m3u8", "abcDEF_0.9", true},
		{"events/pb-123/live/index.m3u8", "", false},                          // wrong manifest
		{"events/pb-123/vod/index.m3u8.bak", "", false},                       // wrong suffix
		{"pb-123/vod/index.m3u8", "", false},                                  // no events/
		{"x-events/pb-123/vod/index.m3u8", "", false},                         // events must be its own component
		{"events//vod/index.m3u8", "", false},                                 // empty id
		{"events/.hidden/vod/index.m3u8", "", false},                          // bad first char
		{"events/pb%2F1/vod/index.m3u8", "", false},                           // bad charset
		{"events/" + strings.Repeat("a", 129) + "/vod/index.m3u8", "", false}, // too long
		{"", "", false},
	}
	for _, tc := range cases {
		id, ok := playbackIDFromVODKey(tc.key)
		if id != tc.wantID || ok != tc.wantOK {
			t.Errorf("playbackIDFromVODKey(%q) = (%q, %v), want (%q, %v)", tc.key, id, ok, tc.wantID, tc.wantOK)
		}
	}
}

func reportWithVOD(t *testing.T, r2Key string, finalize bool) RecordingStateReport {
	t.Helper()
	ctx := context.Background()
	st := openTestStore(t)
	now := time.Now().UTC()
	if finalize {
		if err := st.UpsertVODFinalized(ctx, "evt-1", []int64{1}, 1, r2Key, 0, now); err != nil {
			t.Fatalf("UpsertVODFinalized: %v", err)
		}
	}
	if _, err := st.EnqueueB2Archive(ctx, store.EnqueueB2ArchiveInput{
		EventID: "evt-1", Generation: "gen-a", CoveredPlaybackIDs: []string{"pb-1"}, LocalFinalizedAt: now,
	}, now); err != nil {
		t.Fatalf("EnqueueB2Archive: %v", err)
	}
	client := &captureClient{}
	NewRecordingReporter(st, client, RecordingReporterConfig{NodeID: "n", RetryBaseDelay: time.Millisecond, RetryMaxDelay: time.Millisecond}, testLogger(t)).RunOnce(ctx)
	if len(client.reports) != 1 {
		t.Fatalf("reports = %d, want 1", len(client.reports))
	}
	return client.reports[0]
}

func TestRecordingReport_R2PlaybackID(t *testing.T) {
	if got := reportWithVOD(t, "events/pb-7/vod/index.m3u8", true).R2PlaybackID; got != "pb-7" {
		t.Errorf("exact key: r2_playback_id = %q, want pb-7", got)
	}
	if got := reportWithVOD(t, "pfx/events/pb-8/vod/index.m3u8", true).R2PlaybackID; got != "pb-8" {
		t.Errorf("prefixed key: r2_playback_id = %q, want pb-8", got)
	}
	if got := reportWithVOD(t, "", false).R2PlaybackID; got != "" {
		t.Errorf("missing finalization: r2_playback_id = %q, want omitted", got)
	}
	if got := reportWithVOD(t, "events/pb-9/live/index.m3u8", true).R2PlaybackID; got != "" {
		t.Errorf("malformed key: r2_playback_id = %q, want omitted", got)
	}
	if got := reportWithVOD(t, "events/bad id/vod/index.m3u8", true).R2PlaybackID; got != "" {
		t.Errorf("invalid id: r2_playback_id = %q, want omitted", got)
	}
	b, _ := json.Marshal(reportWithVOD(t, "", false))
	if strings.Contains(string(b), "r2_playback_id") {
		t.Errorf("omitted r2_playback_id still serialized: %s", b)
	}
}
