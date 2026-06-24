import fs from 'fs';

const RESTREAMER_URL = 'https://media.eventcast.pro';
const RESTREAMER_USERNAME = 'admin';
const RESTREAMER_PASSWORD = 'R3nug0pa!';

const SLUG = 'bhargavaram-sasiram-chowdary-dhoti-ceremony';
const YOUTUBE_STREAM_KEY = 'u9te-c8pd-z580-5dh5-534t';
const CONFIG_PATH = 'D:/Eventcast.pro/events/bhargavaram-sasiram-chowdary-dhoti ceremony/config.js';

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

async function setupRestreamer(token) {
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
      address: `rtmp://a.rtmp.youtube.com/live2/${YOUTUBE_STREAM_KEY}`,
      options: ['-c:v', 'copy', '-c:a', 'copy', '-f', 'flv'],
    },
  ];

  const processPayload = {
    id: SLUG,
    autostart: true,
    reconnect: true,
    metadata: {
      'restreamer-ui': {
        channel: {
          id: SLUG,
          name: 'Bhargavaram Sasiram Chowdary Dhoti Ceremony',
        },
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

  if (!res.ok) throw new Error('Restreamer setup failed: ' + await res.text());

  return {
    ingestUrl: `rtmp://34.100.142.25/${SLUG}`,
    streamKey: 'live',
    hlsUrl: `${RESTREAMER_URL}/memfs/${SLUG}.m3u8`,
    playerUrl: `${RESTREAMER_URL}/ui/player.html?query=memfs/${SLUG}.m3u8`,
  };
}

async function main() {
  const token = await getRestreamerToken();
  const data = await setupRestreamer(token);

  let config = fs.readFileSync(CONFIG_PATH, 'utf8');
  if (!config.includes('restreamerUrl:')) {
    config = config.replace(
      /youtubeId:/,
      `restreamerUrl: "${data.hlsUrl}",\n    restreamerPlayer: "${data.playerUrl}",\n    youtubeId:`,
    );
  } else {
    config = config.replace(/restreamerUrl:\s*"[^"]*"/, `restreamerUrl: "${data.hlsUrl}"`);
    config = config.replace(/restreamerPlayer:\s*"[^"]*"/, `restreamerPlayer: "${data.playerUrl}"`);
  }
  fs.writeFileSync(CONFIG_PATH, config);

  console.log('=== RESTREAMER READY ===');
  console.log('SLUG:', SLUG);
  console.log('OBS Server URL:', data.ingestUrl);
  console.log('OBS Stream Key:', data.streamKey);
  console.log('HLS URL:', data.hlsUrl);
  console.log('YouTube forward: enabled via stream key');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
