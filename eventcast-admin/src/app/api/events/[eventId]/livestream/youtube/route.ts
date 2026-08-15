import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin, canMutateStudioResources } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';
import { isValidYoutubeWatchUrl } from '@/lib/youtubeUrl';

/**
 * PATCH /api/events/[eventId]/livestream/youtube
 *
 * Manual scheduled/linked YouTube destination (Baseline V2.1 YTB-003 only:
 * "A manually scheduled client event can be linked. The watch link alone
 * supports embedding; relay requires OAuth or secure ingest credentials.").
 * This route stores only the watch link — reusing the existing legacy
 * `events.youtube_url` column, already read by the pre-existing Livestream
 * Control Room roster (`_lib/livestreams.ts`) — and performs no relay setup,
 * no ingest-credential handling, and no YouTube API call of any kind.
 *
 * The provider OAuth channel (YTB-001) and client OAuth channel (YTB-002)
 * destination models, and any YouTube relay through
 * `media_event_assignments.youtube_enabled`/`youtube_secret_reference`, are
 * NOT implemented by this route or anywhere else in this package: they
 * require real Google OAuth client credentials, a consent flow, and a secure
 * secret-store write path for `youtube_secret_reference`, none of which
 * exists yet in this repository. That is the OAuth/secrets hard boundary
 * this package stops at — see the completion report for what a future
 * package would need.
 */

export const runtime = 'edge';

const db = supabaseAdmin || supabase;

interface LivestreamEventRow {
  id: string;
}

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

interface YoutubeUpdateBody {
  youtubeUrl?: unknown;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json({ success: false, error: 'Forbidden: read-only studio role' }, { status: 403 });
  }

  const { eventId } = await params;
  const ownership = await getOwnedEventById<LivestreamEventRow>(db, eventId, auth.studioId, 'id');
  if (isOwnershipError(ownership)) return ownership.error;
  const event = ownership.event;

  let body: YoutubeUpdateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  let youtubeUrl: string | null;
  if (body.youtubeUrl === null || body.youtubeUrl === '') {
    youtubeUrl = null;
  } else if (typeof body.youtubeUrl === 'string' && isValidYoutubeWatchUrl(body.youtubeUrl)) {
    youtubeUrl = body.youtubeUrl;
  } else {
    return NextResponse.json(
      { success: false, error: 'youtubeUrl must be a valid youtube.com/youtu.be link, or null to clear it.' },
      { status: 400 }
    );
  }

  const { error: updateError } = await db
    .from('events')
    .update({ youtube_url: youtubeUrl })
    .eq('id', event.id)
    .eq('studio_id', auth.studioId);

  if (updateError) {
    return NextResponse.json(
      { success: false, error: 'Failed to update the YouTube watch link: ' + updateError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, youtubeUrl });
}
