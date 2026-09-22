package telemetry

import (
	"time"
)

// StreamTelemetry is one event's current technical telemetry snapshot -
// the wire shape reported to
// POST /internal/media/nodes/{node_id}/telemetry (controlplane.go).
//
// Every pointer field is nil when genuinely unmeasured for this sample,
// never a fabricated zero. This mirrors the control plane's own existing
// "unavailable-with-reason" convention (eventcast-admin's
// NO_TECHNICAL_STREAM_METRICS_REASON) at the source, rather than sending
// a value the control plane would have to guess is fake.
type StreamTelemetry struct {
	EventID   string    `json:"event_id"`
	SampledAt time.Time `json:"sampled_at"`

	// Connected is this node's own authoritative fact: a session is
	// "starting" or "active" in ingest_sessions. Independent of whether
	// the SRS API happened to report a matching entry on this exact
	// sample - see Connected's doc in reporter.go for why the two can
	// legitimately disagree for one sample.
	Connected bool `json:"connected"`

	// SRSPublishActive mirrors SRS's own publish.active for this stream,
	// when SRS reported an entry at all. A nil here (not merely false)
	// means the SRS API had no entry for this ingest id on this sample.
	SRSPublishActive *bool `json:"srs_publish_active,omitempty"`

	VideoWidth  *int    `json:"video_width,omitempty"`
	VideoHeight *int    `json:"video_height,omitempty"`
	VideoCodec  *string `json:"video_codec,omitempty"`
	AudioCodec  *string `json:"audio_codec,omitempty"`
	// AudioPresent is derived solely from whether SRS reported an "audio"
	// object at all - never from sample_rate/channel content, which this
	// package deliberately never reports (see srsclient.go doc).
	AudioPresent *bool `json:"audio_present,omitempty"`

	// IngestKbpsRecv30s is SRS's own rolling 30-second receive bitrate
	// (kbps.recv_30s) - real ingest-bitrate evidence, not derived.
	IngestKbpsRecv30s *int `json:"ingest_kbps_recv_30s,omitempty"`
	// RecvBytes is SRS's own cumulative bytes-received counter for this
	// stream (recv_bytes) - supporting evidence, not a rate.
	RecvBytes *int64 `json:"recv_bytes,omitempty"`

	// CapturedSegmentBitrateKbps is DERIVED from this node's own durable
	// segment_jobs bytes (locally captured, protected segments) divided
	// by elapsed publish duration. It is only an average LOCAL
	// captured-segment bitrate estimate: it proves that many bytes were
	// captured into this node's spool over that time window, and
	// NOTHING MORE - it does not prove successful R2 upload, CDN
	// delivery, or that any viewer actually received those bytes. Always
	// reported separately from IngestKbpsRecv30s (SRS's own rolling
	// ingest/receive bitrate) and must never be merged or relabelled as
	// a single "bitrate" without preserving this distinction. Nil
	// whenever the underlying captured-byte measurement itself failed -
	// never computed from a fabricated fallback value.
	CapturedSegmentBitrateKbps *float64 `json:"captured_segment_bitrate_kbps,omitempty"`

	PublishDurationSeconds *float64 `json:"publish_duration_seconds,omitempty"`
	// SessionCount and ReconnectCount are pointers: a failed
	// SessionCountForEvent query must leave both unavailable, never
	// fabricate SessionCount=1/ReconnectCount=0 as if a real,
	// single-session history had been measured. A genuine first session
	// (query succeeded, count is actually 1) still correctly reports
	// SessionCount=1, ReconnectCount=0 - the pointer distinguishes
	// "measured as 1" from "not measured".
	SessionCount   *int `json:"session_count,omitempty"`
	ReconnectCount *int `json:"reconnect_count,omitempty"`

	// SegmentFreshnessSeconds is how long ago this session's spool last
	// received a captured segment (ingest_sessions.last_activity_at) -
	// the same signal 02_V1_ARCHITECTURE_SPEC.md's own warning threshold
	// ("no new local segment for three expected segment durations") is
	// defined against. The control plane derives simple source health
	// from this, not from any new threshold invented here.
	SegmentFreshnessSeconds *float64 `json:"segment_freshness_seconds,omitempty"`
}

// SessionEndedTelemetry is one durable session-summary entry, sent once
// per ended session, reusing ingest_sessions' own already-durable fields.
// It becomes a media_stream_sessions append-only row in the control-plane
// schema - never a live "current state" update, which is what
// StreamTelemetry above is for.
type SessionEndedTelemetry struct {
	EventID         string    `json:"event_id"`
	SessionID       string    `json:"session_id"`
	StartedAt       time.Time `json:"started_at"`
	DisconnectedAt  time.Time `json:"disconnected_at"`
	EndReason       string    `json:"end_reason"`
	SegmentCount    int       `json:"segment_count"`
	DurationSeconds float64   `json:"duration_seconds"`
}

