export const runtime = 'edge';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';

interface ToggleLiveEventRow {
  id: string;
  youtube_broadcast_id: string | null;
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { eventId, title, isLive } = await req.json();

    if (!eventId) {
      return NextResponse.json({ success: false, error: 'Missing eventId' }, { status: 400 });
    }

    if (typeof title !== 'string' || typeof isLive !== 'boolean') {
      return NextResponse.json({ success: false, error: 'title must be a string and isLive must be a boolean' }, { status: 400 });
    }

    // 1. Verify ownership before any YouTube API call. Cross-tenant and
    //    nonexistent events return the same generic response, so resource
    //    existence is never leaked.
    const { supabaseAdmin } = await import('@/lib/supabase');
    if (!supabaseAdmin) {
      throw new Error('Supabase Admin client is not configured');
    }
    const ownership = await getOwnedEventById<ToggleLiveEventRow>(supabaseAdmin, eventId, auth.studioId, 'id, youtube_broadcast_id');
    if (isOwnershipError(ownership)) return ownership.error;
    const event = ownership.event;

    const broadcastId = event.youtube_broadcast_id;
    if (!broadcastId) {
      return NextResponse.json({ success: false, error: 'No YouTube broadcast associated with this event' }, { status: 400 });
    }

    // 2. Get YouTube Access Token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
        grant_type: "refresh_token",
      }),
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`Google OAuth token refresh failed (${tokenRes.status}): ${errText}`);
    }
    const tokenData = await tokenRes.json();
    const accessToken: string | undefined = tokenData.access_token;
    if (!accessToken) {
      throw new Error('Google OAuth token refresh succeeded but returned no access_token');
    }

    const newTitle = isLive ? `🔴 LIVE NOW | ${title}` : title.replace('🔴 LIVE NOW | ', '');

    // 3. Update Broadcast Title — only set scheduledStartTime when going live,
    //    not when toggling off (resetting it to "now" would corrupt the broadcast timeline)
    const snippet: Record<string, string> = { title: newTitle };
    if (isLive) snippet.scheduledStartTime = new Date().toISOString();

    const updateRes = await fetch("https://youtube.googleapis.com/youtube/v3/liveBroadcasts?part=snippet", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: broadcastId, snippet }),
    });

    const data = await updateRes.json();
    if (!updateRes.ok) throw new Error(JSON.stringify(data));

    // 4. Sync Status back to DB — scoped by the verified event id and studio
    await supabaseAdmin
      .from('events')
      .update({ youtube_status: isLive ? 'live' : 'completed' })
      .eq('id', event.id)
      .eq('studio_id', auth.studioId);

    return NextResponse.json({ success: true, newTitle });
  } catch (error: any) {
    console.error("YouTube Title Update Failed:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
