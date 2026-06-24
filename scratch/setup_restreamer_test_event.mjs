/**
 * Option A test event: YouTube Live + Restreamer + Supabase (worker URL only).
 * Run: node scratch/setup_restreamer_test_event.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '../eventcast-admin/.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = env.GOOGLE_REFRESH_TOKEN;
const RESTREAMER_URL = env.RESTREAMER_URL || 'https://media.eventcast.pro';
const RESTREAMER_USERNAME = env.RESTREAMER_USERNAME || 'admin';
const RESTREAMER_PASSWORD = env.RESTREAMER_PASSWORD;

const SLUG = 'eventcast-restreamer-test';
const PHOTOGRAPHER_ID = '047ebcde-a1e2-4485-b40b-7ec1ddd2078c'; // Ashok — default studio

const ASSET_BASE = 'https://eventcast.pro/wedding-template-01';
const THUMB_URL = `${ASSET_BASE}/assets/thumb.jpeg`;

const YT_TITLE = 'Eventcast Restreamer Test Live | Jun 2026';
const YT_DESCRIPTION = `Internal test stream for Eventcast.pro Restreamer + YouTube relay verification.

OBS → Restreamer → HLS + YouTube

#EventcastTest #LiveStreamTest`;

// Schedule ~30 min from now (IST)
const scheduled = new Date(Date.now() + 30 * 60 * 1000);
const SCHEDULED_START = scheduled.toISOString();

async function sb(pathSuffix, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathSuffix}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${res.status} ${pathSuffix}: ${JSON.stringify(data)}`);
  return data;
}

async function getGoogleToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Google token failed: ' + JSON.stringify(data));
  return data.access_token;
}

async function createYouTubeLive(token) {
  console.log('Creating YouTube broadcast + stream...');
  const broadcastRes = await fetch(
    'https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snippet: {
          title: YT_TITLE,
          description: YT_DESCRIPTION,
          scheduledStartTime: SCHEDULED_START,
          categoryId: '22',
        },
        status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false },
        contentDetails: {
          enableAutoStart: true,
          enableAutoStop: false,
          enableDvr: true,
          enableEmbed: true,
          recordFromStart: true,
          latencyPreference: 'normal',
        },
      }),
    }
  );
  const broadcast = await broadcastRes.json();
  if (broadcast.error) throw new Error('Broadcast error: ' + JSON.stringify(broadcast.error));

  const streamRes = await fetch(
    'https://www.googleapis.com/youtube/v3/liveStreams?part=snippet,cdn,contentDetails',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snippet: { title: YT_TITLE },
        cdn: { frameRate: '30fps', ingestionType: 'rtmp', resolution: '1080p' },
      }),
    }
  );
  const stream = await streamRes.json();
  if (stream.error) throw new Error('Stream error: ' + JSON.stringify(stream.error));

  const bindRes = await fetch(
    `https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?id=${broadcast.id}&streamId=${stream.id}&part=id,contentDetails`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } }
  );
  const bindData = await bindRes.json();
  if (bindData.error) throw new Error('Bind error: ' + JSON.stringify(bindData.error));

  return {
    youtubeId: broadcast.id,
    streamKey: stream.cdn.ingestionInfo.streamName,
  };
}

async function getRestreamerToken() {
  const res = await fetch(`${RESTREAMER_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: RESTREAMER_USERNAME, password: RESTREAMER_PASSWORD }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Restreamer login failed: ' + JSON.stringify(data));
  return `Bearer ${data.access_token}`;
}

async function setupRestreamer(token, youtubeStreamKey) {
  console.log('Setting up Restreamer channel...');
  const outputs = [
    {
      id: 'hls',
      address: '{memfs}/{processid}.m3u8',
      options: [
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
        '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0',
        '-hls_playlist_type', 'event', '-hls_flags', 'independent_segments',
      ],
    },
    {
      id: 'youtube',
      address: `rtmp://a.rtmp.youtube.com/live2/${youtubeStreamKey}`,
      options: ['-c:v', 'copy', '-c:a', 'copy', '-f', 'flv'],
    },
  ];

  const processPayload = {
    id: SLUG,
    autostart: true,
    reconnect: true,
    metadata: {
      'restreamer-ui': {
        channel: { id: SLUG, name: 'Eventcast Restreamer Test' },
      },
    },
    input: [{ id: '0', address: `{rtmp,name=${SLUG}/live}`, options: ['-fflags', '+genpts'] }],
    output: outputs,
  };

  let res = await fetch(`${RESTREAMER_URL}/api/v3/process`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify(processPayload),
  });

  if (res.status === 409 || res.status === 400) {
    const text = await res.text();
    if (res.status === 409 || text.includes('already exists')) {
      console.log('Channel exists — updating...');
      res = await fetch(`${RESTREAMER_URL}/api/v3/process/${SLUG}`, {
        method: 'PUT',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify(processPayload),
      });
    } else if (!res.ok) {
      throw new Error(text);
    }
  }

  if (!res.ok) throw new Error('Restreamer setup failed: ' + (await res.text()));

  return {
    ingestUrl: `rtmp://34.100.142.25/${SLUG}`,
    streamKey: 'live',
    hlsUrl: `${RESTREAMER_URL}/memfs/${SLUG}.m3u8`,
    playerUrl: `${RESTREAMER_URL}/memfs/${SLUG}.m3u8`,
  };
}

async function registerEvent(yt, rs) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const eventDate = tomorrow.toISOString().slice(0, 10);

  const payload = {
    slug: SLUG,
    event_type: 'Wedding',
    groom_name: 'Test',
    bride_name: 'Stream',
    event_date: eventDate,
    event_time: '10:00',
    timer_target_time: '09:30',
    show_timer: true,
    venue_name: 'Eventcast Test Venue',
    thumbnail_url: THUMB_URL,
    invitation_video_url: '',
    gallery_urls: [
      `${ASSET_BASE}/assets/gallery_1.png`,
      `${ASSET_BASE}/assets/gallery_2.png`,
    ],
    vod_link: `https://youtube.com/live/${yt.youtubeId}`,
    youtube_url: `https://youtube.com/live/${yt.youtubeId}`,
    youtube_broadcast_id: yt.youtubeId,
    youtube_stream_key: yt.streamKey,
    template_id: 'wedding-template-01',
    photographer_id: PHOTOGRAPHER_ID,
    custom_initials: 'T & S',
    hide_loader_photo: true,
    restreamer_ingest_url: rs.ingestUrl,
    restreamer_stream_key: rs.streamKey,
    restreamer_hls_url: rs.hlsUrl,
    restreamer_player_url: rs.playerUrl,
    restreamer_url: rs.hlsUrl,
    deployment_status: 'live',
    deployed_at: new Date().toISOString(),
    guest_photo_wall_enabled: false,
    guest_photo_limit: 50,
  };

  const existing = await sb(`events?slug=eq.${encodeURIComponent(SLUG)}&select=id`, {
    prefer: 'return=representation',
  });

  if (existing?.length) {
    const updated = await sb(`events?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return updated[0];
  }

  const photographerRows = await sb(`photographers?id=eq.${PHOTOGRAPHER_ID}&select=studio_id`);
  const studioId = photographerRows?.[0]?.studio_id;
  if (!studioId) throw new Error('Could not resolve studio_id');

  const inserted = await sb('events', {
    method: 'POST',
    body: JSON.stringify({ ...payload, studio_id: studioId }),
  });
  return inserted[0];
}

async function main() {
  console.log('=== Eventcast Restreamer Test Event Setup ===\n');

  const googleToken = await getGoogleToken();
  const yt = await createYouTubeLive(googleToken);
  console.log('YouTube broadcast ID:', yt.youtubeId);
  console.log('YouTube URL: https://youtube.com/live/' + yt.youtubeId);

  const restreamerToken = await getRestreamerToken();
  const rs = await setupRestreamer(restreamerToken, yt.streamKey);

  const eventRow = await registerEvent(yt, rs);
  console.log('Supabase event ID:', eventRow.id);

  console.log('\n=== TEST EVENT READY ===');
  console.log('Page URL:     https://eventcast.pro/events/' + SLUG);
  console.log('YouTube:      https://youtube.com/live/' + yt.youtubeId);
  console.log('OBS Server:   ' + rs.ingestUrl);
  console.log('OBS Key:      ' + rs.streamKey);
  console.log('HLS:          ' + rs.hlsUrl);
  console.log('Restreamer UI:' + rs.playerUrl);
  console.log('\nNext: Open OBS → Start Streaming → verify HLS HEAD 200 + page player.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
