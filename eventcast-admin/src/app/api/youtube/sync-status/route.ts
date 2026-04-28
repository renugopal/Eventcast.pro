export const runtime = 'edge';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET() {
  try {
    // 1. Fetch all upcoming or live events
    const { data: events, error: dbError } = await supabase
      .from('events')
      .select('*')
      .not('youtube_broadcast_id', 'is', null);

    if (dbError) throw dbError;

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
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const results = [];

    for (const event of events) {
      // 3. Check Broadcast Status on YouTube
      const ytRes = await fetch(`https://youtube.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status&id=${event.youtube_broadcast_id}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const ytData = await ytRes.json();
      
      if (ytData.items && ytData.items.length > 0) {
        const ytStatus = ytData.items[0].status.lifeCycleStatus; // 'live', 'ready', 'complete', etc.
        const currentTitle = ytData.items[0].snippet.title;
        
        const heart = event.event_type.toLowerCase().includes('wedding') ? '❤️' : '✨';
        const baseTitle = `${event.groom_name} ${heart} ${event.bride_name} ${event.event_type} Live | ${event.event_date}`;
        let finalTitle = baseTitle;

        if (ytStatus === 'live') {
          finalTitle = `🔴 LIVE NOW | ${baseTitle}`;
        } else {
          finalTitle = baseTitle;
        }

        // 4. Update Title if it changed
        if (currentTitle !== finalTitle) {
          await fetch("https://youtube.googleapis.com/youtube/v3/liveBroadcasts?part=snippet", {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              id: event.youtube_broadcast_id,
              snippet: {
                title: finalTitle,
                scheduledStartTime: ytData.items[0].snippet.scheduledStartTime,
                description: ytData.items[0].snippet.description,
                categoryId: '22'
              },
            }),
          });
          results.push({ id: event.id, status: ytStatus, titleUpdated: true });
        } else {
          results.push({ id: event.id, status: ytStatus, titleUpdated: false });
        }
      }
    }

    return NextResponse.json({ success: true, processed: results });
  } catch (error: any) {
    console.error("YouTube Status Sync Failed:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
