import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';
import {
  toPlatformStreamTechnicalView,
  type MediaStreamTelemetryRow,
} from '@/lib/platformOperations';

/**
 * GET /api/platform/streams — cross-tenant "Enabled Stream Assignments"
 * roster. `requireSuperAdmin`-gated, service-role client.
 *
 * Deliberately NOT labeled or counted as "Active Streams": `enabled =
 * true` alone only proves the assignment is enabled, not that it is
 * currently ingesting. `liveStatus`/`technicalStreamMetrics` now come
 * from `media_stream_telemetry` (migration `0040`, Livestream Technical
 * Telemetry + Media Node Health Reporting) — but ONLY when that row was
 * reported by this assignment's CURRENT node
 * (`telemetry.reporting_media_node_id === assigned_media_node_id`). A
 * still-fresh row from a node the event was later reassigned away from
 * is treated as unavailable here, never shown beside the new current
 * assignment — the same reassignment-safety principle migration `0040`'s
 * write-side authorization already enforces. `toPlatformStreamTechnicalView`
 * remains the single place that decides freshness and renders a missing/
 * stale/foreign-node row as honestly unavailable. Excludes
 * `stream_secret_hash`, `youtube_secret_reference`, and any other
 * node/credential internals.
 */

const db = supabaseAdmin || supabase;

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await db
    .from('media_event_assignments')
    .select(
      'event_id, enabled, ingest_id, playback_id, publish_window_start_at, publish_window_end_at, youtube_enabled, updated_at, assigned_media_node_id, events(slug, studio_id), media_nodes(name, status)'
    )
    .eq('enabled', true)
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to load enabled stream assignments' }, { status: 500 });
  }

  const rows = data ?? [];
  const eventIds = rows.map((row) => row.event_id as string).filter(Boolean);

  const telemetryByEventId = new Map<string, MediaStreamTelemetryRow>();
  if (eventIds.length > 0) {
    const { data: telemetryRows, error: telemetryError } = await db
      .from('media_stream_telemetry')
      .select(
        'event_id, reporting_media_node_id, sampled_at, connected, srs_publish_active, video_width, video_height, video_codec, audio_codec, audio_present, ingest_kbps_recv_30s, recv_bytes, captured_segment_bitrate_kbps, publish_duration_seconds, session_count, reconnect_count, segment_freshness_seconds, updated_at'
      )
      .in('event_id', eventIds);

    if (telemetryError) {
      return NextResponse.json({ success: false, error: 'Failed to load stream telemetry' }, { status: 500 });
    }
    for (const row of (telemetryRows ?? []) as MediaStreamTelemetryRow[]) {
      telemetryByEventId.set(row.event_id, row);
    }
  }

  const assignments = rows.map((row: Record<string, unknown>) => {
    const events = row.events as { slug?: string; studio_id?: string } | { slug?: string; studio_id?: string }[] | null;
    const event = Array.isArray(events) ? events[0] : events;
    const nodes = row.media_nodes as { name?: string; status?: string } | { name?: string; status?: string }[] | null;
    const node = Array.isArray(nodes) ? nodes[0] : nodes;

    // Only accept telemetry reported by THIS assignment's current node —
    // see the module doc comment above for why.
    const telemetryRow = telemetryByEventId.get(row.event_id as string) ?? null;
    const telemetryForCurrentAssignment =
      telemetryRow && telemetryRow.reporting_media_node_id === row.assigned_media_node_id ? telemetryRow : null;

    const technicalView = toPlatformStreamTechnicalView(telemetryForCurrentAssignment);
    const liveStatus = technicalView.available
      ? technicalView.sourceHealth === 'good'
        ? ('connected' as const)
        : ('not_connected' as const)
      : ('unavailable' as const);

    return {
      eventId: row.event_id,
      eventSlug: event?.slug ?? null,
      studioId: event?.studio_id ?? null,
      assignedMediaNodeId: row.assigned_media_node_id ?? null,
      assignedMediaNodeName: node?.name ?? null,
      assignedMediaNodeStatus: node?.status ?? null,
      enabled: row.enabled,
      ingestPresent: Boolean(row.ingest_id),
      playbackPresent: Boolean(row.playback_id),
      publishWindowStartAt: row.publish_window_start_at,
      publishWindowEndAt: row.publish_window_end_at,
      youtubeEnabled: row.youtube_enabled,
      updatedAt: row.updated_at,
      liveStatus,
      technicalStreamMetrics: technicalView,
    };
  });

  return NextResponse.json({ success: true, enabledStreamAssignments: assignments });
}
