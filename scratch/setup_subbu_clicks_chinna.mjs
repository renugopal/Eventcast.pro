import fs from 'fs';
import crypto from 'crypto';
import https from 'https';
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
const ACCESS_KEY = env.R2_ACCESS_KEY_ID;
const SECRET_KEY = env.R2_SECRET_ACCESS_KEY;
const BUCKET = env.R2_BUCKET_NAME;
const ENDPOINT = env.R2_S3_ENDPOINT;
const PUBLIC_URL = env.R2_PUBLIC_URL;

const LOGO_PATH = path.join(__dirname, 'subbu_clicks_logo.png');
const LOGO_KEY = 'photographers/subbu-clicks/logo.png';
const EVENT_ID = 'ef219434-713e-4488-858e-e7ce9c2f782b';
const STUDIO_ID = '5ceff67d-3f2f-4427-a001-76898e733f24';

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }
function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }
function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate = hmac('AWS4' + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function putObject(filePath, objectKey, contentType) {
  const fileBuffer = fs.readFileSync(filePath);
  const endpointUrl = new globalThis.URL(ENDPOINT);
  const host = endpointUrl.hostname;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(fileBuffer);
  const canonicalUri = `/${BUCKET}/${objectKey}`;
  const canonicalHeaders =
    `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256(canonicalRequest)}`;
  const signingKey = getSigningKey(SECRET_KEY, dateStamp, 'auto', 's3');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authHeader = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      path: canonicalUri,
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileBuffer.length,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        Authorization: authHeader,
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(`${PUBLIC_URL}/${objectKey}`);
        else reject(new Error(`R2 upload failed: ${res.statusCode} ${body}`));
      });
    });
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

async function applyViewCountRpc() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../eventcast-admin/supabase/migrations/0016_public_event_view_count.sql'),
    'utf8'
  );
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  if (res.ok) {
    console.log('RPC migration applied via exec_sql');
    return;
  }
  // Fallback: try calling new RPC (may already exist from manual apply)
  const test = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_event_view_count`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_event_id: EVENT_ID }),
  });
  if (test.ok) {
    console.log('get_public_event_view_count already exists');
    return;
  }
  console.warn('Could not auto-apply RPC migration — run 0016_public_event_view_count.sql in Supabase SQL Editor');
}

async function main() {
  console.log('Uploading Subbu Clicks logo...');
  const logoUrl = await putObject(LOGO_PATH, LOGO_KEY, 'image/png');
  console.log('Logo URL:', logoUrl);

  const existing = await sb(
    "photographers?or=(name.ilike.Subbu Clicks,studio_name.ilike.Subbu Clicks)&select=id",
  );

  const photographerPayload = {
    name: 'Subbu',
    studio_name: 'Subbu Clicks Photography',
    nickname: 'Subbu',
    city: 'Chilakaluripet',
    phone_number: '70 1380 6221',
    instagram_url: null,
    logo_url: logoUrl,
    studio_id: STUDIO_ID,
  };

  let photographerId;
  if (existing?.length) {
    photographerId = existing[0].id;
    await sb(`photographers?id=eq.${photographerId}`, {
      method: 'PATCH',
      body: JSON.stringify(photographerPayload),
    });
    console.log('Updated photographer:', photographerId);
  } else {
    const inserted = await sb('photographers', {
      method: 'POST',
      body: JSON.stringify(photographerPayload),
    });
    photographerId = inserted[0].id;
    console.log('Created photographer:', photographerId);
  }

  await sb(`events?id=eq.${EVENT_ID}`, {
    method: 'PATCH',
    body: JSON.stringify({
      photographer_id: photographerId,
      venue_name: 'Sri Convention, Chilakaluripet',
    }),
  });
  console.log('Event updated with Subbu Clicks photographer');

  await applyViewCountRpc();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
