/**
 * Service-role data-access helper for the internal, operator-only
 * assignment-status retrieval endpoint
 * (`GET /internal/media/assignments/{event_id}/status`).
 *
 * Selects only the exact column set `BrowserSafeAssignment` (`contracts.ts`)
 * already defines as safe — `stream_secret_hash`, `youtube_secret_reference`,
 * and every other secret-bearing column are never named in the `SELECT` at
 * all. This is structurally incapable of leaking a secret: there is no
 * fetch-then-redact step for this endpoint to get wrong, because the secret
 * columns are simply never read from the database in the first place.
 */
import type { BrowserSafeAssignment } from './contracts';

interface AssignmentStatusRow {
  event_id: string;
  ingest_id: string | null;
  playback_id: string | null;
  enabled: boolean;
  publish_window_start_at: string | null;
  publish_window_end_at: string | null;
  config_version: number | string;
  updated_at: string;
  youtube_enabled: boolean;
}

interface DbQueryResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

interface AssignmentStatusDb {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        maybeSingle: () => PromiseLike<DbQueryResult<AssignmentStatusRow>>;
      };
    };
  };
}

/**
 * Explicit allowlist — deliberately excludes `assigned_media_node_id`
 * (internal node UUID) alongside every secret-bearing column, since neither
 * is needed by an operator retrieving playback/publish state for an event.
 */
export const ASSIGNMENT_STATUS_SELECT_COLUMNS =
  'event_id, ingest_id, playback_id, enabled, publish_window_start_at, publish_window_end_at, config_version, updated_at, youtube_enabled';

export type AssignmentStatusResult =
  | { outcome: 'found'; status: BrowserSafeAssignment }
  | { outcome: 'not_found' }
  | { outcome: 'error' };

/**
 * Loads the safe, non-secret state of an event's assignment row, whether
 * it's still an unenabled draft or already activated. `ingestId`/
 * `playbackId`/publish-window fields are `null` in the database for a
 * not-yet-activated draft; coerced to `''` here to match the wire
 * contract's existing convention (Go emits `""`, never `null`, for an
 * unset-but-present string field — see `contracts.ts`).
 */
export async function loadAssignmentStatus(db: unknown, eventId: string): Promise<AssignmentStatusResult> {
  const queryableDb = db as AssignmentStatusDb;
  const { data, error } = await queryableDb
    .from('media_event_assignments')
    .select(ASSIGNMENT_STATUS_SELECT_COLUMNS)
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) return { outcome: 'error' };
  if (!data) return { outcome: 'not_found' };

  return {
    outcome: 'found',
    status: {
      ingestId: data.ingest_id ?? '',
      eventId: data.event_id,
      playbackId: data.playback_id ?? '',
      enabled: data.enabled,
      publishWindowStartAt: data.publish_window_start_at ?? '',
      publishWindowEndAt: data.publish_window_end_at ?? '',
      configVersion: String(data.config_version),
      updatedAt: data.updated_at,
      youtubeEnabled: data.youtube_enabled,
    },
  };
}
