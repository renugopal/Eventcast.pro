package telemetry

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func intPtr(i int) *int     { return &i }
func i64Ptr(i int64) *int64 { return &i }

func TestBuildStreamTelemetryWithNoSRSStreamLeavesSRSFieldsNil(t *testing.T) {
	now := time.Now().UTC()
	started := now.Add(-30 * time.Second)
	lastActivity := now.Add(-2 * time.Second)

	got := BuildStreamTelemetry("evt-1", started, lastActivity, intPtr(2), i64Ptr(1000), nil, now)

	if !got.Connected {
		t.Error("Connected = false, want true (this node's own session state)")
	}
	if got.SRSPublishActive != nil {
		t.Error("SRSPublishActive != nil when SRS reported nothing this tick")
	}
	if got.VideoWidth != nil || got.VideoHeight != nil || got.VideoCodec != nil {
		t.Error("video fields != nil when SRS reported nothing this tick")
	}
	if got.AudioCodec != nil || got.AudioPresent != nil {
		t.Error("audio fields != nil when SRS reported nothing this tick")
	}
	if got.IngestKbpsRecv30s != nil || got.RecvBytes != nil {
		t.Error("SRS-sourced ingest fields != nil when SRS reported nothing this tick")
	}
	// Own-store facts must still be present regardless of SRS.
	if got.SessionCount == nil || *got.SessionCount != 2 {
		t.Errorf("SessionCount = %v, want 2", got.SessionCount)
	}
	if got.ReconnectCount == nil || *got.ReconnectCount != 1 {
		t.Errorf("ReconnectCount = %v, want 1", got.ReconnectCount)
	}
	if got.CapturedSegmentBitrateKbps == nil {
		t.Error("CapturedSegmentBitrateKbps = nil, want a derived value from capturedBytes")
	}
}

func TestBuildStreamTelemetryFirstSessionHasZeroReconnects(t *testing.T) {
	now := time.Now().UTC()
	got := BuildStreamTelemetry("evt-1", now.Add(-10*time.Second), now, intPtr(1), i64Ptr(0), nil, now)

	if got.SessionCount == nil || *got.SessionCount != 1 {
		t.Errorf("SessionCount = %v, want 1", got.SessionCount)
	}
	if got.ReconnectCount == nil || *got.ReconnectCount != 0 {
		t.Errorf("ReconnectCount = %v, want 0", got.ReconnectCount)
	}
}

func TestBuildStreamTelemetryWithSRSStreamPopulatesEveryObservedField(t *testing.T) {
	now := time.Now().UTC()
	kbps := 298
	recv := int64(1820224)
	srs := &SRSStream{
		Name:      "step0stream",
		RecvBytes: recv,
		Kbps:      SRSKbps{RecvSec30: kbps},
		Publish:   SRSPublishInfo{Active: true},
		Video:     &SRSVideoInfo{Codec: "H264", Width: 320, Height: 240},
		Audio:     &SRSAudioInfo{Codec: "AAC"},
	}

	got := BuildStreamTelemetry("evt-1", now.Add(-1*time.Minute), now, intPtr(1), i64Ptr(1000), srs, now)

	if got.SRSPublishActive == nil || !*got.SRSPublishActive {
		t.Error("SRSPublishActive not true")
	}
	if got.IngestKbpsRecv30s == nil || *got.IngestKbpsRecv30s != 298 {
		t.Errorf("IngestKbpsRecv30s = %v, want 298", got.IngestKbpsRecv30s)
	}
	if got.RecvBytes == nil || *got.RecvBytes != recv {
		t.Errorf("RecvBytes = %v, want %d", got.RecvBytes, recv)
	}
	if got.VideoWidth == nil || *got.VideoWidth != 320 {
		t.Errorf("VideoWidth = %v, want 320", got.VideoWidth)
	}
	if got.VideoCodec == nil || *got.VideoCodec != "H264" {
		t.Errorf("VideoCodec = %v, want H264", got.VideoCodec)
	}
	if got.AudioCodec == nil || *got.AudioCodec != "AAC" {
		t.Errorf("AudioCodec = %v, want AAC", got.AudioCodec)
	}
	if got.AudioPresent == nil || !*got.AudioPresent {
		t.Error("AudioPresent not true when SRS reported an audio object")
	}
}

