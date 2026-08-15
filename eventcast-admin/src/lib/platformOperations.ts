import type { EventRecordingRow } from './eventRecording';
import { isR2CleanupEligible } from './r2CleanupEligibility';

/**
 * Shared, mostly-pure derivation/projection helpers for the Super Admin
 * Operations Console (Milestone M).
 *
 * Every function here is deliberately free of database and environment
 * access so it stays trivially testable, and so the routes that use it keep
 * one obvious place where "what may a Super Admin see" is decided. The
 * authorization boundary itself is never here — that is always
 * `requireSuperAdmin()` at the top of each route.
 *
 * Two rules govern everything below:
 *
 *  1. **No fabricated telemetry.** Where this repository has no
 *     authoritative source for a fact (resolution/FPS/bitrate/codecs,
 *     reconnect counts, real live-ingest state, node CPU/memory/network,
 *     OAuth YouTube state, outbound WhatsApp/SMS/email delivery, per-object
 *     R2/B2 byte accounting), the projection reports an explicit
 *     unavailable/unmeasured marker with the reason — never a synthesized
 *     number and never a silent zero.
 *
 *  2. **No parallel authority.** Recording/retention/eligibility semantics
 *     are consumed from the mechanisms that already own them
 *     (`event_recordings` + its RPCs, `isR2CleanupEligible()`), never
 *     re-derived here.
 */

// ── Honest "no authoritative source" markers ─────────────────────────────

export interface UnavailableFact {
  available: false;
  reason: string;
}

export function unavailable(reason: string): UnavailableFact {
  return { available: false, reason };
}

/**
 * The single reason string used everywhere a caller might otherwise be
 * tempted to present enabled-assignment state as real live/ingest state.
 * Matches the posture already established by `GET /api/platform/streams`.
 */
export const NO_LIVE_TELEMETRY_REASON =
  'No authoritative live-session/ingest telemetry source exists in this repository. ' +
  'An enabled assignment proves the assignment is enabled, not that it is currently ingesting.';

/**
 * Technical stream metrics (Baseline §12) have no authoritative source: the
 * SRS/Media Agent control plane exposes assignment state, not per-stream
 * media characteristics, and nothing persists them.
 */
export const NO_TECHNICAL_STREAM_METRICS_REASON =
  'Resolution, FPS, bitrate, codecs, and reconnect counts are not collected or persisted by any ' +
  'component in this repository. They are not inferred from assignment state.';

/**
 * `media_nodes` persists heartbeat, disk-free, R2 queue depth, capacity and
 * version columns — but no CPU/memory/network samples (migration `0020`).
 */
export const NO_NODE_RESOURCE_TELEMETRY_REASON =
  'media_nodes persists heartbeat, capacity, disk-free and R2-queue columns only. CPU, memory, and ' +
  'network utilisation are not collected by any component in this repository.';

/**
 * V1 YouTube fallback is manual Super Admin attestation (migration `0037`).
 * No OAuth connection, channel state, or API-derived status exists.
 */
export const NO_YOUTUBE_OAUTH_STATE_REASON =
  'V1 YouTube fallback verification is manual Super Admin attestation only. No OAuth-connected channel, ' +
  'broadcast state, or YouTube API-derived status exists in this repository.';

/**
 * Migration `0034` stores in-app notifications only. No outbound provider is
 * integrated, so no delivery state may be claimed for any channel.
 */
export const NO_OUTBOUND_DELIVERY_REASON =
  'The Notification Center records in-app notifications only. No WhatsApp, SMS, or application-email ' +
  'provider is integrated, so no outbound delivery state exists to report.';

// ── Media node operational projection ────────────────────────────────────

export interface MediaNodeRow {
  id: string;
  name: string;
  region: string;
  ingest_hostname: string;
  status: string;
  maintenance_mode: boolean;
  hard_stream_limit: number;
  active_stream_count: number;
  disk_free_bytes: number | null;
  r2_queue_bytes: number | null;
  last_heartbeat_at: string | null;
  software_version: string | null;
  config_version: string | null;
  updated_at: string | null;
}

