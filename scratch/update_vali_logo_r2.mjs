/**
 * Upload Vali Images logo to R2 and update photographer record.
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

const VALI_PHOTOGRAPHER_ID = '8d5a00c6-ed3f-4902-a55e-1043456c695f';
const LOGO_PATH = path.join(
  ROOT,
  '../.cursor/projects/d-Eventcast-pro/assets/c__Users_Renugopal_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_Vali_Logo-1efb078c-1ccc-48bc-b931-b6ffefdd478a.png',
);
const LOGO_ALT =
  'C:\\Users\\Renugopal\\.cursor\\projects\\d-Eventcast-pro\\assets\\c__Users_Renugopal_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_Vali_Logo-1efb078c-1ccc-48bc-b931-b6ffefdd478a.png';

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
  const endpointUrl = new URL(env.R2_S3_ENDPOINT);
  const host = endpointUrl.hostname;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(fileBuffer);
  const canonicalUri = `/${env.R2_BUCKET_NAME}/${objectKey}`;
  const canonicalHeaders =
    `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256(canonicalRequest)}`;
  const signingKey = getSigningKey(env.R2_SECRET_ACCESS_KEY, dateStamp, 'auto', 's3');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authHeader = `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
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
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(`${env.R2_PUBLIC_URL}/${objectKey}`);
          } else {
            reject(new Error(`R2 upload failed: ${res.statusCode} ${body}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });
}

const logoPath = fs.existsSync(LOGO_PATH) ? LOGO_PATH : LOGO_ALT;
if (!fs.existsSync(logoPath)) throw new Error('Logo not found: ' + logoPath);

console.log('Uploading Vali logo...');
const logoUrl = await putR2(logoPath, 'photographers/vali-images/logo.png', 'image/png');
console.log('Logo URL:', logoUrl);

const res = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/photographers?id=eq.${VALI_PHOTOGRAPHER_ID}`,
  {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ logo_url: logoUrl }),
  },
);
const data = await res.json();
if (!res.ok) throw new Error(JSON.stringify(data));
console.log('Updated photographer:', data[0]?.name, data[0]?.logo_url);