// NodeHeartbeat is this node's own health-reporting payload, sent
// alongside StreamTelemetry entries in the same request
// (controlplane.go's TelemetryReport). Fields map onto media_nodes'
// existing heartbeat/capacity columns (migration 0020) - this package is
// the writer those columns have never had.
//
// DiskFreeBytes, R2QueueBytes, ConfigVersion, and ActiveStreamCount are
// all pointers because a genuinely unmeasured fact must be omitted,
// never reported as a fabricated 0 - "no free disk", "no queue
// backlog", and "zero active sessions" are real, different operational
// facts from "not measured this tick" (e.g. a failed durable-store
// query), consistent with this package's unavailable-with-reason
// principle. len() of a slice that is nil only because its query failed
// is exactly the kind of accidental-zero this guards against.
type NodeHeartbeat struct {
	DiskFreeBytes *int64 `json:"disk_free_bytes,omitempty"`
	R2QueueBytes  *int64 `json:"r2_queue_bytes,omitempty"`
	// SoftwareVersion is always sent - internal/health.Version is a real
	// build-time constant (falling back to the literal "dev" only for an
	// unreleased/local build, never a guess), so it has no failure mode
	// that would leave it unmeasured.
	SoftwareVersion string `json:"software_version"`
	// ConfigVersion has no authoritative source in this agent today (no
	// separate config-versioning scheme exists) and is therefore always
	// nil/omitted here - never fabricated from SoftwareVersion, which is
	// a different fact (build identity, not configuration identity).
	ConfigVersion     *string `json:"config_version,omitempty"`
	ActiveStreamCount *int    `json:"active_stream_count,omitempty"`
}

// BuildStreamTelemetry combines this node's own durable session state
// with (optionally) one matching SRS API sample into one StreamTelemetry
// entry. srsStream is nil whenever the SRS API had no entry for this
// session's ingest id on this sample (see srsclient.go's FindByName doc)
// - every SRS-sourced field is then correctly left nil rather than
// guessed. sessionCount and capturedBytes are themselves nil whenever
// their underlying store query failed this tick - BuildStreamTelemetry
// never substitutes a fallback value for either; SessionCount,
// ReconnectCount, and CapturedSegmentBitrateKbps are correspondingly left
// nil in that case. Connected/PublishDurationSeconds/
// SegmentFreshnessSeconds always come from this node's own store (the
// session row itself, already proven to exist by the caller) and are
// reported regardless.
func BuildStreamTelemetry(
	eventID string,
	sessionStartedAt time.Time,
	lastActivityAt time.Time,
	sessionCount *int,
	capturedBytes *int64,
	srsStream *SRSStream,
	now time.Time,
) StreamTelemetry {
	publishDuration := now.Sub(sessionStartedAt).Seconds()
	freshness := now.Sub(lastActivityAt).Seconds()

	t := StreamTelemetry{
		EventID:                 eventID,
		SampledAt:               now,
		Connected:               true,
		PublishDurationSeconds:  floatPtr(publishDuration),
		SegmentFreshnessSeconds: floatPtr(freshness),
	}

	if sessionCount != nil {
		t.SessionCount = sessionCount
		reconnects := *sessionCount - 1
		if reconnects < 0 {
			reconnects = 0
		}
		t.ReconnectCount = &reconnects
	}

	// Captured-segment bitrate is only ever computed from an actually
	// measured captured-byte value - a failed store query must never
	// silently produce a fabricated 0 bitrate. It does not depend on
	// srsStream at all.
	if capturedBytes != nil && publishDuration > 0 {
		capturedKbps := (float64(*capturedBytes) * 8 / 1000) / publishDuration
		t.CapturedSegmentBitrateKbps = floatPtr(capturedKbps)
	}

	if srsStream == nil {
		return t
	}

	active := srsStream.Publish.Active
	t.SRSPublishActive = &active
	kbps := srsStream.Kbps.RecvSec30
	t.IngestKbpsRecv30s = &kbps
	recvBytes := srsStream.RecvBytes
	t.RecvBytes = &recvBytes

	if srsStream.Video != nil {
		w := srsStream.Video.Width
		h := srsStream.Video.Height
		codec := srsStream.Video.Codec
		t.VideoWidth = &w
		t.VideoHeight = &h
		t.VideoCodec = &codec
	}
	if srsStream.Audio != nil {
		codec := srsStream.Audio.Codec
		t.AudioCodec = &codec
		present := true
		t.AudioPresent = &present
	} else {
		absent := false
		t.AudioPresent = &absent
	}

	return t
}

func floatPtr(f float64) *float64 { return &f }
