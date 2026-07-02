/**
 * Link SR Photography (Yaswanth Bitra) to Phani & Neelima wedding.
 * Run: node scratch/setup_phani_sr_photography.mjs
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
const R2_ACCESS_KEY = env.R2_ACCESS_KEY_ID;
const R2_SECRET_KEY = env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = env.R2_BUCKET_NAME;
const R2_ENDPOINT = env.R2_S3_ENDPOINT;
const R2_PUBLIC_URL = env.R2_PUBLIC_URL;

const EVENT_SLUG = 'phani-neelima-wedding';
const SR_PHOTOGRAPHER_ID = '5b9b3a06-f7f5-429a-8a89-b2bdb580a19b';
const LOGO_KEY = 'photographers/sr-photography-yaswanth/logo.png';

const LOGO_IMAGE = path.join(
  ROOT,
  '../.cursor/projects/d-Eventcast-pro/assets/c__Users_Renugopal_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_Yashwanth_Sattenapalli-9fa52150-dff8-489d-902f-b3e64cef7a54.png',
);
const LOGO_IMAGE_ALT =
  'C:\\Users\\Renugopal\\.cursor\\projects\\d-Eventcast-pro\\assets\\c__Users_Renugopal_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_Yashwanth_Sattenapalli-9fa52150-dff8-489d-902f-b3e64cef7a54.png';

const INSTAGRAM_URL =
  'https://www.instagram.com/srphotographyforyou?igsh=ZjlzdGh4Z2pnNjI1&utm_source=qr';

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

async function main() {
  console.log('=== SR Photography for Phani & Neelima ===\n');

  const logoPath = fs.existsSync(LOGO_IMAGE) ? LOGO_IMAGE : LOGO_IMAGE_ALT;
  if (!fs.existsSync(logoPath)) throw new Error('Logo not found: ' + logoPath);

  console.log('Uploading SR Photography logo...');
  const logoUrl = await putR2(logoPath, LOGO_KEY, 'image/png');
  console.log('Logo URL:', logoUrl);

  const existing = await sb(
    `photographers?id=eq.${SR_PHOTOGRAPHER_ID}&select=id,studio_id`,
    { prefer: 'return=representation' },
  );
  if (!existing?.length) throw new Error('SR Photography photographer record not found');

  const photographerPayload = {
    name: 'YASWANTH BITRA',
    studio_name: 'SR PHOTOGRAPHY',
    nickname: 'Yaswanth Sattenapalli',
    city: 'Sattenapalli',
    phone_number: '8074 344 923',
    instagram_url: INSTAGRAM_URL,
    logo_url: logoUrl,
  };

  const updated = await sb(`photographers?id=eq.${SR_PHOTOGRAPHER_ID}`, {
    method: 'PATCH',
    body: JSON.stringify(photographerPayload),
  });
  console.log('Updated photographer:', updated[0].id);

  const events = await sb(
    `events?slug=eq.${encodeURIComponent(EVENT_SLUG)}&select=id`,
    { prefer: 'return=representation' },
  );
  if (!events?.length) throw new Error('Event not found: ' + EVENT_SLUG);

  const eventUpdated = await sb(`events?id=eq.${events[0].id}`, {
    method: 'PATCH',
    body: JSON.stringify({ photographer_id: SR_PHOTOGRAPHER_ID }),
  });
  console.log('Linked event:', eventUpdated[0].slug);

  console.log('\n=== DONE ===');
  console.log('Studio:     SR PHOTOGRAPHY');
  console.log('Name:       YASWANTH BITRA');
  console.log('Phone:      8074 344 923');
  console.log('Instagram: ', INSTAGRAM_URL);
  console.log('Page:       https://eventcast.pro/events/' + EVENT_SLUG);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
