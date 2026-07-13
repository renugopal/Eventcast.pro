/**
 * Pure, deterministic adapters between the Admin-internal camelCase source
 * shape and the Media Agent's snake_case assignment wire contract, plus a
 * browser-safe redaction projection.
 *
 * Hard constraints (this whole module):
 *   - Pure functions only: no database calls, no network calls, no env reads,
 *     no secret resolution, no logging, no authorization, no provisioning, no
 *     I/O of any kind.
 *   - No mutation of inputs; every function returns a freshly constructed
 *     object (and a fresh array for the envelope).
 *   - No invented fields, values, defaults, or normalization. Values are
 *     copied through exactly as provided — the Media Agent treats config
 *     versions and timestamps as opaque, and so does this adapter.
 *
 * Out of scope (later slices): complete-set revocation, assignment
 * persistence, node selection, secret storage/retrieval, and the HTTP route.
 */

import type {
  BrowserSafeAssignment,
  MediaAgentAssignmentSource,
  MediaAgentAssignmentWire,
  MediaAgentAssignmentsResponseSource,
  MediaAgentAssignmentsResponseWire,
} from './contracts';

/**
 * Maps one Admin-internal source assignment to the exact Media Agent wire
 * object. The returned object literal is an explicit allowlist: every
 * snake_case wire key is set from its camelCase counterpart, and no other key
 * is ever produced.
 */
export function toMediaAgentAssignmentWire(
  source: MediaAgentAssignmentSource,
): MediaAgentAssignmentWire {
  return {
    ingest_id: source.ingestId,
    event_id: source.eventId,
    playback_id: source.playbackId,
    stream_secret_hash: source.streamSecretHash,
    enabled: source.enabled,
    publish_window_start_at: source.publishWindowStartAt,
    publish_window_end_at: source.publishWindowEndAt,
    config_version: source.configVersion,
    updated_at: source.updatedAt,
    youtube_enabled: source.youtubeEnabled,
    youtube_destination_base_url: source.youtubeDestinationBaseUrl,
    youtube_stream_key: source.youtubeStreamKey,
  };
}

/**
 * Maps an Admin-internal source envelope to the exact Media Agent
 * assignments-response wire envelope. `assignments` is mapped into a new
 * array; the input is never mutated.
 */
export function toMediaAgentAssignmentsResponseWire(
  source: MediaAgentAssignmentsResponseSource,
): MediaAgentAssignmentsResponseWire {
  return {
    config_version: source.configVersion,
    generated_at: source.generatedAt,
    assignments: source.assignments.map(toMediaAgentAssignmentWire),
  };
}

/**
 * Redacts an assignment to a browser-safe projection. Built by explicit
 * allowlist construction (not by deleting keys off a copy), so the secret and
 * internal fields — `streamSecretHash`/`stream_secret_hash`,
 * `youtubeStreamKey`/`youtube_stream_key`, and
 * `youtubeDestinationBaseUrl`/`youtube_destination_base_url` — are structurally
 * incapable of appearing in the output.
 */
export function toBrowserSafeAssignment(
  source: MediaAgentAssignmentSource,
): BrowserSafeAssignment {
  return {
    ingestId: source.ingestId,
    eventId: source.eventId,
    playbackId: source.playbackId,
    enabled: source.enabled,
    publishWindowStartAt: source.publishWindowStartAt,
    publishWindowEndAt: source.publishWindowEndAt,
    configVersion: source.configVersion,
    updatedAt: source.updatedAt,
    youtubeEnabled: source.youtubeEnabled,
  };
}
