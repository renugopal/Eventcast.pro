import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';

/**
 * GET /api/livestreams
 *
 * Provider Console "Live Streams" roster (Baseline V2.1 DASH-002), studio-
 * scoped via `auth.studioId` — never a client-supplied studio id. Read-only
 * aggregation, same pattern as the existing global Media Library
 * (`GET /api/media`): each row reports only non-secret booleans/facts and
 * links back to the owning event's real Live tab, where the actual
 * enable/end mutations already live (this route performs no mutation).
 *
 * `livestreamEnabled` comes from the existing `media_event_assignments`
 * control-plane row (embedded via its `event_id` FK) — no new stream state,
 * no secret column ever selected. `youtubeConfigured` reflects the existing
 * legacy `events.youtube_url` column, reused as the manual YouTube
 * watch-link field (Baseline YTB-003).
 */

const db = supabaseAdmin || supabase;

interface LivestreamRosterRow {
  id: string;
  event_type: string | null;
  groom_name: string | null;
  bride_name: string | null;
  celebrant_name: string | null;
  event_date: string | null;
  event_time: string | null;
  venue_name: string | null;
  slug: string | null;
  page_state: string | null;
  youtube_url: string | null;
  archived_at: string | null;
  media_event_assignments: { enabled: boolean } | { enabled: boolean }[] | null;
}

function resolveEnabled(row: LivestreamRosterRow): boolean {
  const assignment = row.media_event_assignments;
  if (!assignment) return false;
  const single = Array.isArray(assignment) ? assignment[0] : assignment;
  return single?.enabled ?? false;
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await db
    .from('events')
    .select(
      'id, event_type, groom_name, bride_name, celebrant_name, event_date, event_time, venue_name, slug, page_state, youtube_url, archived_at, media_event_assignments(enabled)'
    )
    .eq('studio_id', auth.studioId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to load livestream roster: ' + error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as LivestreamRosterRow[];

  const items = rows.map((row) => ({
    eventId: row.id,
    eventType: row.event_type,
    groomName: row.groom_name,
    brideName: row.bride_name,
    celebrantName: row.celebrant_name,
    eventDate: row.event_date,
    eventTime: row.event_time,
    venueName: row.venue_name,
    slug: row.slug,
    pageState: row.page_state,
    livestreamEnabled: resolveEnabled(row),
    youtubeConfigured: Boolean(row.youtube_url),
  }));

  return NextResponse.json({ success: true, items });
}
