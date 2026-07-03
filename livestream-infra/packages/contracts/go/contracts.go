// Package contracts holds the Go representation of the shared EventCast
// livestream contracts used by the Media Agent: the SRS callback
// payload envelope and the fixed state/error-code enums. The source of
// truth for every field name, required/optional flag, and enum value is
// ../contracts.json; this file and contracts_test.go must be kept in
// exact sync with that file, the applied 0019_livestream_control_plane.sql
// migration CHECK constraints, and
// services/media-agent/internal/srs/srs.go.
package contracts

// SchemaVersion is the contract shape/value version this package
// implements. It must match contracts.json "schemaVersion".
const SchemaVersion = "1.0.0"

// SRSCallbackPayload is the shared JSON envelope SRS posts to
// on_publish, on_hls, and on_unpublish, with the fields relevant to
// each action populated and the rest zero-valued. Field names and JSON
// tags match services/media-agent/internal/srs/srs.go Payload exactly.
type SRSCallbackPayload struct {
	Action   string  `json:"action"`
	ClientID string  `json:"client_id"`
	IP       string  `json:"ip"`
	Vhost    string  `json:"vhost"`
	App      string  `json:"app"`
	Stream   string  `json:"stream"`
	Param    string  `json:"param"`
	File     string  `json:"file"`
	URL      string  `json:"url"`
	M3U8     string  `json:"m3u8"`
	Duration float64 `json:"duration"`
	SeqNo    int     `json:"seq_no"`
}

// SRSCallbackSuccessResponse is the SRS-compatible success body every
// accepted callback returns. A non-zero Code tells SRS to reject the
// action.
type SRSCallbackSuccessResponse struct {
	Code int `json:"code"`
}

// SRS callback route paths.
const (
	RouteOnPublish   = "/internal/srs/on-publish"
	RouteOnHLS       = "/internal/srs/on-hls"
	RouteOnUnpublish = "/internal/srs/on-unpublish"
)

// ErrorCode is a stable machine-readable internal API / Media Agent job
// error code (03_DATA_MODEL_AND_API_CONTRACTS.md "Error model").
type ErrorCode string

const (
	ErrAuthInvalid           ErrorCode = "AUTH_INVALID"
	ErrAssignmentMismatch    ErrorCode = "ASSIGNMENT_MISMATCH"
	ErrPublishWindowClosed   ErrorCode = "PUBLISH_WINDOW_CLOSED"
	ErrDuplicatePublisher    ErrorCode = "DUPLICATE_PUBLISHER"
	ErrSpoolFileMissing      ErrorCode = "SPOOL_FILE_MISSING"
	ErrSpoolFileUnstable     ErrorCode = "SPOOL_FILE_UNSTABLE"
	ErrR2Auth                ErrorCode = "R2_AUTH"
	ErrR2Retryable           ErrorCode = "R2_RETRYABLE"
	ErrR2ObjectMismatch      ErrorCode = "R2_OBJECT_MISMATCH"
	ErrManifestGap           ErrorCode = "MANIFEST_GAP"
	ErrManifestPublishFailed ErrorCode = "MANIFEST_PUBLISH_FAILED"
	ErrYouTubeRelayFailed    ErrorCode = "YOUTUBE_RELAY_FAILED"
	ErrWasabiAuth            ErrorCode = "WASABI_AUTH"
	ErrWasabiRetryable       ErrorCode = "WASABI_RETRYABLE"
	ErrArchiveMismatch       ErrorCode = "ARCHIVE_MISMATCH"
	ErrDiskPressure          ErrorCode = "DISK_PRESSURE"
	ErrStateConflict         ErrorCode = "STATE_CONFLICT"
)

// ErrorCodes is the complete set of valid error codes. Must match
// contracts.json errorCodes.values and the media_jobs.last_error_code
// CHECK constraint in 0019_livestream_control_plane.sql.
var ErrorCodes = []ErrorCode{
	ErrAuthInvalid, ErrAssignmentMismatch, ErrPublishWindowClosed, ErrDuplicatePublisher,
	ErrSpoolFileMissing, ErrSpoolFileUnstable, ErrR2Auth, ErrR2Retryable, ErrR2ObjectMismatch,
	ErrManifestGap, ErrManifestPublishFailed, ErrYouTubeRelayFailed, ErrWasabiAuth,
	ErrWasabiRetryable, ErrArchiveMismatch, ErrDiskPressure, ErrStateConflict,
}

// MediaNodeState is a media_nodes.status value. Only healthy nodes
// outside maintenance_mode may receive new assignments.
type MediaNodeState string