export interface PlatformMediaNodeView {
  id: string;
  name: string;
  region: string;
  /** Operational routing identity, not a credential — no node token, pepper, or secret is ever projected. */
  ingestHostname: string;
  status: string;
  maintenanceMode: boolean;
  hardStreamLimit: number;
  activeStreamCount: number;
  capacityRemaining: number;
  diskFreeBytes: number | null;
  r2QueueBytes: number | null;
  lastHeartbeatAt: string | null;
  /** Minutes since the last heartbeat, or null when the node has never reported. */
  heartbeatAgeMinutes: number | null;
  softwareVersion: string | null;
  configVersion: string | null;
  resourceTelemetry: UnavailableFact;
}

export function toPlatformMediaNodeView(row: MediaNodeRow, now: Date = new Date()): PlatformMediaNodeView {
  const lastHeartbeatAt = row.last_heartbeat_at;
  const heartbeatAgeMinutes =
    lastHeartbeatAt === null
      ? null
      : Math.max(0, Math.floor((now.getTime() - new Date(lastHeartbeatAt).getTime()) / 60000));

  return {
    id: row.id,
    name: row.name,
    region: row.region,
    ingestHostname: row.ingest_hostname,
    status: row.status,
    maintenanceMode: row.maintenance_mode,
    hardStreamLimit: row.hard_stream_limit,
    activeStreamCount: row.active_stream_count,
    capacityRemaining: Math.max(0, row.hard_stream_limit - row.active_stream_count),
    diskFreeBytes: row.disk_free_bytes,
    r2QueueBytes: row.r2_queue_bytes,
    lastHeartbeatAt,
    heartbeatAgeMinutes,
    softwareVersion: row.software_version,
    configVersion: row.config_version,
    resourceTelemetry: unavailable(NO_NODE_RESOURCE_TELEMETRY_REASON),
  };
}

// ── Recording / media operations projection ──────────────────────────────

export interface PlatformRecordingView {
  recordingState: EventRecordingRow['recording_state'];
  localFinalizedAt: string | null;
  /**
   * Non-secret storage identity (migration `0035` states this explicitly).
   * Never a credential, endpoint, signed URL, or authorization header.
   */
  b2Bucket: string | null;
  b2ObjectKey: string | null;
  b2FinalizedAt: string | null;
  integrityVerifiedAt: string | null;
  finalizationGeneration: string | null;
  gapCount: number;
  gapStatus: EventRecordingRow['gap_status'];
  finalizationFailureReason: string | null;
  youtubeFallbackUrl: string | null;
  youtubeFallbackVerified: boolean;
  youtubeChannelState: UnavailableFact;
  retentionEffectiveDays: number | null;
  retentionFrozenAt: string | null;
  retentionExpiresAt: string | null;
  retentionExpired: boolean | null;
  updatedAt: string;
}

/**
 * The Super-Admin-facing recording projection. Deliberately richer than
 * `toProviderSafeRecordingView()` (a Super Admin legitimately needs archive
 * and integrity evidence to operate storage), but still an explicit
 * allowlist rather than a raw row spread, so a future column cannot leak by
 * default.
 */
export function toPlatformRecordingView(
  recording: EventRecordingRow,
  now: Date = new Date()
): PlatformRecordingView {
  return {
    recordingState: recording.recording_state,
    localFinalizedAt: recording.local_finalized_at,
    b2Bucket: recording.b2_bucket,
    b2ObjectKey: recording.b2_object_key,
    b2FinalizedAt: recording.b2_finalized_at,
    integrityVerifiedAt: recording.integrity_verified_at,
    finalizationGeneration: recording.finalization_generation,
    gapCount: recording.gap_count,
    gapStatus: recording.gap_status,
    finalizationFailureReason: recording.finalization_failure_reason,
    youtubeFallbackUrl: recording.youtube_fallback_url,
    youtubeFallbackVerified: recording.youtube_fallback_verified,
    youtubeChannelState: unavailable(NO_YOUTUBE_OAUTH_STATE_REASON),
    retentionEffectiveDays: recording.retention_effective_days,
    retentionFrozenAt: recording.retention_frozen_at,
    retentionExpiresAt: recording.retention_expires_at,
    retentionExpired:
      recording.retention_expires_at === null
        ? null
        : new Date(recording.retention_expires_at).getTime() <= now.getTime(),
    updatedAt: recording.updated_at,
  };
}

// ── R2 cleanup: eligibility report + non-destructive dry run ─────────────

