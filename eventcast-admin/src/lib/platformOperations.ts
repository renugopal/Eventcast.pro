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

/**
 * Livestream Technical Telemetry + Media Node Health Reporting (migration
 * `0040`) gives resolution/codecs/audio-presence/ingest-bitrate-evidence/
 * captured-segment-bitrate/reconnect-session-info an authoritative source
 * for the FIRST TIME — `NO_TECHNICAL_STREAM_METRICS_REASON` above remains
 * accurate only for a stream this migration's writer has never reported
 * for, or reported for long enough ago that the sample can no longer be
 * trusted as current. A stale or missing row renders identically as
 * unavailable here, never as a frozen last-known-good value.
 */
export const NO_RECENT_STREAM_TELEMETRY_REASON =
  'No technical telemetry has been reported recently for this stream. The Media Agent reports this only ' +
  'while it believes a session is actively publishing.';

/**
 * Frame rate (FPS) specifically is never available, regardless of how
 * fresh the rest of a stream's telemetry is — isolated Step 0 evidence
 * (see the project's read-only telemetry audit) proved the pinned SRS
 * build's technical telemetry source does not expose a frame-rate field,
 * and it is never derived, estimated, or fabricated by any component in
 * this repository.
 */
export const NO_FPS_TELEMETRY_REASON =
  "Frame rate (FPS) is not exposed by this deployment's SRS technical telemetry source and is not " +
  'derived, estimated, or fabricated by any component in this repository.';

/**
 * Audio sample rate is technically present in the underlying SRS sample
 * but is container metadata that isolated Step 0 evidence observed
 * diverging from the real encoder setting - so it is never surfaced as
 * an authoritative fact anywhere, provider or Super Admin.
 */
export const AUDIO_SAMPLE_RATE_NOT_AUTHORITATIVE_REASON =
  'Audio sample rate is SRS-reported container metadata observed to diverge from the actual encoder ' +
  'setting during verification and is not treated as an authoritative fact by this application.';

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

// ── Livestream technical stream telemetry (migration 0040) ───────────────

/**
 * How old a `media_stream_telemetry` row may be before it is treated as
 * stale rather than current. Matches this package's own report cadence
 * (`EnvTelemetryReportInterval`, default 30s) with generous margin for a
 * missed tick or two — a genuinely dead/disconnected stream should read
 * as "no signal" well before a viewer could mistake network jitter for
 * an outage, but not so aggressively that one slow report flips the
 * whole panel to unavailable.
 */
export const STREAM_TELEMETRY_STALE_AFTER_SECONDS = 90;

/**
 * The expected HLS segment duration this deployment's SRS is currently
 * configured with (`hls_fragment 4` — see
 * `livestream-infra/infra/media-node/srs/srs.conf` and
 * `02_V1_ARCHITECTURE_SPEC.md`'s matching baseline config block). This
 * mirrors that tracked configuration value and must be updated here if
 * that authoritative configuration ever changes — it is not derived or
 * read from it automatically.
 */
const SRS_EXPECTED_SEGMENT_DURATION_SECONDS = 4;

/**
 * `02_V1_ARCHITECTURE_SPEC.md` ("Observability requirements"): "a live
 * stream has no new local segment for three expected segment durations"
 * is the documented warning condition — reused verbatim as the
 * Provider-facing source-health threshold rather than inventing a new
 * number.
 */
const SOURCE_HEALTH_STALE_SEGMENT_MULTIPLIER = 3;
const SOURCE_HEALTH_STALE_SEGMENT_SECONDS =
  SRS_EXPECTED_SEGMENT_DURATION_SECONDS * SOURCE_HEALTH_STALE_SEGMENT_MULTIPLIER; // 12s

export interface MediaStreamTelemetryRow {
  event_id: string;
  reporting_media_node_id: string;
  sampled_at: string;
  connected: boolean;
  srs_publish_active: boolean | null;
  video_width: number | null;
  video_height: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  audio_present: boolean | null;
  ingest_kbps_recv_30s: number | null;
  recv_bytes: number | null;
  captured_segment_bitrate_kbps: number | null;
  publish_duration_seconds: number | null;
  session_count: number | null;
  reconnect_count: number | null;
  segment_freshness_seconds: number | null;
  updated_at: string;
}

