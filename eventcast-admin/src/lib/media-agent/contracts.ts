/**
 * Canonical Admin-side TypeScript models for the EventCast Media Agent
 * assignment pull contract.
 *
 * Source of truth is the ACTUAL current Media Agent Go implementation, not
 * this file's convenience. Every wire name and value shape below is derived
 * from committed Go code, using the authority order implemented-behavior >
 * tests > config > docs:
 *
 *   - Assignment struct + JSON tags:
 *       livestream-infra/services/media-agent/internal/store/assignments.go
 *   - Response envelope (AssignmentsResponse):
 *       livestream-infra/services/media-agent/internal/controlplane/client.go
 *   - youtube_stream_key secret handling (logging.Secret):
 *       livestream-infra/services/media-agent/internal/logging/logging.go
 *   - Optionality / seed-parse evidence:
 *       livestream-infra/services/media-agent/internal/store/assignments_test.go
 *
 * Derived wire facts:
 *   - The Go Assignment and AssignmentsResponse structs carry NO `omitempty`
 *     tags, so a Go control plane emits every field on every assignment and
 *     on the envelope. There are no pointer fields, so nothing is ever JSON
 *     `null`; a disabled YouTube relay serializes as `""`/`false`, never
 *     `null` and never absent.
 *   - `time.Time` fields marshal to RFC3339(Nano) strings.
 *   - `youtube_stream_key` is `logging.Secret`, which only redacts on the way
 *     OUT of encoding/json. On the wire it is inbound-only: the control plane
 *     sends the raw key as a plain JSON string and the Media Agent reads it
 *     into `Secret` (no custom UnmarshalJSON). The raw value is never
 *     marshaled back out by the Media Agent.
 *
 * Scope: assignment-contract compatibility ONLY. This module introduces no
 * database types, no Supabase coupling, no routes, no lifecycle/enum values,
 * no limits/defaults, and deliberately no Restreamer or Wasabi concepts.
 * Provisioning, node selection, persistence, secret storage, complete-set
 * revocation, and the HTTP endpoint itself all belong to later slices.
 *
 * SECURITY: the `*Wire` and `*Source` types below are secret-bearing and
 * server-internal. They MUST NOT be re-exported through any browser-facing
 * barrel or UI module. The only browser-safe shape here is
 * `BrowserSafeAssignment`, produced exclusively by the redaction adapter.
 */

/**
 * RFC3339 timestamp string, exactly as emitted by Go's `time.Time` JSON
 * marshaling (e.g. `"2026-01-01T00:00:00Z"` or with fractional seconds
 * `"2026-01-01T00:00:00.123456789Z"`). Opaque to the Admin side: preserved
 * byte-for-byte, never reparsed or reformatted by this contract.
 */
export type Rfc3339String = string;

/**
 * Opaque control-plane assignment/config version. Preserved exactly; never
 * parsed, compared numerically, or normalized — the Media Agent treats it as
 * an opaque token (controlplane/client.go, controlplane_sync_state.config_version).
 */
export type ConfigVersion = string;

/**
 * INTERNAL, SECRET-BEARING. One element of the `assignments` array the Media
 * Agent unmarshals from a control-plane assignments response. Field names and
 * value shapes mirror `store.Assignment`'s JSON tags exactly.
 *
 * Not browser-safe: `stream_secret_hash`, `youtube_destination_base_url`, and
 * `youtube_stream_key` are internal/secret and must never reach a client.
 */
export interface MediaAgentAssignmentWire {
  /** Non-secret RTMP stream name / ingest identifier. */
  ingest_id: string;
  /** Non-secret business event id. */
  event_id: string;
  /** Opaque, unguessable public playback id (ADR-020). */
  playback_id: string;
  /**
   * Hex-encoded SHA-256 of the raw publish token — hash only, never the raw
   * token. Internal: not for browser exposure.
   */
  stream_secret_hash: string;
  /** Whether publishing is currently allowed for this assignment. */
  enabled: boolean;
  /** Earliest allowed publish time (RFC3339). */
  publish_window_start_at: Rfc3339String;
  /** Latest allowed publish time (RFC3339). */
  publish_window_end_at: Rfc3339String;
  /** Opaque per-assignment config version. */
  config_version: ConfigVersion;
  /** Last-updated time (RFC3339). */
  updated_at: Rfc3339String;
  /** Whether YouTube forwarding is enabled for this assignment. */
  youtube_enabled: boolean;
  /**
   * YouTube RTMP destination base URL. Empty string when `youtube_enabled` is
   * false (Go emits `""`, not null/absent). Restricted server config — never
   * browser-exposed.
   */
  youtube_destination_base_url: string;
  /**
   * Raw YouTube stream key (secret). Empty string when `youtube_enabled` is
   * false. Inbound-only on the wire. MUST never reach a browser, a log, or a
   * persistent Admin store in this slice.
   */
  youtube_stream_key: string;
}

