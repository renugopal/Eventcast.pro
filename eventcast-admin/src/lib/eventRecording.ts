import { supabase, supabaseAdmin } from './supabase';
import { getOwnedEventById, isOwnershipError } from './ownership';
import { loadB2ConfigFromEnv } from './b2Client';

const db = supabaseAdmin || supabase;

export type RecordingState =
  | 'not_started'
  | 'recording'
  | 'local_finalized'
  | 'b2_finalizing'
  | 'b2_finalized'
  | 'failed';

export interface EventRecordingRow {
  id: string;
  event_id: string;
  recording_state: RecordingState;
  local_finalized_at: string | null;
  b2_object_key: string | null;
  b2_bucket: string | null;
  b2_finalized_at: string | null;
  integrity_verified_at: string | null;
  finalization_failure_reason: string | null;
  /**
   * The finalization generation the stored B2 evidence describes
   * (migration `0036`). A deterministic fingerprint of the finalized
   * segment set, so a superseded archive can never be mistaken for the
   * current one.
   */
  finalization_generation: string | null;
  /** Mirrors the Media Agent's own authoritative `vod_finalizations` gap semantics. */
  gap_count: number;
  gap_status: 'none' | 'pending_review' | 'acknowledged' | 'rejected';
  youtube_fallback_url: string | null;
  youtube_fallback_verified: boolean;
  retention_effective_days: number | null;
  retention_frozen_at: string | null;
  retention_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Pure: adds `days` days to `frozenAt`. Used only for local computation/tests — the database RPC computes the persisted value itself. */
export function computeRetentionExpiry(frozenAt: Date, days: number): Date {
  const result = new Date(frozenAt.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Pure: the deterministic freeze timestamp is whichever of the two required
 * evidence timestamps completed last — never the wall-clock time a caller
 * happens to run this at. Mirrors the database's own
 * `GREATEST(b2_finalized_at, integrity_verified_at)` in `freeze_event_retention()`.
 */
export function computeRetentionFreezeTimestamp(
  b2FinalizedAt: Date | null,
  integrityVerifiedAt: Date | null
): Date | null {
  if (!b2FinalizedAt || !integrityVerifiedAt) return null;
  return b2FinalizedAt.getTime() >= integrityVerifiedAt.getTime() ? b2FinalizedAt : integrityVerifiedAt;
}

/** Loads the raw recording row for an event. Server-side/system use only — never returned directly to a client. */
export async function getEventRecordingState(eventId: string): Promise<EventRecordingRow | null> {
  const { data, error } = await db
    .from('event_recordings')
    .select('*')
    .eq('event_id', eventId)
    .maybeSingle();

  if (error || !data) return null;
  return data as EventRecordingRow;
}

export type FreezeEventRetentionResult =
  | { status: 'ok'; recording: EventRecordingRow }
  | { status: 'not_eligible'; message: string }
  | { status: 'not_found' };

/**
 * Calls the database's `freeze_event_retention()` RPC — the only write path
 * for freezing retention. The RPC itself (not this wrapper) enforces that
 * both `b2_finalized_at` and `integrity_verified_at` are present, resolves
 * effective days from the studio override or global default, and computes
 * `retention_frozen_at` as `GREATEST(b2_finalized_at, integrity_verified_at)`.
 * Write-once: an already-frozen event returns its existing frozen row
 * unchanged.
 */
export async function freezeEventRetention(eventId: string): Promise<FreezeEventRetentionResult> {
  const { data, error } = await db.rpc('freeze_event_retention', { p_event_id: eventId });

  if (error) {
    if (error.message?.includes('not found')) {
      return { status: 'not_found' };
    }
    return { status: 'not_eligible', message: error.message };
  }

  return { status: 'ok', recording: data as EventRecordingRow };
}

export interface ApplyRecordingTransitionInput {
  eventId: string;
  targetState: RecordingState;
  finalizationGeneration?: string;
  localFinalizedAt?: string;
  b2ObjectKey?: string;
  b2Bucket?: string;
  gapCount?: number;
  gapStatus?: EventRecordingRow['gap_status'];
  strongIntegrityVerified?: boolean;
  failureReason?: string;
  /** Always the AUTHENTICATED node id, resolved server-side — never a request-body value. */
  reportingMediaNodeId?: string;
  coveredPlaybackIds?: string[];
}

export type ApplyRecordingTransitionResult =
  | { status: 'ok'; recording: EventRecordingRow }
  | { status: 'rejected'; message: string };

/**
 * Calls the database's `apply_event_recording_transition()` RPC — the only
 * write path into `event_recordings`. `service_role` holds SELECT only on
 * that table by design (migration `0035`), so every mutation goes through
 * this guarded `SECURITY DEFINER` state machine.
 *
 * The RPC (not this wrapper) owns the rules: allowed transitions, explicit
 * gap evidence, single-node activation provenance, server-assigned
 * authoritative timestamps, and refusal to touch frozen retention.
 * Idempotent, so a retried report after a lost response is safe.
 */
export async function applyEventRecordingTransition(
  input: ApplyRecordingTransitionInput
): Promise<ApplyRecordingTransitionResult> {
  const { data, error } = await db.rpc('apply_event_recording_transition', {
    p_event_id: input.eventId,
    p_target_state: input.targetState,
    p_finalization_generation: input.finalizationGeneration ?? null,
    p_local_finalized_at: input.localFinalizedAt ?? null,
    p_b2_object_key: input.b2ObjectKey ?? null,
    p_b2_bucket: input.b2Bucket ?? null,
    p_gap_count: input.gapCount ?? null,
    p_gap_status: input.gapStatus ?? null,
    p_strong_integrity_verified: input.strongIntegrityVerified === true,
    p_failure_reason: input.failureReason ?? null,
    p_reporting_media_node_id: input.reportingMediaNodeId ?? null,
    p_covered_playback_ids: input.coveredPlaybackIds ?? null,
  });

  if (error) {
    return { status: 'rejected', message: error.message };
  }
  return { status: 'ok', recording: data as EventRecordingRow };
}

export type ExtendEventRetentionResult =
  | { status: 'ok'; recording: EventRecordingRow }
  | { status: 'rejected'; message: string };

/**
 * Calls the database's `apply_event_retention_extension()` RPC — extends an
 * already-frozen event's retention. Atomic with the history row and the
 * platform audit-log row inside the same database transaction; the route
 * calling this must already be `requireSuperAdmin`-gated.
 */
export async function extendEventRetention(
  eventId: string,
  newExpiresAt: Date,
  reason: string,
  extendedByUserId: string
): Promise<ExtendEventRetentionResult> {
  const { data, error } = await db.rpc('apply_event_retention_extension', {
    p_event_id: eventId,
    p_new_expires_at: newExpiresAt.toISOString(),
    p_reason: reason,
    p_actor: extendedByUserId,
  });

  if (error) {
    return { status: 'rejected', message: error.message };
  }

  return { status: 'ok', recording: data as EventRecordingRow };
}

export type VerifyYoutubeFallbackResult =
  | { status: 'ok'; recording: EventRecordingRow }
  | { status: 'rejected'; message: string };

/**
 * Calls the database's `apply_youtube_fallback_verification()` RPC
 * (migration `0037`, local design only — not yet applied) — the sole write
 * path that may ever set `youtube_fallback_verified = true`. Manual Super
 * Admin attestation only (STO-005/YTB-008); this wrapper, like the RPC
 * itself, never calls or simulates the YouTube API. The RPC re-verifies the
 * caller is `super_admin` and requires `youtubeUrl` to equal the event's
 * current provider-supplied `events.youtube_url` at the moment of
 * verification, so a stale or cross-event attestation is rejected rather
 * than silently accepted. The route calling this must already be
 * `requireSuperAdmin`-gated.
 */
export async function verifyYoutubeFallback(
  eventId: string,
  youtubeUrl: string,
  actorUserId: string
): Promise<VerifyYoutubeFallbackResult> {
  const { data, error } = await db.rpc('apply_youtube_fallback_verification', {
    p_event_id: eventId,
    p_youtube_url: youtubeUrl,
    p_actor: actorUserId,
  });

  if (error) {
    return { status: 'rejected', message: error.message };
  }
  return { status: 'ok', recording: data as EventRecordingRow };
}

export interface ProviderSafeRecordingView {
  replayStatus: 'not_available' | 'processing' | 'available' | 'failed';
  retentionExpiresAt: string | null;
  youtubeFallbackAvailable: boolean;
}

/**
 * Sanitized projection for the provider-facing recording route. Never
 * returns `b2_object_key`, `b2_bucket`, `integrity_verified_at`,
 * `local_finalized_at`, `finalization_failure_reason`, or any other
 * infrastructure/storage-internal field — none of those are secrets, but
 * they are never returned to a normal provider anyway.
 *
 * `b2PlaybackConfigured` is supplied by the caller (never read from
 * `process.env` here, so this function stays pure/trivially testable) — it
 * is the same "is a real B2 read credential pair actually present" question
 * `loadB2ConfigFromEnv()` answers for the write side, and the render
 * Worker's own `loadB2PlaybackConfigFromEnv()` answers independently for
 * public delivery. No B2 read credentials are configured in this
 * repository's environments today, so every caller resolves this `false`
 * and `available` stays unreachable exactly as it did before this
 * parameter existed — this only makes the condition explicit and testable
 * rather than removing it.
 */
export function toProviderSafeRecordingView(
  recording: EventRecordingRow | null,
  b2PlaybackConfigured: boolean = false
): ProviderSafeRecordingView {
  if (!recording) {
    return { replayStatus: 'not_available', retentionExpiresAt: null, youtubeFallbackAvailable: false };
  }

  // `available` requires every one of:
  //  1. The archive is trustworthy: `recording_state = 'b2_finalized'` AND
  //     `integrity_verified_at` present (reaching `b2_finalized` alone only
  //     proves the objects exist and are self-consistent, not that their
  //     bytes are verified).
  //  2. The recording is still within its promised retention window
  //     (`retention_expires_at` in the future) — an expired recording must
  //     never be reported "available" even if it once was.
  //  3. A real playback-delivery path is actually configured
  //     (`b2PlaybackConfigured`) — the render Worker performs this exact
  //     same check independently before it will actually serve a byte, so
  //     this route can never promise more than the Worker can deliver.
  const isArchiveVerified = recording.recording_state === 'b2_finalized' && recording.integrity_verified_at !== null;
  const isWithinRetention =
    recording.retention_expires_at !== null && new Date(recording.retention_expires_at).getTime() > Date.now();

  let replayStatus: ProviderSafeRecordingView['replayStatus'] = 'not_available';
  if (isArchiveVerified && isWithinRetention && b2PlaybackConfigured) {
    replayStatus = 'available';
  } else if (
    recording.recording_state === 'recording' ||
    recording.recording_state === 'local_finalized' ||
    recording.recording_state === 'b2_finalizing' ||
    recording.recording_state === 'b2_finalized'
  ) {
    replayStatus = 'processing';
  } else if (recording.recording_state === 'failed') {
    replayStatus = 'failed';
  }

  return {
    replayStatus,
    retentionExpiresAt: recording.retention_expires_at,
    // Only a verified fallback is ever surfaced as "available" — an
    // unverified manual URL is never presented as a real fallback option.
    youtubeFallbackAvailable: recording.youtube_fallback_verified === true,
  };
}

/** Proves event ownership, then returns the sanitized provider-facing recording view. Never the raw row. */
export async function getProviderSafeRecordingViewForOwnedEvent(
  eventId: string,
  studioId: string
): Promise<{ ok: true; view: ProviderSafeRecordingView } | { ok: false }> {
  const ownership = await getOwnedEventById(db, eventId, studioId, 'id');
  if (isOwnershipError(ownership)) {
    return { ok: false };
  }

  const recording = await getEventRecordingState(eventId);
  const b2PlaybackConfigured = loadB2ConfigFromEnv() !== null;
  return { ok: true, view: toProviderSafeRecordingView(recording, b2PlaybackConfigured) };
}
