import type { EventRecordingRow } from './eventRecording';

/**
 * Fail-closed R2 live/DVR/short-grace cleanup eligibility predicate.
 *
 * Eligibility only, never execution: this function never deletes anything,
 * never schedules anything, and is not wired to any cron. No grace duration
 * is invented here — the exact operational timing decision remains separate
 * from this eligibility question.
 *
 * All of the following must be true, or the event is not eligible. Missing
 * or inconsistent evidence fails closed (not eligible), never open:
 *  - recording_state is exactly 'b2_finalized'
 *  - a non-empty B2 object key AND bucket/storage identity are present
 *  - b2_finalized_at is present (authoritative B2 finalization succeeded)
 *  - integrity_verified_at is present (completeness/integrity verified)
 *  - retention_effective_days is a positive persisted value
 *  - retention_frozen_at is present (durable retention state persisted)
 *  - retention_expires_at is present
 *
 * A non-null b2_object_key alone never contributes to eligibility — it is
 * not evidence of successful finalization by itself.
 */
export function isR2CleanupEligible(recording: EventRecordingRow | null | undefined): boolean {
  if (!recording) return false;

  return (
    recording.recording_state === 'b2_finalized' &&
    typeof recording.b2_object_key === 'string' &&
    recording.b2_object_key.length > 0 &&
    typeof recording.b2_bucket === 'string' &&
    recording.b2_bucket.length > 0 &&
    recording.b2_finalized_at !== null &&
    recording.integrity_verified_at !== null &&
    typeof recording.retention_effective_days === 'number' &&
    recording.retention_effective_days > 0 &&
    recording.retention_frozen_at !== null &&
    recording.retention_expires_at !== null
  );
}