export interface AssignmentActivationRow {
  playback_id: string;
  media_node_id: string;
  activated_at?: string | null;
}

/**
 * Why an actual R2 deletion cannot be performed from this application today.
 *
 * These are statements of fact about the current repository, not policy
 * preferences, and each one independently blocks execution. They are
 * surfaced to the Super Admin verbatim so the console never implies a
 * capability it does not have.
 */
export const R2_CLEANUP_EXECUTION_BLOCKERS: readonly string[] = [
  'No post-B2 grace duration is defined anywhere in this repository. isR2CleanupEligible() answers ' +
    '"is the B2 archive authoritative and durable", and explicitly leaves the operational timing of ' +
    'R2 removal as a separate, still-undecided question.',
  'This application holds no credential or endpoint for the media R2 bucket (eventcast-livestream-media). ' +
    'The R2_* environment variables address the separate images/guest-photo bucket, and the media bucket ' +
    'is reachable only through the render Worker\'s MEDIA_R2 binding.',
  'The deletion scope is undefined: whether cleanup removes the whole events/{playbackId}/ prefix, or only ' +
    'the media/ segments while retaining live/index.m3u8 and vod/index.m3u8, is not decided by the Baseline ' +
    'or by any code in this repository.',
  'The Media Agent applies its own EVENTCAST_R2_OBJECT_PREFIX to every key it writes. That prefix is node-side ' +
    'configuration this application cannot read, so a fully-qualified object key cannot be constructed here.',
];

export interface R2CleanupPlan {
  eventId: string;
  /** Verbatim result of the existing authority `isR2CleanupEligible()`. Never recomputed here. */
  eligible: boolean;
  /** Human-readable diagnostics only. Never the eligibility decision itself. */
  ineligibilityReasons: string[];
  /**
   * The R2 prefixes an eventual cleanup would target, derived from the
   * event's own append-only activation history (migration `0036`). Empty
   * whenever the event is not eligible or its activation history is
   * unusable — the plan fails closed exactly like the predicate does.
   */
  candidateR2Prefixes: string[];
  /** Always false in this build. A dry run never deletes and never schedules. */
  executionAvailable: false;
  executionBlockers: readonly string[];
  /**
   * Restated on every plan: R2 cleanup only ever targets the live/DVR copy.
   * The authoritative B2 archive is never a cleanup target.
   */
  b2ObjectsExcluded: true;
}

function collectIneligibilityReasons(recording: EventRecordingRow | null | undefined): string[] {
  if (!recording) return ['No event_recordings row exists for this event.'];

  const reasons: string[] = [];
  if (recording.recording_state !== 'b2_finalized') {
    reasons.push(`recording_state is "${recording.recording_state}", not "b2_finalized".`);
  }
  if (!recording.b2_object_key || !recording.b2_bucket) {
    reasons.push('B2 storage identity (bucket and object key) is incomplete.');
  }
  if (recording.b2_finalized_at === null) {
    reasons.push('b2_finalized_at is absent — authoritative B2 finalization has not been recorded.');
  }
  if (recording.integrity_verified_at === null) {
    reasons.push('integrity_verified_at is absent — completeness/integrity has not been verified.');
  }
  if (typeof recording.retention_effective_days !== 'number' || recording.retention_effective_days <= 0) {
    reasons.push('retention_effective_days is not a positive persisted value.');
  }
  if (recording.retention_frozen_at === null || recording.retention_expires_at === null) {
    reasons.push('Retention is not frozen — the promised replay window is not durably persisted.');
  }
  return reasons;
}

/**
 * Builds a non-destructive R2 cleanup plan for one event.
 *
 * `isR2CleanupEligible()` remains the sole eligibility authority — this
 * function calls it and never re-implements or relaxes it. When it returns
 * false, the plan carries no candidate prefix at all, so there is nothing a
 * future executor could act on even by mistake.
 */