/**
 * INTERNAL. The assignments-response envelope the Media Agent unmarshals from
 * `GET /internal/media/nodes/{node_id}/assignments`
 * (controlplane/client.go `AssignmentsResponse`). Contains secret-bearing
 * assignments; never browser-safe.
 */
export interface MediaAgentAssignmentsResponseWire {
  /** Opaque config version for the whole response set. */
  config_version: ConfigVersion;
  /** RFC3339 time the control plane generated this response. */
  generated_at: Rfc3339String;
  /**
   * This node's complete current assignment set. Complete-set / revocation
   * semantics are enforced by the Media Agent, not modeled by this contract.
   */
  assignments: MediaAgentAssignmentWire[];
}

/**
 * Admin-internal, camelCase source shape that the pure adapter maps into the
 * snake_case Media Agent wire contract. This is the ONLY input the adapter
 * accepts. Assembling it from a database row, resolving secrets, or selecting
 * a node are explicitly out of scope for this slice.
 *
 * Secret-bearing: carries `streamSecretHash` and `youtubeStreamKey`.
 */
export interface MediaAgentAssignmentSource {
  ingestId: string;
  eventId: string;
  playbackId: string;
  streamSecretHash: string;
  enabled: boolean;
  publishWindowStartAt: Rfc3339String;
  publishWindowEndAt: Rfc3339String;
  configVersion: ConfigVersion;
  updatedAt: Rfc3339String;
  youtubeEnabled: boolean;
  youtubeDestinationBaseUrl: string;
  youtubeStreamKey: string;
}

/**
 * Admin-internal, camelCase source for the response envelope. Secret-bearing
 * via its `assignments`.
 */
export interface MediaAgentAssignmentsResponseSource {
  configVersion: ConfigVersion;
  generatedAt: Rfc3339String;
  assignments: MediaAgentAssignmentSource[];
}

/**
 * BROWSER-SAFE, redacted projection of an assignment. Contains only
 * non-secret, non-internal fields. The secret/internal fields
 * (`stream_secret_hash`, `youtube_destination_base_url`, `youtube_stream_key`)
 * are structurally absent from this type and are never copied into it by the
 * redaction adapter. camelCase, to stay visibly distinct from the internal
 * snake_case wire type.
 */
export interface BrowserSafeAssignment {
  ingestId: string;
  eventId: string;
  playbackId: string;
  enabled: boolean;
  publishWindowStartAt: Rfc3339String;
  publishWindowEndAt: Rfc3339String;
  configVersion: ConfigVersion;
  updatedAt: Rfc3339String;
  youtubeEnabled: boolean;
}

/**
 * The exact, ordered set of JSON keys the Media Agent assignment wire object
 * carries — the single source of truth the adapter and its tests assert
 * against. `satisfies` guards every entry against being a non-existent wire
 * key (catches typos at compile time).
 */
export const MEDIA_AGENT_ASSIGNMENT_WIRE_KEYS = [
  'ingest_id',
  'event_id',
  'playback_id',
  'stream_secret_hash',
  'enabled',
  'publish_window_start_at',
  'publish_window_end_at',
  'config_version',
  'updated_at',
  'youtube_enabled',
  'youtube_destination_base_url',
  'youtube_stream_key',
] as const satisfies readonly (keyof MediaAgentAssignmentWire)[];

/** The exact set of JSON keys the assignments-response envelope carries. */
export const MEDIA_AGENT_ASSIGNMENTS_RESPONSE_KEYS = [
  'config_version',
  'generated_at',
  'assignments',
] as const satisfies readonly (keyof MediaAgentAssignmentsResponseWire)[];

/** The exact set of keys a browser-safe assignment projection carries. */
export const BROWSER_SAFE_ASSIGNMENT_KEYS = [
  'ingestId',
  'eventId',
  'playbackId',
  'enabled',
  'publishWindowStartAt',
  'publishWindowEndAt',
  'configVersion',
  'updatedAt',
  'youtubeEnabled',
] as const satisfies readonly (keyof BrowserSafeAssignment)[];
