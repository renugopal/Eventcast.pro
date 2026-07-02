/**
 * Provision Phani & Neelima wedding event.
 * Run: node scratch/setup_phani_neelima_wedding.mjs
 */
import fs from 'fs';
import crypto from 'crypto';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, 'eventcast-admin/.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_CLIENT_ID = env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = env.GOOGLE_REFRESH_TOKEN;
const RESTREAMER_URL = (env.RESTREAMER_URL || 'https://media.eventcast.pro').replace(/\/$/, '');
const RESTREAMER_USERNAME = env.RESTREAMER_USERNAME || 'admin';
const RESTREAMER_PASSWORD = env.RESTREAMER_PASSWORD;
const R2_ACCESS_KEY = env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = env.R2_BUCKET_NAME;
const R2_ENDPOINT = env.R2_S3_ENDPOINT;
const R2_PUBLIC_URL = env.R2_PUBLIC_URL;

const SLUG = 'phani-neelima-wedding';
const STUDIO_PHOTOGRAPHER_ID = '047ebcde-a1e2-4485-b40b-7ec1ddd2078c';

const SEO_IMAGE = path.join(
  ROOT,
  '../.cursor/projects/d-Eventcast-pro/assets/c__Users_Renugopal_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_4th_Yaswanth-cabb54f1-2635-4a02-9f9f-37af87c504ac.png',
);
const SEO_IMAGE_ALT =
  'C:\\Users\\Renugopal\\.cursor\\projects\\d-Eventcast-pro\\assets\\c__Users_Renugopal_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_4th_Yaswanth-cabb54f1-2635-4a02-9f9f-37af87c504ac.png';

const NAVIGATE_MAP = 'https://maps.app.goo.gl/YBYogVNLXg8AeyaC7';
const EMBED_MAP =
  'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3841.3804549892793!2d80.1251552!3d15.7037099!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3a4a57b416a1cdcd%3A0x8959618aea31aefb!2sReddypalem%2C%20Pamidipadu%2C%20Andhra%20Pradesh%20523183!5e0!3m2!1sen!2sin!4v1782987658237!5m2!1sen!2sin';
const TIME_SUBTEXT = '(Early hours of 5th)';

const YT_TITLE = 'Phani ❤️ Neelima Wedding Live | 4th July';
const YT_DESCRIPTION = `Welcome to the Wedding Live of Phani & Neelima 💍💐

Join us live and be part of this beautiful wedding celebration as the couple begins a wonderful new chapter in their lives.

Your love, blessings, and best wishes mean a lot to the couple and their families.

Thank you for joining us and celebrating this special occasion.

#Phani #Neelima #WeddingLive #TeluguWedding #SouthIndianWedding`;

const YT_TAGS = [
  'Phani Neelima wedding',
  'Phani wedding live',
  'Neelima wedding live',
  'Phani Neelima wedding live',
  'Telugu wedding live',
  'South Indian wedding ceremony',
  'Krishnamrajuvari Palem wedding',
  'Indian wedding live streaming',
  'Telugu wedding ceremony live',
  'wedding muhurtham live',
];

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}
function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate = hmac('AWS4' + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function putR2(filePath, objectKey, contentType) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileSize = fileBuffer.length;
  const endpointUrl = new URL(R2_ENDPOINT);
  const host = endpointUrl.hostname;
  const region = 'auto';
  const service = 's3';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(fileBuffer);
  const canonicalUri = `/${R2_BUCKET}/${objectKey}`;
  const canonicalHeaders =
    `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256(canonicalRequest)}`;
  const signingKey = getSigningKey(R2_SECRET_KEY, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authHeader = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path: canonicalUri,
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Content-Length': fileSize,
          'x-amz-date': amzDate,
          'x-amz-content-sha256': payloadHash,
          Authorization: authHeader,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(`${R2_PUBLIC_URL}/${objectKey}`);
          } else {
            reject(new Error(`R2 upload failed ${objectKey}: ${res.statusCode} ${body}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });
}

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

async function uploadAssets() {
  const seoPath = fs.existsSync(SEO_IMAGE) ? SEO_IMAGE : SEO_IMAGE_ALT;
  if (!fs.existsSync(seoPath)) throw new Error('SEO thumbnail not found: ' + seoPath);

  console.log('Uploading SEO thumbnail...');
  const thumbUrl = await putR2(
    seoPath,
    `thumbnails/${SLUG}/seo_thumbnail.png`,
    'image/png',
  );
  console.log('Thumbnail:', thumbUrl);

  return { thumbUrl, galleryUrls: [] };
}

async function createYouTubeLive(token, thumbUrl) {
  console.log('Creating YouTube broadcast + stream...');
  const scheduledStart = new Date('2026-07-04T19:30:00+05:30').toISOString();

  const broadcastRes = await fetch(
    'https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snippet: {
          title: YT_TITLE,
          description: YT_DESCRIPTION,
          scheduledStartTime: scheduledStart,
          categoryId: '22',
          tags: YT_TAGS,
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
    },
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
    },
  );
  const stream = await streamRes.json();
  if (stream.error) throw new Error('Stream error: ' + JSON.stringify(stream.error));

  const bindRes = await fetch(
    `https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?id=${broadcast.id}&streamId=${stream.id}&part=id,contentDetails`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
  );
  const bindData = await bindRes.json();
  if (bindData.error) throw new Error('Bind error: ' + JSON.stringify(bindData.error));

  if (thumbUrl && broadcast.id) {
    try {
      const thumbReq = await fetch(thumbUrl);
      const thumbBlob = await thumbReq.arrayBuffer();
      const thumbUploadRes = await fetch(
        `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${broadcast.id}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': thumbReq.headers.get('content-type') || 'image/png',
          },
          body: thumbBlob,
        },
      );
      if (!thumbUploadRes.ok) {
        console.warn('YouTube thumbnail upload failed:', await thumbUploadRes.text());
      } else {
        console.log('YouTube thumbnail set.');
      }
    } catch (err) {
      console.warn('YouTube thumbnail error:', err.message);
    }
  }

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

