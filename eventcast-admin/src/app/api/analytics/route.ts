import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';

/**
 * GET /api/analytics
 *
 * Provider Console Analytics roster (Baseline V2.1 Milestone J), studio-
 * scoped via `auth.studioId` — never a client-supplied studio id. Each row
 * is a real, cheaply-computed summary per event, linking back to that
 * event's own Event Workspace Analytics tab
 * (`GET /api/events/[eventId]/analytics`) for the full breakdown. No
 * decorative or cross-event-derived metric is invented here — totals below
 * are plain sums of the same real per-event counts.
 *
 * `currentViewers` per event only scans heartbeats from the last
 * ACTIVE_TIMEOUT_SECONDS (cheap, index-backed range scan) rather than every
 * heartbeat ever recorded — full historical audience aggregation for one
 * event lives on that event's own analytics route.
 */

const db = supabaseAdmin || supabase;

const ACTIVE_TIMEOUT_SECONDS = 60;

interface EventRosterRow {
  id: string;
  event_type: string | null;
  groom_name: string | null;
  bride_name: string | null;
  celebrant_name: string | null;
  page_state: string | null;
}

function displayName(row: EventRosterRow): string {
  if (row.groom_name && row.bride_name) return `${row.groom_name} & ${row.bride_name}`;
  return row.groom_name || row.celebrant_name || row.event_type || 'Untitled event';
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { data: eventRows, error: eventsError } = await db
    .from('events')
    .select('id, event_type, groom_name, bride_name, celebrant_name, page_state')
    .eq('studio_id', auth.studioId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  if (eventsError) {
    return NextResponse.json({ success: false, error: 'Failed to load events: ' + eventsError.message }, { status: 500 });
  }

  const events = (eventRows ?? []) as EventRosterRow[];
  const activeSinceIso = new Date(Date.now() - ACTIVE_TIMEOUT_SECONDS * 1000).toISOString();

  const summaries = await Promise.all(
    events.map(async (row) => {
      const [pageViewsResult, wishesResult, guestMemoriesResult, uniqueVisitorRowsResult, currentHeartbeatsResult, totalHeartbeatsResult] =
        await Promise.all([
          db.from('page_views').select('id', { count: 'exact', head: true }).eq('event_id', row.id),
          db.from('wishes').select('id', { count: 'exact', head: true }).eq('event_id', row.id),
          db.from('guest_photos').select('id', { count: 'exact', head: true }).eq('event_id', row.id),
          db.from('page_views').select('visitor_id').eq('event_id', row.id).not('visitor_id', 'is', null),
          db
            .from('event_audience_heartbeats')
            .select('viewer_id')
            .eq('event_id', row.id)
            // Accepted server bucket, not arrival time: matches the
            // per-event analytics route and uses the
            // (event_id, bucket_started_at DESC) index from migration 0034.
            .gte('bucket_started_at', activeSinceIso),
          db.from('event_audience_heartbeats').select('viewer_id').eq('event_id', row.id).limit(50000),
        ]);

      const uniqueVisitors = new Set((uniqueVisitorRowsResult.data ?? []).map((r) => r.visitor_id)).size;
      const currentViewers = new Set((currentHeartbeatsResult.data ?? []).map((r) => r.viewer_id)).size;
      const totalUniqueViewers = new Set((totalHeartbeatsResult.data ?? []).map((r) => r.viewer_id)).size;

      return {
        eventId: row.id,
        displayName: displayName(row),
        pageState: row.page_state,
        totalPageViews: pageViewsResult.count ?? 0,
        uniqueVisitors,
        wishesCount: wishesResult.count ?? 0,
        guestMemoriesCount: guestMemoriesResult.count ?? 0,
        currentViewers,
        totalUniqueViewers,
      };
    })
  );

  const totals = summaries.reduce(
    (acc, s) => ({
      totalPageViews: acc.totalPageViews + s.totalPageViews,
      totalUniqueVisitors: acc.totalUniqueVisitors + s.uniqueVisitors,
      totalCurrentViewers: acc.totalCurrentViewers + s.currentViewers,
    }),
    { totalPageViews: 0, totalUniqueVisitors: 0, totalCurrentViewers: 0 }
  );

  return NextResponse.json({ success: true, events: summaries, totals });
}