/**
 * The PROVIDER-facing projection (Live Control Room). Deliberately
 * excludes every infrastructure-sensitive fact: no node id, hostname,
 * region, disk/queue state, software/config version, or raw error text
 * — a normal provider has no legitimate use for any of it and must never
 * receive it (see the project's telemetry design decisions).
 *
 * `available: false` (via `sourceHealth`) covers BOTH a missing row and a
 * stale one identically — a provider must never see a frozen old sample
 * presented as current. `fps` is always explicitly unavailable with its
 * own fixed reason, regardless of freshness, because it never has a
 * source at all.
 */
export interface ProviderStreamTechnicalView {
  sourceHealth: 'good' | 'no_signal';
  connected: boolean | UnavailableFact;
  videoWidth: number | UnavailableFact;
  videoHeight: number | UnavailableFact;
  videoCodec: string | UnavailableFact;
  audioCodec: string | UnavailableFact;
  audioPresent: boolean | UnavailableFact;
  fps: UnavailableFact;
  ingestKbpsRecv30s: number | UnavailableFact;
  capturedSegmentBitrateKbps: number | UnavailableFact;
  publishDurationSeconds: number | UnavailableFact;
  reconnectCount: number | UnavailableFact;
  relayStateWord: 'youtube_enabled' | 'youtube_disabled';
  sampledAt: string | null;
}

function isStreamTelemetryFresh(row: MediaStreamTelemetryRow | null, now: Date): boolean {
  if (!row) return false;
  const ageSeconds = (now.getTime() - new Date(row.sampled_at).getTime()) / 1000;
  return ageSeconds >= 0 && ageSeconds <= STREAM_TELEMETRY_STALE_AFTER_SECONDS;
}

/**
 * Derives the source-health verdict from every authoritative signal this
 * package actually has — never from `connected` alone. Shared by both the
 * Provider and Super Admin projections below so the same health rule is
 * never duplicated with a weaker interpretation in either place. Each
 * optional signal (`srs_publish_active`, `segment_freshness_seconds`) is
 * skipped, not fabricated, when unavailable: an unmeasured signal proves
 * nothing either way, so it must never push the result toward "good" or
 * "no_signal" by itself.
 */
export function deriveStreamSourceHealth(row: MediaStreamTelemetryRow | null, fresh: boolean): 'good' | 'no_signal' {
  if (!fresh || !row) return 'no_signal';
  if (row.connected === false) return 'no_signal';
  if (row.srs_publish_active === false) return 'no_signal';
  if (row.segment_freshness_seconds !== null && row.segment_freshness_seconds >= SOURCE_HEALTH_STALE_SEGMENT_SECONDS) {
    return 'no_signal';
  }
  return 'good';
}

export function toProviderStreamTechnicalView(
  row: MediaStreamTelemetryRow | null,
  youtubeEnabled: boolean,
  now: Date = new Date()
): ProviderStreamTechnicalView {
  const fresh = isStreamTelemetryFresh(row, now);
  const fps = unavailable(NO_FPS_TELEMETRY_REASON);
  const relayStateWord = youtubeEnabled ? 'youtube_enabled' : 'youtube_disabled';
  const sourceHealth = deriveStreamSourceHealth(row, fresh);

  if (!fresh || !row) {
    const na = unavailable(NO_RECENT_STREAM_TELEMETRY_REASON);
    return {
      sourceHealth,
      connected: na,
      videoWidth: na,
      videoHeight: na,
      videoCodec: na,
      audioCodec: na,
      audioPresent: na,
      fps,
      ingestKbpsRecv30s: na,
      capturedSegmentBitrateKbps: na,
      publishDurationSeconds: na,
      reconnectCount: na,
      relayStateWord,
      sampledAt: null,
    };
  }

  const na = unavailable(NO_RECENT_STREAM_TELEMETRY_REASON);
  return {
    sourceHealth,
    connected: row.connected,
    videoWidth: row.video_width ?? na,
    videoHeight: row.video_height ?? na,
    videoCodec: row.video_codec ?? na,
    audioCodec: row.audio_codec ?? na,
    audioPresent: row.audio_present ?? na,
    fps,
    ingestKbpsRecv30s: row.ingest_kbps_recv_30s ?? na,
    capturedSegmentBitrateKbps: row.captured_segment_bitrate_kbps ?? na,
    publishDurationSeconds: row.publish_duration_seconds ?? na,
    reconnectCount: row.reconnect_count ?? na,
    relayStateWord,
    sampledAt: row.sampled_at,
  };
}

