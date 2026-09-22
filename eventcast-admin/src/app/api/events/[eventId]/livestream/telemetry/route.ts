import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';
import { loadStudioLiveStatus } from '@/lib/media-agent/studioLiveStatus';
import {
  toProviderStreamTechnicalView,
  type MediaStreamTelemetryRow,
} from '@/lib/platformOperations';

/**
 * GET /api/events/[eventId]/livestream/telemetry
 *
 * Studio-facing Live Control Room technical-telemetry read (Livestream
 * Technical Telemetry + Media Node Health Reporting). Read-only — open to
 * every studio member, same as the sibling `.../livestream/status` route.
 *
 * Reads `media_stream_telemetry` (migration `0040`) directly via the
 * server-side service-role client — the event is already proven owned by
 * `getOwnedEventById`, and this table is RLS-locked with zero client
 * policies by design, so it is never queried from the browser. The row is
 * projected through `toProviderStreamTechnicalView`, the single place
 * that decides what a normal provider may see: no node id, hostname,
 * region, disk/queue state, software/config version, or raw error text —
 * see that function's doc for the full exclusion list. A missing or
 * stale row (older than `STREAM_TELEMETRY_STALE_AFTER_SECONDS`) renders
 * identically as unavailable/"no signal", never a frozen last-known-good
 * sample.
 *
 * The relay-state word reuses `loadStudioLiveStatus` — the SAME
 * authoritative source the sibling `.../livestream/status` route already
 * reads (`media_event_assignments.youtube_enabled`) — rather than
 * inferring relay state from `events.youtube_url`, which is only the
 * separate manual YouTube watch-link (Baseline YTB-003) and proves
 * nothing about whether relay is actually enabled for this event.
 */

const db = supabaseAdmin || supabase;

interface LivestreamEventRow {
  id: string;
}

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;
  const ownership = await getOwnedEventById<LivestreamEventRow>(db, eventId, auth.studioId, 'id');
  if (isOwnershipError(ownership)) return ownership.error;
  const event = ownership.event;

  const [telemetryResult, liveStatusResult] = await Promise.all([
    db
      .from('media_stream_telemetry')
      .select(
        'event_id, reporting_media_node_id, sampled_at, connected, srs_publish_active, video_width, video_height, video_codec, audio_codec, audio_present, ingest_kbps_recv_30s, recv_bytes, captured_segment_bitrate_kbps, publish_duration_seconds, session_count, reconnect_count, segment_freshness_seconds, updated_at'
      )
      .eq('event_id', event.id)
      .maybeSingle(),
    loadStudioLiveStatus(db, event.id),
  ]);

  if (telemetryResult.error) {
    return NextResponse.json({ success: false, error: 'Failed to load stream telemetry' }, { status: 500 });
  }
  if (liveStatusResult.outcome === 'error') {
    return NextResponse.json({ success: false, error: 'Failed to load livestream status' }, { status: 500 });
  }

  const row = (telemetryResult.data as MediaStreamTelemetryRow | null) ?? null;
  const youtubeEnabled = liveStatusResult.outcome === 'found' ? liveStatusResult.status.youtubeEnabled : false;
  const technical = toProviderStreamTechnicalView(row, youtubeEnabled);

  return NextResponse.json({ success: true, technical });
}