function buildProcessPayload(slug, displayName, youtubeStreamKey) {
  return {
    id: slug,
    autostart: true,
    reconnect: true,
    metadata: {
      'restreamer-ui': {
        channel: { id: slug, name: displayName },
      },
    },
    input: [{ id: '0', address: `{rtmp,name=${slug}/live}`, options: ['-fflags', '+genpts'] }],
    output: [
      {
        id: 'hls',
        address: '{memfs}/{processid}.m3u8',
        options: [
          '-map', '0:v:0', '-map', '0:a:0',
          '-c:v', 'copy', '-c:a', 'copy',
          '-f', 'hls', '-hls_time', '4', '-hls_list_size', '10',
          '-hls_flags', 'independent_segments+delete_segments',
        ],
      },
      {
        id: 'vod-record',
        address: '{diskfs}/{processid}.mp4',
        options: [
          '-map', '0:v:0', '-map', '0:a:0',
          '-c:v', 'copy', '-c:a', 'copy',
          '-f', 'mp4', '-movflags', '+faststart',
        ],
      },
      {
        id: 'youtube',
        address: `rtmp://a.rtmp.youtube.com/live2/${youtubeStreamKey}`,
        options: ['-c:v', 'copy', '-c:a', 'copy', '-f', 'flv'],
      },
    ],
  };
}

async function setupRestreamer(token, youtubeStreamKey) {
  console.log('Setting up Restreamer channel...');
  const payload = buildProcessPayload(
    SLUG,
    'Phani & Neelima Wedding',
    youtubeStreamKey,
  );

  let res = await fetch(`${RESTREAMER_URL}/api/v3/process`, {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (res.status === 409 || res.status === 400) {
    const text = await res.text();
    if (res.status === 409 || text.includes('already exists')) {
      res = await fetch(`${RESTREAMER_URL}/api/v3/process/${SLUG}`, {
        method: 'PUT',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

async function registerEvent({ thumbUrl, galleryUrls, yt, rs, photographerId, studioId }) {
  const payload = {
    slug: SLUG,
    event_type: 'Wedding',
    groom_name: 'Phani',
    bride_name: 'Neelima',
    event_date: '2026-07-04',
    event_time: '00:45',
    timer_target_time: '2026-07-05T00:45',
    show_timer: true,
    venue_name: 'At our Residence, Krishnamrajuvari Palem',
    venue_map_link: `${NAVIGATE_MAP}\n${EMBED_MAP}\n__timeSubtext__:${TIME_SUBTEXT}`,
    thumbnail_url: thumbUrl,
    invitation_video_url: null,
    gallery_urls: galleryUrls,
    loader_photo_url: thumbUrl,
    vod_link: `https://youtube.com/live/${yt.youtubeId}`,
    youtube_url: `https://youtube.com/live/${yt.youtubeId}`,
    youtube_broadcast_id: yt.youtubeId,
    youtube_stream_key: yt.streamKey,
    template_id: 'wedding-template-01',
    photographer_id: photographerId,
    custom_initials: 'P & N',
    hide_loader_photo: false,
    restreamer_ingest_url: rs.ingestUrl,
    restreamer_stream_key: rs.streamKey,
    restreamer_hls_url: rs.hlsUrl,
    restreamer_player_url: rs.playerUrl,
    restreamer_url: rs.hlsUrl,
    deployment_status: 'live',
    deployed_at: new Date().toISOString(),
    guest_photo_wall_enabled: true,
    guest_photo_limit: 50,
    privacy_status: 'Public (Visible Everywhere)',
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

  const inserted = await sb('events', {
    method: 'POST',
    body: JSON.stringify({ ...payload, studio_id: studioId }),
  });
  return inserted[0];
}

async function main() {
  console.log('=== Phani & Neelima Wedding Setup ===\n');

  const photographerRows = await sb(
    `photographers?id=eq.${STUDIO_PHOTOGRAPHER_ID}&select=id,studio_id`,
    { prefer: 'return=representation' },
  );
  const photographer = photographerRows?.[0];
  if (!photographer?.studio_id) throw new Error('Could not resolve studio_id');

  const { thumbUrl, galleryUrls } = await uploadAssets();

  const googleToken = await getGoogleToken();
  const yt = await createYouTubeLive(googleToken, thumbUrl);
  console.log('YouTube broadcast ID:', yt.youtubeId);
  console.log('YouTube URL: https://youtube.com/live/' + yt.youtubeId);

  const restreamerToken = await getRestreamerToken();
  const rs = await setupRestreamer(restreamerToken, yt.streamKey);

  const eventRow = await registerEvent({
    thumbUrl,
    galleryUrls,
    yt,
    rs,
    photographerId: photographer.id,
    studioId: photographer.studio_id,
  });

  console.log('\n=== EVENT READY ===');
  console.log('Event ID:     ', eventRow.id);
  console.log('Page URL:     https://eventcast.pro/events/' + SLUG);
  console.log('YouTube:      https://youtube.com/live/' + yt.youtubeId);
  console.log('OBS Server:   ' + rs.ingestUrl);
  console.log('OBS Key:      ' + rs.streamKey);
  console.log('HLS:          https://eventcast.pro/events/' + SLUG + '/hls/' + SLUG + '.m3u8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
