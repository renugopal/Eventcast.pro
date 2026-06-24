const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const path = require('path');

const envContent = fs.readFileSync('./.env.local', 'utf-8');
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
});

const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET_NAME;
const ENDPOINT = process.env.R2_S3_ENDPOINT;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;

const EVENT_SLUG = 'bhargavaram-sasiram-chowdary-dhoti-ceremony';
const FILES = [
  {
    filePath: path.resolve(`../events/bhargavaram-sasiram-chowdary-dhoti ceremony/assets/seo_thumbnail.png`),
    objectKey: `thumbnails/${EVENT_SLUG}/seo_thumbnail.png`,
    contentType: 'image/png',
  },
  {
    filePath: path.resolve(`../events/bhargavaram-sasiram-chowdary-dhoti ceremony/assets/invitation.mp4`),
    objectKey: `events/${EVENT_SLUG}/invitation.mp4`,
    contentType: 'video/mp4',
  },
];

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
  const fileSize = fileBuffer.length;
  const endpointUrl = new URL(ENDPOINT);
  const host = endpointUrl.hostname;
  const region = 'auto';
  const service = 's3';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(fileBuffer);
  const canonicalUri = `/${BUCKET}/${objectKey}`;
  const canonicalHeaders =
    `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `PUT\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256(canonicalRequest)}`;
  const signingKey = getSigningKey(SECRET_KEY, dateStamp, region, service);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authHeader = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request({
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
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(`${PUBLIC_URL}/${objectKey}`);
        } else {
          reject(new Error(`Upload failed ${objectKey}: ${res.statusCode} ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });
}

async function main() {
  const urls = {};
  for (const file of FILES) {
    console.log('Uploading', file.objectKey, '...');
    urls[file.objectKey] = await putObject(file.filePath, file.objectKey, file.contentType);
    console.log('Done:', urls[file.objectKey]);
  }

  const configPath = path.resolve(`../events/bhargavaram-sasiram-chowdary-dhoti ceremony/config.js`);
  let config = fs.readFileSync(configPath, 'utf8');
  config = config.replace(/thumbnail:\s*"[^"]*"/, `thumbnail: "${urls[`thumbnails/${EVENT_SLUG}/seo_thumbnail.png`]}"`);
  config = config.replace(/invitationVideo:\s*"[^"]*"/, `invitationVideo: "${urls[`events/${EVENT_SLUG}/invitation.mp4`]}"`);
  config = config.replace(/invitationVideos:\s*\[[^\]]*\]/, `invitationVideos: ["${urls[`events/${EVENT_SLUG}/invitation.mp4`]}"]`);
  fs.writeFileSync(configPath, config);

  const indexPath = path.resolve(`../events/bhargavaram-sasiram-chowdary-dhoti ceremony/index.html`);
  let index = fs.readFileSync(indexPath, 'utf8');
  index = index.replace(/assets\/seo_thumbnail\.png/g, urls[`thumbnails/${EVENT_SLUG}/seo_thumbnail.png`]);
  index = index.replace(/assets\/invitation\.mp4/g, urls[`events/${EVENT_SLUG}/invitation.mp4`]);
  fs.writeFileSync(indexPath, index);

  console.log('Config and index updated with R2 URLs.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
