// TypeScript representations of the shared EventCast livestream
// contracts, suitable for the EventCast control plane. The source of
// truth for every field name, required/optional flag, and enum value
// is ../contracts.json; this file and validate.ts must be kept in
// exact sync with that file, the applied
// 0019_livestream_control_plane.sql migration CHECK constraints, and
// services/media-agent/internal/srs/srs.go.

export const SCHEMA_VERSION = "1.0.0";

// SrsCallbackPayload is the shared JSON envelope SRS posts to
// on_publish, on_hls, and on_unpublish, with the fields relevant to
// each action populated and the rest absent/zero-valued. Field names
// match the Go SRSCallbackPayload json tags exactly.
export interface SrsCallbackPayload {
  action: string;
  client_id?: string;
  ip?: string;
  vhost?: string;
  app?: string;
  stream: string;
  param?: string;
  file?: string;
  url?: string;
  m3u8?: string;
  duration?: number;
  seq_no?: number;
}

// SrsCallbackSuccessResponse is the SRS-compatible success body every
// accepted callback returns. A non-zero code tells SRS to reject the
// action.
export interface SrsCallbackSuccessResponse {
  code: number;
}

export const SRS_ROUTES = {
  onPublish: "/internal/srs/on-publish",
  onHls: "/internal/srs/on-hls",
  onUnpublish: "/internal/srs/on-unpublish",
} as const;

// ERROR_CODES: stable machine-readable internal API / Media Agent job
// error codes (03_DATA_MODEL_AND_API_CONTRACTS.md "Error model"). Must
// match the media_jobs.last_error_code CHECK constraint in
// 0019_livestream_control_plane.sql exactly.
export const ERROR_CODES = [
  "AUTH_INVALID",
  "ASSIGNMENT_MISMATCH",
  "PUBLISH_WINDOW_CLOSED",
  "DUPLICATE_PUBLISHER",
  "SPOOL_FILE_MISSING",
  "SPOOL_FILE_UNSTABLE",
  "R2_AUTH",
  "R2_RETRYABLE",
  "R2_OBJECT_MISMATCH",
  "MANIFEST_GAP",
  "MANIFEST_PUBLISH_FAILED",
  "YOUTUBE_RELAY_FAILED",
  "WASABI_AUTH",
  "WASABI_RETRYABLE",
  "ARCHIVE_MISMATCH",
  "DISK_PRESSURE",
  "STATE_CONFLICT",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

// MEDIA_NODE_STATES: media_nodes.status values. Only healthy nodes
// outside maintenance_mode may receive new assignments.
export const MEDIA_NODE_STATES = ["provisioning", "healthy", "degraded", "unavailable", "retired"] as const;
export type MediaNodeState = (typeof MEDIA_NODE_STATES)[number];

// EVENT_MEDIA_STATES: events.media_state /
// event_state_transitions.from_state|to_state values.
export const EVENT_MEDIA_STATES = [
  "scheduled",
  "ready",
  "live",
  "interrupted",
  "ending",
  "finalizing",
  "vod_ready",
  "archiving",
  "archived",
  "cancelled",
] as const;
export type EventMediaState = (typeof EVENT_MEDIA_STATES)[number];

// STREAM_SESSION_STATES: stream_sessions.status values. A reconnect
// creates a new row rather than reopening the old session identity.
export const STREAM_SESSION_STATES = ["starting", "active", "disconnected", "finalized", "failed"] as const;
export type StreamSessionState = (typeof STREAM_SESSION_STATES)[number];

// MEDIA_JOB_STATES: media_jobs.status values.
export const MEDIA_JOB_STATES = [
  "queued",
  "running",
  "paused",
  "retry_wait",
  "succeeded",
  "failed_recoverable",
  "cancelled",
] as const;
export type MediaJobState = (typeof MEDIA_JOB_STATES)[number];

// MEDIA_JOB_TYPES: media_jobs.type values. Aggregate job types only;
// never one row per HLS segment.
export const MEDIA_JOB_TYPES = [
  "finalize_vod",
  "create_mp4",
  "archive_to_wasabi",
  "restore_to_r2",
  "delete_r2_hot_copy",
] as const;
export type MediaJobType = (typeof MEDIA_JOB_TYPES)[number];