const (
	MediaNodeProvisioning MediaNodeState = "provisioning"
	MediaNodeHealthy      MediaNodeState = "healthy"
	MediaNodeDegraded     MediaNodeState = "degraded"
	MediaNodeUnavailable  MediaNodeState = "unavailable"
	MediaNodeRetired      MediaNodeState = "retired"
)

// MediaNodeStates is the complete set of valid media_nodes.status
// values. Must match contracts.json mediaNodeStates.values and the
// media_nodes.status CHECK constraint.
var MediaNodeStates = []MediaNodeState{
	MediaNodeProvisioning, MediaNodeHealthy, MediaNodeDegraded, MediaNodeUnavailable, MediaNodeRetired,
}

// EventMediaState is an events.media_state /
// event_state_transitions.from_state|to_state value.
type EventMediaState string

const (
	EventScheduled   EventMediaState = "scheduled"
	EventReady       EventMediaState = "ready"
	EventLive        EventMediaState = "live"
	EventInterrupted EventMediaState = "interrupted"
	EventEnding      EventMediaState = "ending"
	EventFinalizing  EventMediaState = "finalizing"
	EventVodReady    EventMediaState = "vod_ready"
	EventArchiving   EventMediaState = "archiving"
	EventArchived    EventMediaState = "archived"
	EventCancelled   EventMediaState = "cancelled"
)

// EventMediaStates is the complete set of valid events.media_state
// values. Must match contracts.json eventMediaStates.values and the
// events.media_state / event_state_transitions CHECK constraints.
var EventMediaStates = []EventMediaState{
	EventScheduled, EventReady, EventLive, EventInterrupted, EventEnding,
	EventFinalizing, EventVodReady, EventArchiving, EventArchived, EventCancelled,
}

// StreamSessionState is a stream_sessions.status value. A reconnect
// creates a new row rather than reopening the old session identity.
type StreamSessionState string

const (
	StreamSessionStarting     StreamSessionState = "starting"
	StreamSessionActive       StreamSessionState = "active"
	StreamSessionDisconnected StreamSessionState = "disconnected"
	StreamSessionFinalized    StreamSessionState = "finalized"
	StreamSessionFailed       StreamSessionState = "failed"
)

// StreamSessionStates is the complete set of valid
// stream_sessions.status values. Must match contracts.json
// streamSessionStates.values and the stream_sessions.status CHECK
// constraint.
var StreamSessionStates = []StreamSessionState{
	StreamSessionStarting, StreamSessionActive, StreamSessionDisconnected, StreamSessionFinalized, StreamSessionFailed,
}

// MediaJobState is a media_jobs.status value.
type MediaJobState string

const (
	MediaJobQueued            MediaJobState = "queued"
	MediaJobRunning           MediaJobState = "running"
	MediaJobPaused            MediaJobState = "paused"
	MediaJobRetryWait         MediaJobState = "retry_wait"
	MediaJobSucceeded         MediaJobState = "succeeded"
	MediaJobFailedRecoverable MediaJobState = "failed_recoverable"
	MediaJobCancelled         MediaJobState = "cancelled"
)

// MediaJobStates is the complete set of valid media_jobs.status
// values. Must match contracts.json mediaJobStates.values and the
// media_jobs.status CHECK constraint.
var MediaJobStates = []MediaJobState{
	MediaJobQueued, MediaJobRunning, MediaJobPaused, MediaJobRetryWait,
	MediaJobSucceeded, MediaJobFailedRecoverable, MediaJobCancelled,
}

// MediaJobType is a media_jobs.type value. Aggregate job types only;
// never one row per HLS segment.
type MediaJobType string

const (
	MediaJobTypeFinalizeVOD     MediaJobType = "finalize_vod"
	MediaJobTypeCreateMP4       MediaJobType = "create_mp4"
	MediaJobTypeArchiveToWasabi MediaJobType = "archive_to_wasabi"
	MediaJobTypeRestoreToR2     MediaJobType = "restore_to_r2"
	MediaJobTypeDeleteR2HotCopy MediaJobType = "delete_r2_hot_copy"
)

// MediaJobTypes is the complete set of valid media_jobs.type values.
// Must match contracts.json mediaJobTypes.values and the
// media_jobs.type CHECK constraint.
var MediaJobTypes = []MediaJobType{
	MediaJobTypeFinalizeVOD, MediaJobTypeCreateMP4, MediaJobTypeArchiveToWasabi,
	MediaJobTypeRestoreToR2, MediaJobTypeDeleteR2HotCopy,
}
