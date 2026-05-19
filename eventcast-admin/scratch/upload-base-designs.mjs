import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  console.error("❌ Cloudinary credentials missing in .env.local!");
  process.exit(1);
}

const brainDir = 'C:\\Users\\Renugopal\\.gemini\\antigravity\\brain\\586dedeb-6173-4ce2-adfd-bb7a48cedea0';

const FILES_TO_UPLOAD = [
  { name: 'WaterColor Rose Garland', filename: 'media__1779127565230.jpg' },
  { name: 'Frosted Glass Border', filename: 'media__1779127565421.png' },
  { name: 'Glowing Circular Gold', filename: 'media__1779127565498.png' },
  { name: 'Eucalyptus Soft Pastel', filename: 'media__1779127565561.png' }
];

function generateSignature(params, secret) {
  const sortedKeys = Object.keys(params).sort();
  const stringToSign = sortedKeys.map(k => `${k}=${params[k]}`).join('&') + secret;
  return crypto.createHash('sha1').update(stringToSign).digest('hex');
}

async function uploadFile(filePath, displayName) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return null;
  }

  const timestamp = Math.round(Date.now() / 1000).toString();
  const folder = 'base_thumbnails/base_thumbnails';
  const params = { folder, timestamp };
  const signature = generateSignature(params, apiSecret);

  // Read file as base64 string
  const base64Data = fs.readFileSync(filePath, { encoding: 'base64' });
  const mimeType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  const dataUri = `data:${mimeType};base64,${base64Data}`;

  const bodyData = new URLSearchParams();
  bodyData.append('file', dataUri);
  bodyData.append('api_key', apiKey);
  bodyData.append('timestamp', timestamp);
  bodyData.append('signature', signature);
  bodyData.append('folder', folder);

  const url = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: bodyData.toString()
  });

  const data = await response.json();
  if (response.ok && data.secure_url) {
    console.log(`✅ Uploaded: "${displayName}" -> public_id: "${data.public_id}"`);
    return { name: displayName, public_id: data.public_id };
  } else {
    console.error(`❌ Failed uploading "${displayName}":`, data.error?.message || data);
    return null;
  }
}

async function main() {
  console.log("🚀 Starting premium background upload to Cloudinary...");
  const results = [];
  for (const item of FILES_TO_UPLOAD) {
    const fullPath = path.join(brainDir, item.filename);
    const result = await uploadFile(fullPath, item.name);
    if (result) results.push(result);
  }
  
  console.log("\n✨ UPLOAD COMPLETED! Here are your new baseDesigns for page.tsx:\n");
  console.log(JSON.stringify(results, null, 2));
}

main();
