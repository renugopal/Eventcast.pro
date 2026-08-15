import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';
import { unavailable, NO_TECHNICAL_STREAM_METRICS_REASON } from '@/lib/platformOperations';

/**
 * GET /api/platform/streams — cross-tenant "Enabled Stream Assignments"
 * roster. `requireSuperAdmin`-gated, service-role client.
 *
 * Deliberately NOT labeled or counted as "Active Streams": this endpoint
 * extends the existing secret-excluding projection pattern from
 * `studioLiveStatus.ts`/`assignmentStatusRepo.ts` to a no-event-filter
 * roster, but `media_event_assignments.enabled = true` only proves the
 * assignment is enabled, not that it is currently ingesting. No
 * authoritative live-session/telemetry source exists anywhere in this
 * repository to prove real live/active status, so this route reports
 * honestly on enabled assignments and leaves true active status
 * unavailable rather than inferring it. Excludes `stream_secret_hash`,
 * `youtube_secret_reference`, and any other node/credential internals.
 */
export const runtime = 'edge';

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

  const assignments = (data ?? []).map((row: Record<string, unknown>) => {
    const events = row.events as { slug?: string; studio_id?: string } | { slug?: string; studio_id?: string }[] | null;
    const event = Array.isArray(events) ? events[0] : events;
    const nodes = row.media_nodes as { name?: string; status?: string } | { name?: string; status?: string }[] | null;
    const node = Array.isArray(nodes) ? nodes[0] : nodes;
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
      // Honestly unavailable — see module doc comment above.
      liveStatus: 'unavailable' as const,
      technicalStreamMetrics: unavailable(NO_TECHNICAL_STREAM_METRICS_REASON),
    };
  });

  return NextResponse.json({ success: true, enabledStreamAssignments: assignments });
}