export function buildR2CleanupPlan(
  eventId: string,
  recording: EventRecordingRow | null | undefined,
  activations: AssignmentActivationRow[]
): R2CleanupPlan {
  const eligible = isR2CleanupEligible(recording);
  const ineligibilityReasons = eligible ? [] : collectIneligibilityReasons(recording);

  if (!eligible && ineligibilityReasons.length === 0) {
    ineligibilityReasons.push('isR2CleanupEligible() returned false.');
  }

  const playbackIds = Array.from(
    new Set(
      (activations ?? [])
        .map((row) => (typeof row?.playback_id === 'string' ? row.playback_id.trim() : ''))
        .filter((value) => value.length > 0)
    )
  ).sort();

  let candidateR2Prefixes: string[] = [];
  if (eligible) {
    if (playbackIds.length === 0) {
      // Fail closed: an eligible archive with no trusted activation history
      // gives no provable set of R2 objects to target.
      ineligibilityReasons.push(
        'No activation history with a usable playback id exists, so no R2 prefix can be proven to belong to this event.'
      );
    } else {
      candidateR2Prefixes = playbackIds.map((playbackId) => `events/${playbackId}/`);
    }
  }

  return {
    eventId,
    eligible,
    ineligibilityReasons,
    candidateR2Prefixes,
    executionAvailable: false,
    executionBlockers: R2_CLEANUP_EXECUTION_BLOCKERS,
    b2ObjectsExcluded: true,
  };
}

// ── Storage visibility (DASH-003 / PLAN-006: Super Admin only) ───────────

export interface StorageVisibilityInput {
  guestPhotoCount: number;
  /** Sum of `guest_photos.file_size_bytes`; rows with a null size are counted separately. */
  guestPhotoBytes: number;
  guestPhotoRowsWithoutSize: number;
  recordingsWithB2Archive: number;
  recordingsRetentionFrozen: number;
  recordingsRetentionExpired: number;
  r2CleanupEligibleCount: number;
  nodeDiskFreeBytes: number | null;
  nodeR2QueueBytes: number | null;
}

export interface StorageVisibilityView extends StorageVisibilityInput {
  r2MediaObjectBytes: UnavailableFact;
  b2ArchiveObjectBytes: UnavailableFact;
}

export const NO_OBJECT_BYTE_ACCOUNTING_REASON =
  'No per-object byte accounting exists for the media R2 bucket or the B2 archive. Neither event_recordings ' +
  'nor any other table stores object sizes, and this application cannot enumerate either bucket.';

export function toStorageVisibilityView(input: StorageVisibilityInput): StorageVisibilityView {
  return {
    ...input,
    r2MediaObjectBytes: unavailable(NO_OBJECT_BYTE_ACCOUNTING_REASON),
    b2ArchiveObjectBytes: unavailable(NO_OBJECT_BYTE_ACCOUNTING_REASON),
  };
}

// ── Template operations (read-only registry facts) ───────────────────────

export interface PlatformTemplateView {
  templateId: string;
  templateVersion: string | null;
  eventTypes: readonly string[];
  registered: boolean;
  /** How many events currently reference this `template_id`. Real count, never an estimate. */
  eventCount: number;
}

/**
 * Reconciles the canonical template registry against the `template_id`
 * values events actually reference. Unregistered ids in use are reported as
 * `registered: false` rather than being hidden or silently mapped onto a
 * fallback template — CRT-003 prohibits silent template fallback, and the
 * operational surface must show the real state.
 *
 * Read-only by construction: no deployment, editing, publishing, or remote
 * template mutation path exists in this repository, and none is invented.
 */
export function reconcileTemplateUsage(
  registry: Record<string, { templateId: string; templateVersion: string; eventTypes: readonly string[] }>,
  templateIdsInUse: (string | null | undefined)[]
): PlatformTemplateView[] {
  const usage = new Map<string, number>();
  for (const rawId of templateIdsInUse) {
    const templateId = typeof rawId === 'string' ? rawId.trim() : '';
    if (templateId.length === 0) continue;
    usage.set(templateId, (usage.get(templateId) ?? 0) + 1);
  }

  const views: PlatformTemplateView[] = Object.values(registry).map((descriptor) => ({
    templateId: descriptor.templateId,
    templateVersion: descriptor.templateVersion,
    eventTypes: descriptor.eventTypes,
    registered: true,
    eventCount: usage.get(descriptor.templateId) ?? 0,
  }));

  for (const [templateId, eventCount] of usage) {
    if (registry[templateId]) continue;
    views.push({
      templateId,
      templateVersion: null,
      eventTypes: [],
      registered: false,
      eventCount,
    });
  }

  return views.sort((a, b) => a.templateId.localeCompare(b.templateId));
}
