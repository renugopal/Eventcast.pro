export const runtime = 'edge';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { eventId, broadcastId, title, isLive } = await req.json();

    // 1. Get YouTube Access Token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
        grant_type: "refresh_token",
      }),
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const newTitle = isLive ? `🔴 LIVE NOW | ${title}` : title.replace('🔴 LIVE NOW | ', '');

    // 2. Update Broadcast Title
    const updateRes = await fetch("https://youtube.googleapis.com/youtube/v3/liveBroadcasts?part=snippet", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: broadcastId,
        snippet: {
          title: newTitle,
          scheduledStartTime: new Date().toISOString(), // Keep it current
        },
      }),
    });

    const data = await updateRes.json();
    if (!updateRes.ok) throw new Error(JSON.stringify(data));

    // 3. Sync Status back to DB
    const { supabaseAdmin } = await import('@/lib/supabase');
    if (supabaseAdmin && eventId) {
      await supabaseAdmin
        .from('events')
        .update({ youtube_status: isLive ? 'live' : 'completed' })
        .eq('id', eventId);
    }

    return NextResponse.json({ success: true, newTitle });
  } catch (error: any) {
    console.error("YouTube Title Update Failed:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
