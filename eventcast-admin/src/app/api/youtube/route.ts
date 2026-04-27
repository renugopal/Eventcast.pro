import { NextResponse } from 'next/server';
import { google } from 'googleapis';

export async function POST(req: Request) {
  try {
    const { groomName, brideName, celebrantName, eventType, eventDate, targetTime, venueName, thumbnailUrl, privacy } = await req.json();

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error("YouTube credentials missing.");
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // SEO Title: Names + Event Type + Date
    const displayTitle = `${groomName || celebrantName} & ${brideName || 'Family'} ${eventType} | ${eventDate}`;
    const displayDescription = `Live streaming of ${eventType} ceremony for ${groomName || celebrantName} & ${brideName || 'Family'}.\n\nDate: ${eventDate}\nVenue: ${venueName}\n\nWatching live on Eventcast.pro`;

    // 1. Create Live Broadcast
    const broadcastRes = await youtube.liveBroadcasts.insert({
      part: ['snippet', 'status', 'contentDetails'],
      requestBody: {
        snippet: {
          title: displayTitle,
          description: displayDescription,
          scheduledStartTime: new Date(`${eventDate}T${targetTime || '09:00'}:00+05:30`).toISOString(),
          categoryId: '22',
        },
        status: {
          privacyStatus: privacy || 'public',
          selfDeclaredMadeForKids: false,
        },
        contentDetails: {
          enableAutoStart: true,
          enableAutoStop: false, // Disabled as requested
          enableDvr: true,      // Enabled for Dual Stream/DVR
          enableContentEncryption: false,
          enableEmbed: true,
          recordFromStart: true,
          startWithLowLatency: false, // Changed to false for better stability
          latencyPreference: 'normal',
        }
      },
    });

    const broadcastId = broadcastRes.data.id;

    // 2. Create New Live Stream Key with same Title
    const streamRes = await youtube.liveStreams.insert({
      part: ['snippet', 'cdn', 'contentDetails'],
      requestBody: {
        snippet: {
          title: displayTitle, // Stream key name same as event title
        },
        cdn: {
          frameRate: '60fps',
          ingestionType: 'rtmp',
          resolution: '1080p',
        }
      }
    });

    const streamId = streamRes.data.id;
    const streamKey = streamRes.data.cdn?.ingestionInfo?.streamName;

    // 3. Bind Broadcast to Stream Key
    await youtube.liveBroadcasts.bind({
      id: broadcastId!,
      part: ['id', 'contentDetails'],
      streamId: streamId!,
    });

    // 4. Set Thumbnail
    if (thumbnailUrl && broadcastId) {
      try {
        const thumbRes = await fetch(thumbnailUrl);
        const buffer = await thumbRes.arrayBuffer();
        await youtube.thumbnails.set({
          videoId: broadcastId,
          media: {
            mimeType: 'image/jpeg',
            body: Buffer.from(buffer),
          },
        });
      } catch (thumbError) {
        console.error("Error setting thumbnail:", thumbError);
      }
    }

    return NextResponse.json({ 
      success: true, 
      broadcastId: broadcastId,
      streamKey: streamKey,
      youtubeUrl: `https://youtube.com/live/${broadcastId}`
    });

  } catch (error: any) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    console.error("YouTube Automation Detailed Error:", errorMsg);
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
