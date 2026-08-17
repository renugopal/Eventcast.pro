import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';
import { loadStudioLiveStatus } from '@/lib/media-agent/studioLiveStatus';

/**
 * GET /api/events/[eventId]/livestream/status
 *
 * Studio-facing Live Control Room status (Livestream + YouTube + Live
 * Control Room delivery package, Baseline V2.1 LIV-007). Read-only — open
 * to every studio member, same as the other event-scoped GET routes; only
 * the enable/end/youtube mutations below are owner/admin-gated.
 *
 * Reuses the existing SRS/Media Agent control plane's own
 * `media_event_assignments` table through the new `loadStudioLiveStatus`
 * helper (which additionally resolves the assigned node's non-secret
 * `ingest_hostname` to build a Stream URL) — no new stream state is
 * invented, and no secret (`stream_secret_hash`, the raw publish token,
 * `youtube_secret_reference`) is ever read or returned here. `youtubeUrl` is
 * the existing legacy `events.youtube_url` column, reused as the manual
 * YouTube watch-link field (Baseline YTB-003) — a link only, never relay
 * credentials.
 */

const db = supabaseAdmin || supabase;

interface LivestreamEventRow {
  id: string;
  youtube_url: string | null;
}

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;
  const ownership = await getOwnedEventById<LivestreamEventRow>(db, eventId, auth.studioId, 'id, youtube_url');
  if (isOwnershipError(ownership)) return ownership.error;
  const event = ownership.event;

  const result = await loadStudioLiveStatus(db, event.id);

  if (result.outcome === 'error') {
    return NextResponse.json({ success: false, error: 'Failed to load livestream status' }, { status: 500 });
  }

  const status =
    result.outcome === 'found'
      ? result.status
      : {
          enabled: false,
          ingestId: null,
          playbackId: null,
          streamUrl: null,
          publishWindowStartAt: null,
          publishWindowEndAt: null,
          youtubeEnabled: false,
          configVersion: null,
          updatedAt: null,
        };

  return NextResponse.json({
    success: true,
    status,
    youtubeWatchUrl: event.youtube_url ?? null,
  });
}
