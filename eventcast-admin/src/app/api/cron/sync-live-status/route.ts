import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'edge';

export async function GET(req: Request) {
  try {
    // 1. Security Check (Optional but recommended)
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get('secret');
    if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!supabaseAdmin) {
      throw new Error('Supabase Admin client not initialized');
    }

    // 2. Fetch all events with YouTube IDs that are not 'completed'
    const { data: events, error: fetchError } = await supabaseAdmin
      .from('events')
      .select('id, groom_name, celebrant_name, bride_name, event_type, event_date, timer_target_time, youtube_broadcast_id, youtube_status')
      .not('youtube_broadcast_id', 'is', null)
      .neq('youtube_status', 'completed');

    if (fetchError) throw fetchError;

    const now = new Date();
    const results = [];

    // 3. YouTube Auth (Once per cron run)
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
      throw new Error(`Google token refresh failed (${tokenRes.status}): ${errText}`);
    }
    const tokenData = await tokenRes.json();
    const accessToken: string | undefined = tokenData.access_token;
    if (!accessToken) {
      throw new Error('Google token refresh succeeded but returned no access_token');
    }

    for (const event of events) {
      try {
        // Construct event start time
        // event_date is YYYY-MM-DD, timer_target_time is HH:mm
        const startTimeStr = `${event.event_date}T${event.timer_target_time || '00:00'}`;
        const startTime = new Date(startTimeStr);
        const endTime = new Date(startTime.getTime() + 12 * 60 * 60 * 1000); // 12 hours later

        let shouldUpdateYoutube = false;
        let newStatus = event.youtube_status;
        let isLiveTitle = false;

        if (now >= startTime && now < endTime) {
          // Event should be LIVE
          if (event.youtube_status !== 'live') {
            shouldUpdateYoutube = true;
            newStatus = 'live';
            isLiveTitle = true;
          }
        } else if (now >= endTime) {
          // Event should be COMPLETED
          if (event.youtube_status === 'live') {
            shouldUpdateYoutube = true;
            newStatus = 'completed';
            isLiveTitle = false;
          }
        }

        if (shouldUpdateYoutube) {
          const heart = (event.event_type || '').toLowerCase().includes('wedding') ? '❤️' : '✨';
          const baseTitle = `${event.groom_name || event.celebrant_name} ${heart} ${event.bride_name || 'Family'} ${event.event_type} Live | ${event.event_date}`;
          const finalTitle = isLiveTitle ? `🔴 LIVE NOW | ${baseTitle}` : baseTitle;

          // Update YouTube
          const ytRes = await fetch("https://youtube.googleapis.com/youtube/v3/liveBroadcasts?part=snippet", {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              id: event.youtube_broadcast_id,
              snippet: {
                title: finalTitle,
                scheduledStartTime: startTime.toISOString(),
              },
            }),
          });

          if (ytRes.ok) {
            // Update DB
            await supabaseAdmin
              .from('events')
              .update({ youtube_status: newStatus })
              .eq('id', event.id);
            
            results.push({ id: event.id, status: newStatus, title: finalTitle });
          }
        }
      } catch (err) {
        console.error(`Failed to sync event ${event.id}:`, err);
      }
    }

    return NextResponse.json({ success: true, processed: results.length, details: results });
  } catch (error: any) {
    console.error("Cron Job Failed:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
