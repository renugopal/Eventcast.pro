import fs from 'fs';
import path from 'path';

const envPath = path.resolve('D:/Eventcast.pro/eventcast-admin/.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  });
}

const CONFIG_PATH = 'D:/Eventcast.pro/events/bhargavaram-sasiram-chowdary-dhoti ceremony/config.js';
const THUMB_PATH = 'D:/Eventcast.pro/events/bhargavaram-sasiram-chowdary-dhoti ceremony/assets/seo_thumbnail.png';

const TITLE = 'Bhargavaram Chowdary & Sasiram Chowdary | Dhoti Ceremony Live';
const DESCRIPTION = 'Join us live and be part of this special traditional celebration filled with joy, family blessings, and cultural significance.';
const TAGS = ['dhoti ceremony', 'live stream', 'bhargavaram chowdary', 'sasiram chowdary', 'amaravathi', 'telugu ceremony'];
const SCHEDULED_START = '2026-06-27T10:00:00+05:30';

async function getToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token error: ' + JSON.stringify(data));
  return data.access_token;
}

async function main() {
  const token = await getToken();
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const broadcastRes = await fetch('https://youtube.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      snippet: {
        title: TITLE,
        description: DESCRIPTION,
        scheduledStartTime: new Date(SCHEDULED_START).toISOString(),
        categoryId: '22',
        tags: TAGS,
      },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      contentDetails: {
        enableAutoStart: true,
        enableAutoStop: false,
        enableDvr: true,
        enableEmbed: true,
        recordFromStart: true,
        latencyPreference: 'normal',
      },
    }),
  });
  if (!broadcastRes.ok) throw new Error(await broadcastRes.text());
  const broadcast = await broadcastRes.json();

  const streamRes = await fetch('https://youtube.googleapis.com/youtube/v3/liveStreams?part=snippet,cdn,contentDetails', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      snippet: { title: TITLE },
      cdn: { frameRate: '60fps', ingestionType: 'rtmp', resolution: '1080p' },
    }),
  });
  if (!streamRes.ok) throw new Error(await streamRes.text());
  const stream = await streamRes.json();

  const bindRes = await fetch(`https://youtube.googleapis.com/youtube/v3/liveBroadcasts/bind?id=${broadcast.id}&streamId=${stream.id}&part=id,contentDetails`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!bindRes.ok) throw new Error(await bindRes.text());

  const thumbBuffer = fs.readFileSync(THUMB_PATH);
  const thumbRes = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${broadcast.id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
    body: thumbBuffer,
  });
  const thumbText = await thumbRes.text();
  if (!thumbRes.ok) console.warn('Thumbnail upload warning:', thumbText);
  else console.log('Thumbnail uploaded.');

  let config = fs.readFileSync(CONFIG_PATH, 'utf8');
  config = config.replace(/youtubeId:\s*""/, `youtubeId: "${broadcast.id}"`);
  fs.writeFileSync(CONFIG_PATH, config);

  console.log('=== SUCCESS ===');
  console.log('YouTube Broadcast ID:', broadcast.id);
  console.log('YouTube URL: https://youtube.com/live/' + broadcast.id);
  console.log('Stream Key:', stream.cdn?.ingestionInfo?.streamName);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