// A stream with no audio object at all (e.g. video-only) must report
// AudioPresent=false, not leave it nil - the absence itself IS the
// measured fact, unlike video/audio codec fields which are genuinely
// unavailable in that case.
func TestBuildStreamTelemetryReportsAudioAbsentWhenNoAudioObject(t *testing.T) {
	now := time.Now().UTC()
	srs := &SRSStream{
		Name:    "video-only",
		Publish: SRSPublishInfo{Active: true},
		Video:   &SRSVideoInfo{Codec: "H264", Width: 320, Height: 240},
		Audio:   nil,
	}

	got := BuildStreamTelemetry("evt-1", now.Add(-1*time.Minute), now, intPtr(1), i64Ptr(1000), srs, now)

	if got.AudioPresent == nil {
		t.Fatal("AudioPresent = nil, want an explicit false")
	}
	if *got.AudioPresent {
		t.Error("AudioPresent = true when SRS reported no audio object")
	}
	if got.AudioCodec != nil {
		t.Error("AudioCodec != nil when SRS reported no audio object")
	}
}

// The central Step 0 finding: no fps/frame-rate field exists anywhere in
// this package's wire types, and it must never be fabricated. This is a
// real structural guard, not a placebo - it inspects every field name
// and JSON tag on StreamTelemetry via reflection and fails if any of
// them names an FPS/frame-rate concept under any common spelling, so a
// future accidental addition (FPS, Fps, FrameRate, or json tags fps /
// frame_rate / frameRate) is caught at test time rather than relying on
// this file simply never mentioning one.
func TestStreamTelemetryHasNoFPSField(t *testing.T) {
	forbidden := []string{"fps", "framerate"}

	typ := reflect.TypeOf(StreamTelemetry{})
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)

		lowerName := strings.ToLower(field.Name)
		for _, f := range forbidden {
			if strings.Contains(lowerName, f) {
				t.Errorf("StreamTelemetry field %q must not exist: Step 0 proved FPS is unavailable from the pinned SRS API and must never be fabricated", field.Name)
			}
		}

		tagName := strings.Split(field.Tag.Get("json"), ",")[0]
		lowerTag := strings.ToLower(strings.ReplaceAll(tagName, "_", ""))
		for _, f := range forbidden {
			if strings.Contains(lowerTag, f) {
				t.Errorf("StreamTelemetry field %q has forbidden json tag %q: FPS must never be fabricated", field.Name, field.Tag.Get("json"))
			}
		}
	}
}

func TestBuildStreamTelemetryLeavesCapturedBitrateNilWhenCapturedBytesUnavailable(t *testing.T) {
	now := time.Now().UTC()
	got := BuildStreamTelemetry("evt-1", now.Add(-10*time.Second), now, intPtr(1), nil, nil, now)

	if got.CapturedSegmentBitrateKbps != nil {
		t.Error("CapturedSegmentBitrateKbps != nil when capturedBytes measurement failed")
	}
}

func TestBuildStreamTelemetryLeavesSessionCountAndReconnectNilWhenUnavailable(t *testing.T) {
	now := time.Now().UTC()
	got := BuildStreamTelemetry("evt-1", now.Add(-10*time.Second), now, nil, i64Ptr(1000), nil, now)

	if got.SessionCount != nil {
		t.Error("SessionCount != nil when the session-count query failed")
	}
	if got.ReconnectCount != nil {
		t.Error("ReconnectCount != nil when the session-count query failed")
	}
	// Captured bitrate is independent of session count and must still be
	// computed.
	if got.CapturedSegmentBitrateKbps == nil {
		t.Error("CapturedSegmentBitrateKbps = nil, want a derived value independent of session count")
	}
}

func TestBuildStreamTelemetryAlwaysReportsDurationAndFreshness(t *testing.T) {
	now := time.Now().UTC()
	started := now.Add(-45 * time.Second)
	lastActivity := now.Add(-3 * time.Second)

	got := BuildStreamTelemetry("evt-1", started, lastActivity, nil, nil, nil, now)

	if got.PublishDurationSeconds == nil {
		t.Fatal("PublishDurationSeconds = nil, want a value derived from this node's own session row")
	}
	if *got.PublishDurationSeconds < 44 || *got.PublishDurationSeconds > 46 {
		t.Errorf("PublishDurationSeconds = %v, want ~45", *got.PublishDurationSeconds)
	}
	if got.SegmentFreshnessSeconds == nil {
		t.Fatal("SegmentFreshnessSeconds = nil, want a value derived from this node's own session row")
	}
	if *got.SegmentFreshnessSeconds < 2 || *got.SegmentFreshnessSeconds > 4 {
		t.Errorf("SegmentFreshnessSeconds = %v, want ~3", *got.SegmentFreshnessSeconds)
	}
}