/**
 * The SUPER ADMIN-facing projection. Richer than the provider view —
 * includes node identity and the same infrastructure-adjacent facts the
 * rest of the Platform Operations console already exposes to this role
 * — but still an explicit allowlist, never a raw row spread, and never a
 * secret/credential of any kind. `audioSampleRate` is intentionally NOT
 * included here or anywhere: see `AUDIO_SAMPLE_RATE_NOT_AUTHORITATIVE_REASON`.
 */
export interface PlatformStreamTechnicalView {
  available: boolean;
  reason: string | null;
  sourceHealth: 'good' | 'no_signal';
  reportingMediaNodeId: string | null;
  sampledAt: string | null;
  ageSeconds: number | null;
  connected: boolean | null;
  srsPublishActive: boolean | null;
  videoWidth: number | null;
  videoHeight: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioPresent: boolean | null;
  fps: UnavailableFact;
  ingestKbpsRecv30s: number | null;
  recvBytes: number | null;
  capturedSegmentBitrateKbps: number | null;
  publishDurationSeconds: number | null;
  sessionCount: number | null;
  reconnectCount: number | null;
  segmentFreshnessSeconds: number | null;
}

export function toPlatformStreamTechnicalView(
  row: MediaStreamTelemetryRow | null,
  now: Date = new Date()
): PlatformStreamTechnicalView {
  const fps = unavailable(NO_FPS_TELEMETRY_REASON);

  if (!row) {
    return {
      available: false,
      reason: NO_RECENT_STREAM_TELEMETRY_REASON,
      sourceHealth: deriveStreamSourceHealth(null, false),
      reportingMediaNodeId: null,
      sampledAt: null,
      ageSeconds: null,
      connected: null,
      srsPublishActive: null,
      videoWidth: null,
      videoHeight: null,
      videoCodec: null,
      audioCodec: null,
      audioPresent: null,
      fps,
      ingestKbpsRecv30s: null,
      recvBytes: null,
      capturedSegmentBitrateKbps: null,
      publishDurationSeconds: null,
      sessionCount: null,
      reconnectCount: null,
      segmentFreshnessSeconds: null,
    };
  }

  const ageSeconds = (now.getTime() - new Date(row.sampled_at).getTime()) / 1000;
  const fresh = ageSeconds >= 0 && ageSeconds <= STREAM_TELEMETRY_STALE_AFTER_SECONDS;

  return {
    available: fresh,
    reason: fresh ? null : NO_RECENT_STREAM_TELEMETRY_REASON,
    sourceHealth: deriveStreamSourceHealth(row, fresh),
    reportingMediaNodeId: row.reporting_media_node_id,
    sampledAt: row.sampled_at,
    ageSeconds,
    connected: fresh ? row.connected : null,
    srsPublishActive: fresh ? row.srs_publish_active : null,
    videoWidth: fresh ? row.video_width : null,
    videoHeight: fresh ? row.video_height : null,
    videoCodec: fresh ? row.video_codec : null,
    audioCodec: fresh ? row.audio_codec : null,
    audioPresent: fresh ? row.audio_present : null,
    fps,
    ingestKbpsRecv30s: fresh ? row.ingest_kbps_recv_30s : null,
    recvBytes: fresh ? row.recv_bytes : null,
    capturedSegmentBitrateKbps: fresh ? row.captured_segment_bitrate_kbps : null,
    publishDurationSeconds: fresh ? row.publish_duration_seconds : null,
    sessionCount: fresh ? row.session_count : null,
    reconnectCount: fresh ? row.reconnect_count : null,
    segmentFreshnessSeconds: fresh ? row.segment_freshness_seconds : null,
  };
}
