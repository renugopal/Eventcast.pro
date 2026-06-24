import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '../eventcast-admin/.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const SLUG = 'bhargavaram-sasiram-chowdary-dhoti-ceremony';
const PHOTOGRAPHER_ID = '047ebcde-a1e2-4485-b40b-7ec1ddd2078c';

const eventPayload = {
  slug: SLUG,
  event_type: 'Dhoti Ceremony',
  groom_name: 'Bhargavaram Chowdary',
  bride_name: 'Sasiram Chowdary',
  event_date: '2026-06-27',
  event_time: '10:00',
  timer_target_time: '10:00',
  show_timer: true,
  venue_name: 'JB Garden, Dharanikota, Amaravathi.',
  venue_map_link: 'https://maps.app.goo.gl/KX2uKJwadV17tgPi7',
  thumbnail_url:
    'https://pub-fa013cc979d8410e9d307bd2c9e6ecf2.r2.dev/thumbnails/bhargavaram-sasiram-chowdary-dhoti-ceremony/seo_thumbnail.png',
  invitation_video_url:
    'https://pub-fa013cc979d8410e9d307bd2c9e6ecf2.r2.dev/events/bhargavaram-sasiram-chowdary-dhoti-ceremony/invitation.mp4',
  gallery_urls: [],
  vod_link: 'https://youtube.com/live/xWoir_5jP7w',
  youtube_url: 'https://youtube.com/live/xWoir_5jP7w',
  youtube_broadcast_id: 'xWoir_5jP7w',
  youtube_stream_key: 'u9te-c8pd-z580-5dh5-534t',
  template_id: 'dhoti-ceremony-template-01',
  photographer_id: PHOTOGRAPHER_ID,
  custom_initials: 'B & S',
  hide_loader_photo: false,
  restreamer_ingest_url: `rtmp://34.100.142.25/${SLUG}`,
  restreamer_stream_key: 'live',
  restreamer_hls_url: `https://media.eventcast.pro/memfs/${SLUG}.m3u8`,
  restreamer_player_url: `https://media.eventcast.pro/ui/player.html?query=memfs/${SLUG}.m3u8`,
  deployment_status: 'live',
  deployed_at: new Date().toISOString(),
  guest_photo_wall_enabled: true,
  guest_photo_limit: 50,
};

async function supabaseFetch(pathSuffix, options = {}) {
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
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${res.status} ${pathSuffix}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const existing = await supabaseFetch(
    `events?slug=eq.${encodeURIComponent(SLUG)}&select=id,slug`,
    { prefer: 'return=representation' }
  );

  if (existing?.length) {
    console.log('Event already exists:', existing[0].id);
    const updated = await supabaseFetch(`events?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify(eventPayload),
    });
    console.log('Updated event:', updated[0]?.id);
    console.log('URL: https://eventcast.pro/events/' + SLUG);
    return updated[0];
  }

  const { data: photographer } = await supabaseFetch(
    `photographers?id=eq.${PHOTOGRAPHER_ID}&select=studio_id`,
    { prefer: 'return=representation' }
  ).then((rows) => ({ data: rows?.[0] }));

  if (!photographer?.studio_id) {
    throw new Error('Could not resolve studio_id from photographer');
  }

  const inserted = await supabaseFetch('events', {
    method: 'POST',
    body: JSON.stringify({ ...eventPayload, studio_id: photographer.studio_id }),
  });

  console.log('Created event:', inserted[0]?.id);
  console.log('URL: https://eventcast.pro/events/' + SLUG);
  return inserted[0];
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
