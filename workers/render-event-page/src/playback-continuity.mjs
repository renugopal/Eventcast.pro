// Pure helpers for post-End playback continuity (Livestream Reliability &
// Operations package). Plain JS with JSDoc, like hls-playback.mjs, so
// `node --test` executes them directly without a TS transform.
//
// Lifecycle these helpers encode (index.ts wires them):
//
//   LIVE     assignment enabled                  -> existing live behavior
//   BRIDGE   assignment disabled (Provider End), the SAME preserved
//            playback id's intermediate R2 live manifest still exists and
//            was last published within the bridge freshness bound
//   R2-FINAL assignment disabled, durable proven event_recordings.
//            r2_playback_id equals the preserved playback id, eligible
//            recording state/gap/retention, VOD manifest exists
//
// The bridge is a PLAYBACK-CONTINUITY bound only. It never extends stream
// publishability or Media Agent assignment authorization - it only decides
// whether this Worker may keep serving already-published R2 objects for a
// disabled assignment.

/**
 * Default bridge freshness bound: 3 hours (10800 seconds), measured from the
 * intermediate live manifest's last R2 publication. It comfortably exceeds
 * the Media Agent AutoFinalizer's default quiet period (120 s) + scan
 * interval (30 s) + claim lease (180 s), so an enabled, healthy
 * AutoFinalizer normally hands over to finalized replay well within it.
 * Override with the PLAYBACK_BRIDGE_MAX_AGE_SECONDS Worker var.
 */
export const DEFAULT_BRIDGE_MAX_AGE_SECONDS = 10800;

/** Upper bound accepted from configuration (24 hours). */
export const MAX_BRIDGE_MAX_AGE_SECONDS = 86400;

/**
 * Parse the PLAYBACK_BRIDGE_MAX_AGE_SECONDS Worker var. Accepts only a
 * plain decimal integer in [1, MAX_BRIDGE_MAX_AGE_SECONDS]; anything else
 * (absent, empty, non-numeric, fractional, signed, zero, too large) falls
 * back to the documented default rather than an unbounded or surprising
 * value.
 *
 * @param {unknown} raw
 * @returns {number}
 */
export function parseBridgeMaxAgeSeconds(raw) {
  if (typeof raw !== 'string' || !/^[0-9]{1,6}$/.test(raw.trim())) {
    return DEFAULT_BRIDGE_MAX_AGE_SECONDS;
  }
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_BRIDGE_MAX_AGE_SECONDS) {
    return DEFAULT_BRIDGE_MAX_AGE_SECONDS;
  }
  return value;
}

/**
 * True when an intermediate live manifest last published at `uploaded` is
 * still within the bridge bound. A missing/invalid timestamp fails closed.
 * A timestamp slightly in the future (clock skew) counts as age 0.
 *
 * @param {Date | string | number | null | undefined} uploaded
 * @param {number} nowMs
 * @param {number} maxAgeSeconds
 * @returns {boolean}
 */
export function isBridgeManifestFresh(uploaded, nowMs, maxAgeSeconds) {
  if (uploaded === null || uploaded === undefined) return false;
  const uploadedMs = uploaded instanceof Date ? uploaded.getTime() : new Date(uploaded).getTime();
  if (!Number.isFinite(uploadedMs) || !Number.isFinite(nowMs)) return false;
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) return false;
  const ageMs = Math.max(0, nowMs - uploadedMs);
  return ageMs <= maxAgeSeconds * 1000;
}

/**
 * For a DISABLED assignment, which continuity gate must authorize this
 * already-validated HLS asset (see hls-playback.mjs parseHlsAssetPath):
 *  - live manifest -> 'bridge'   (fresh intermediate live manifest)
 *  - vod manifest  -> 'r2_final' (proven finalized R2 VOD)
 *  - segment       -> 'bridge_or_r2_final' (segments are shared by both
 *                     manifests and always scoped to the same playback id)
 *
 * @param {{ kind: 'manifest', variant: 'live' | 'vod' } | { kind: 'segment' }} asset
 * @returns {'bridge' | 'r2_final' | 'bridge_or_r2_final'}
 */
export function disabledHlsAssetRequirement(asset) {
  if (asset.kind === 'manifest') {
    return asset.variant === 'live' ? 'bridge' : 'r2_final';
  }
  return 'bridge_or_r2_final';
}
