/**
 * Finalized-R2 replay eligibility (migration 0044), shared by the Admin
 * provider availability view and the public render Worker so both apply the
 * exact same fail-closed database gates.
 *
 * Deliberately dependency-free (no imports, types only) so it can be
 * imported by the Worker bundle and executed directly by `node --test`.
 *
 * These are the DATABASE gates only. The render Worker additionally
 * requires the VOD manifest object to exist and every manifest line to
 * rewrite onto the same playback id before it serves a byte.
 */

/** The Worker's R2 key-component rule (`hls-playback.mjs` COMPONENT_RE). */
export const PLAYBACK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isValidPlaybackIdentifier(value: unknown): value is string {
  return typeof value === 'string' && PLAYBACK_ID_PATTERN.test(value);
}

/** Recording states in which a finalized R2 VOD playlist can exist. */
export const R2_FINAL_REPLAY_STATES: readonly string[] = ['local_finalized', 'b2_finalizing', 'b2_finalized'];

export interface ReplayAssignmentSnapshot {
  playback_id: string | null | undefined;
  enabled: boolean | null | undefined;
}

export interface R2ReplayRecordingEvidence {
  recording_state: string;
  r2_playback_id?: string | null;
  gap_count?: number | null;
  gap_status?: string | null;
  retention_expires_at?: string | null;
}

/**
 * True only when every one of these holds:
 *  - the assignment exists and is DISABLED (a live event is never replay);
 *  - the assignment's preserved playback id and the durable
 *    `event_recordings.r2_playback_id` are both valid and EQUAL - equality
 *    also proves no re-activation has minted a newer playback id since the
 *    pointer was proven;
 *  - the recording is in a state in which a finalized R2 VOD exists;
 *  - the recording is gap-free or its gap was explicitly acknowledged
 *    (`pending_review` and `rejected` never serve - known-incomplete media);
 *  - retention, when frozen, has not expired.
 */
export function isR2FinalReplayEligible(
  recording: R2ReplayRecordingEvidence | null | undefined,
  assignment: ReplayAssignmentSnapshot | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!recording || !assignment) return false;
  if (assignment.enabled !== false) return false;
  if (!isValidPlaybackIdentifier(assignment.playback_id)) return false;
  if (!isValidPlaybackIdentifier(recording.r2_playback_id)) return false;
  if (recording.r2_playback_id !== assignment.playback_id) return false;
  if (!R2_FINAL_REPLAY_STATES.includes(recording.recording_state)) return false;

  const gapFree = recording.gap_count === 0;
  if (!gapFree && recording.gap_status !== 'acknowledged') return false;

  if (recording.retention_expires_at !== null && recording.retention_expires_at !== undefined) {
    const expiresAt = new Date(recording.retention_expires_at).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return false;
  }
  return true;
}
