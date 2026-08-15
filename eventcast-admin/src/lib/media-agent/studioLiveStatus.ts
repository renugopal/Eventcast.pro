/**
 * Studio-facing (provider Live Control Room) projection of a
 * `media_event_assignments` row — distinct from `assignmentStatusRepo.ts`'s
 * `loadAssignmentStatus`, which is the operator-only bridge and deliberately
 * excludes `assigned_media_node_id` because an operator retrieving
 * playback/publish state has no use for it.
 *
 * The provider Live Control Room has a real, narrow use for the *node's*
 * `ingest_hostname` (a non-secret DNS name, not the node's internal UUID):
 * without it there is no way to show the provider the RTMP Stream URL their
 * encoder must publish to. This module embeds `media_nodes(ingest_hostname)`
 * through the existing FK (`assigned_media_node_id`) for exactly that reason
 * and constructs `streamUrl` server-side — the raw `assigned_media_node_id`
 * itself is never included in the returned shape.
 *
 * Still excludes every secret/internal field: `stream_secret_hash`,
 * `youtube_secret_reference`, `youtube_destination_base_url`. The raw publish
 * token is never persisted anywhere (only its hash) — it exists only in the
 * one-time response from the enable action (`assignmentActivation.ts`).
 */

export interface StudioLiveStatus {
  enabled: boolean;
  ingestId: string | null;
  playbackId: string | null;
  streamUrl: string | null;
  publishWindowStartAt: string | null;
  publishWindowEndAt: string | null;
  youtubeEnabled: boolean;
  configVersion: string;
  updatedAt: string;
}

interface StudioLiveStatusRow {
  event_id: string;
  ingest_id: string | null;
  playback_id: string | null;
  enabled: boolean;
  publish_window_start_at: string | null;
  publish_window_end_at: string | null;
  config_version: number | string;
  updated_at: string;
  youtube_enabled: boolean;
  media_nodes: { ingest_hostname: string | null } | { ingest_hostname: string | null }[] | null;
}

interface DbQueryResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

interface StudioLiveStatusDb {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        maybeSingle: () => PromiseLike<DbQueryResult<StudioLiveStatusRow>>;
      };
    };
  };
}

export const STUDIO_LIVE_STATUS_SELECT_COLUMNS =
  'event_id, ingest_id, playback_id, enabled, publish_window_start_at, publish_window_end_at, config_version, updated_at, youtube_enabled, media_nodes(ingest_hostname)';

export type StudioLiveStatusResult =
  | { outcome: 'found'; status: StudioLiveStatus }
  | { outcome: 'not_found' }
  | { outcome: 'error' };

function resolveIngestHostname(row: StudioLiveStatusRow): string | null {
  const nodes = row.media_nodes;
  if (!nodes) return null;
  const node = Array.isArray(nodes) ? nodes[0] : nodes;
  return node?.ingest_hostname ?? null;
}

/**
 * Loads the studio-safe Live Control Room status for one event's assignment.
 * `streamUrl` is populated only when the row is enabled and both the
 * ingest id and the assigned node's hostname are present — the exact same
 * bare `rtmp://{hostname}/live` shape the one-time activation response
 * returns (see `enable/route.ts`: this is the OBS/encoder "Server" value,
 * deliberately without the ingest id, which lives only in the one-time,
 * non-recoverable `streamKey`). Reconstructed from durably-stored,
 * non-secret columns on every later read.
 */
export async function loadStudioLiveStatus(db: unknown, eventId: string): Promise<StudioLiveStatusResult> {
  const queryableDb = db as StudioLiveStatusDb;
  const { data, error } = await queryableDb
    .from('media_event_assignments')
    .select(STUDIO_LIVE_STATUS_SELECT_COLUMNS)
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) return { outcome: 'error' };
  if (!data) return { outcome: 'not_found' };

  const ingestHostname = resolveIngestHostname(data);
  const streamUrl =
    data.enabled && data.ingest_id && ingestHostname ? `rtmp://${ingestHostname}/live` : null;

  return {
    outcome: 'found',
    status: {
      enabled: data.enabled,
      ingestId: data.ingest_id ?? null,
      playbackId: data.playback_id ?? null,
      streamUrl,
      publishWindowStartAt: data.publish_window_start_at ?? null,
      publishWindowEndAt: data.publish_window_end_at ?? null,
      youtubeEnabled: data.youtube_enabled,
      configVersion: String(data.config_version),
      updatedAt: data.updated_at,
    },
  };
}
