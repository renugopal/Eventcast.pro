import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const { groomName, brideName, celebrantName, eventType, eventDate, targetTime, venueName, thumbnailUrl, privacy } = await req.json();

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error("YouTube credentials missing.");
    }

    // 0. Get Access Token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    
    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error("Failed to refresh Google token: " + err);
    }
    
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const authHeader = {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    };

    // SEO Title: Names + Event Type + Date (formatted)
    const heart = eventType.toLowerCase().includes('wedding') ? '❤️' : '✨';

    // Format date: "2026-05-01" → "Friday, May 1st"
    let formattedEventDate = eventDate;
    if (eventDate) {
      const [y, m, d] = eventDate.split('-').map(Number);
      const dateObj = new Date(Date.UTC(y, m - 1, d));
      let fd = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(dateObj);
      const day = dateObj.getUTCDate();
      const suffix = (day % 10 === 1 && day !== 11) ? 'st' : (day % 10 === 2 && day !== 12) ? 'nd' : (day % 10 === 3 && day !== 13) ? 'rd' : 'th';
      formattedEventDate = fd.replace(String(day), day + suffix);
    }

    const isSinglePerson = !brideName || brideName.toLowerCase() === 'family';
    const mainName = isSinglePerson ? groomName : `${groomName} & ${brideName}`;
    const formattedEventType = eventType ? (eventType.charAt(0).toUpperCase() + eventType.slice(1)) : 'Event';
    
    const displayTitle = `${formattedEventType} of ${mainName} | Live Streaming`;
    
    // Webpage Short Description (sent in payload for HTML generation)
    const webpageDesc = `Join us live and celebrate this beautiful traditional occasion filled with love, blessings, culture, and family moments.`;

    const cleanHashtagEventType = formattedEventType.replace(/\s+/g, '');
    const cleanHashtagName = groomName.replace(/\s+/g, '');

    // YouTube Long Description
    const displayDescription = `✨ ${mainName} ${formattedEventType} ✨

Join us live and celebrate this beautiful traditional occasion filled with love, blessings, culture, and family moments.

Thank you for being part of our special day and showering your blessings on ${mainName}.

📡 Live Streaming
🎉 ${formattedEventType}${formattedEventType.toLowerCase() === 'half saree' ? ' / Langa Voni Function' : ''}
💖 Traditional Telugu Celebration

Don’t forget to Like, Share & Subscribe for more family event livestreams.

#${cleanHashtagEventType} #${cleanHashtagName} #LiveStreaming #TeluguFunction`;

    // 1. Create Live Broadcast
    const broadcastRes = await fetch("https://youtube.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails", {
      method: "POST",
      headers: authHeader,
      body: JSON.stringify({
        snippet: {
          title: displayTitle,
          description: displayDescription,
          scheduledStartTime: new Date(`${eventDate}T${targetTime || '09:00'}:00+05:30`).toISOString(),
          categoryId: '22',
          tags: [
            mainName,
            formattedEventType,
            `${formattedEventType} function`,
            formattedEventType.toLowerCase() === 'half saree' ? 'langa voni function' : '',
            `${formattedEventType} live`,
            `${formattedEventType} ceremony live`,
            'telugu function live',
            'traditional function',
            'indian traditional ceremony',
            'live streaming',
            'family function live',
            'telugu livestream',
            `${formattedEventType} event`,
            formattedEventType.toLowerCase() === 'half saree' ? 'pattu langa function' : '',
            formattedEventType.toLowerCase() === 'half saree' ? 'coming of age ceremony' : '',
            'south indian function',
            'telugu family event',
            'ceremony live stream',
            'live event',
            'youtube livestream'
          ].filter(Boolean)
        },
        status: {
          privacyStatus: privacy || 'public',
          selfDeclaredMadeForKids: false,
        },
        contentDetails: {
          enableAutoStart: true,
          enableAutoStop: false,
          enableDvr: true,
          enableContentEncryption: false,
          enableEmbed: true,
          recordFromStart: true,
          startWithLowLatency: false,
          latencyPreference: 'normal',
        }
      })
    });
    const broadcastData = await broadcastRes.json();
    if (!broadcastRes.ok) throw new Error(broadcastData.error?.message || "Failed to create broadcast");
    const broadcastId = broadcastData.id;

    // 2. Create New Live Stream Key
    const streamRes = await fetch("https://youtube.googleapis.com/youtube/v3/liveStreams?part=snippet,cdn,contentDetails", {
      method: "POST",
      headers: authHeader,
      body: JSON.stringify({
        snippet: { title: displayTitle },
        cdn: {
          frameRate: '60fps',
          ingestionType: 'rtmp',
          resolution: '1080p',
        }
      })
    });
    const streamData = await streamRes.json();
    if (!streamRes.ok) throw new Error(streamData.error?.message || "Failed to create stream");
    const streamId = streamData.id;
    const streamKey = streamData.cdn?.ingestionInfo?.streamName;

    // 3. Bind Broadcast to Stream Key
    const bindRes = await fetch(`https://youtube.googleapis.com/youtube/v3/liveBroadcasts/bind?id=${broadcastId}&part=id,contentDetails&streamId=${streamId}`, {
      method: "POST",
      headers: authHeader
    });
    if (!bindRes.ok) {
       const bindData = await bindRes.json();
       throw new Error(bindData.error?.message || "Failed to bind stream");
    }

    // 4. Set Thumbnail (Upload API)
    if (thumbnailUrl && broadcastId) {
      try {
        const thumbReq = await fetch(thumbnailUrl);
        const thumbBlob = await thumbReq.blob();
        
        const thumbUploadRes = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${broadcastId}`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": thumbReq.headers.get("content-type") || "image/jpeg"
          },
          body: thumbBlob
        });
        
        if (!thumbUploadRes.ok) {
           const errText = await thumbUploadRes.text();
           console.error("Thumbnail upload failed:", errText);
        }
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
    console.error("YouTube Automation Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
