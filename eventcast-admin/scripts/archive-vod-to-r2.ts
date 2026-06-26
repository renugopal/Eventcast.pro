/**
 * Post-event VOD archival pipeline
 * 
 * Copies HLS archive segments from Restreamer disk to Cloudflare R2,
 * then updates Supabase vod_link for permanent playback.
 * 
 * Usage:
 *   npm run archive-vod -- <event-slug>
 * 
 * Example:
 *   npm run archive-vod -- sravani-manoj-engagement
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fetch from 'node-fetch';

const RESTREAMER_URL = process.env.RESTREAMER_URL || 'https://media.eventcast.pro';
const RESTREAMER_USERNAME = process.env.RESTREAMER_USERNAME!;
const RESTREAMER_PASSWORD = process.env.RESTREAMER_PASSWORD!;

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_BUCKET = process.env.R2_BUCKET_NAME || process.env.R2_BUCKET || 'eventcast-media';
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || process.env.R2_PUBLIC_DOMAIN || '').replace(/\/$/, '');

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

interface RestreamerFile {
  name: string;
  size: number;
  lastModified: string;
}

async function getRestreamerToken(): Promise<string> {
  const res = await fetch(`${RESTREAMER_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: RESTREAMER_USERNAME,
      password: RESTREAMER_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`Restreamer login failed: ${res.status}`);
  const data: any = await res.json();
  return `Bearer ${data.access_token}`;
}

async function listRestreamerFiles(token: string, dirPath: string): Promise<RestreamerFile[]> {
  const encodedPath = encodeURIComponent(dirPath);
  const res = await fetch(`${RESTREAMER_URL}/api/v3/fs/disk/${encodedPath}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Failed to list Restreamer files: ${res.status}`);
  }
  const data: any = await res.json();
  return Array.isArray(data) ? data : [];
}

async function downloadRestreamerFile(token: string, filePath: string): Promise<Buffer> {
  const encodedPath = encodeURIComponent(filePath);
  const res = await fetch(`${RESTREAMER_URL}/api/v3/fs/disk/${encodedPath}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) throw new Error(`Failed to download ${filePath}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function uploadToR2(s3: S3Client, bucket: string, key: string, body: Buffer, contentType: string) {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

function getContentType(filename: string): string {
  if (filename.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (filename.endsWith('.ts')) return 'video/mp2t';
  if (filename.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

async function archiveVodToR2(eventSlug: string) {
  console.log(`\n=== Archiving VOD for ${eventSlug} ===\n`);

  const token = await getRestreamerToken();
  console.log('✓ Logged into Restreamer');

  const archiveDir = `recordings/${eventSlug}`;
  const files = await listRestreamerFiles(token, archiveDir);

  if (files.length === 0) {
    console.log(`⚠ No archive files found in ${archiveDir} — check if stream ran and produced segments.`);
    return;
  }

  console.log(`✓ Found ${files.length} files in Restreamer archive`);

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  console.log('\nUploading to R2...');
  let uploaded = 0;

  for (const file of files) {
    const filePath = `${archiveDir}/${file.name}`;
    const r2Key = `events/${eventSlug}/vod/${file.name}`;

    console.log(`  ${++uploaded}/${files.length} ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

    const buffer = await downloadRestreamerFile(token, filePath);
    const contentType = getContentType(file.name);
    await uploadToR2(s3, R2_BUCKET, r2Key, buffer, contentType);
  }

  console.log(`\n✓ Uploaded all ${files.length} files to R2`);

  const vodUrl = R2_PUBLIC_URL
    ? `${R2_PUBLIC_URL}/events/${eventSlug}/vod/index.m3u8`
    : `https://vod.eventcast.pro/events/${eventSlug}/vod/index.m3u8`;
  console.log(`\nVOD URL: ${vodUrl}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { error } = await supabase
    .from('events')
    .update({ vod_link: vodUrl })
    .eq('slug', eventSlug);

  if (error) {
    console.error('⚠ Failed to update Supabase vod_link:', error);
  } else {
    console.log('✓ Updated Supabase vod_link');
  }

  console.log('\n=== VOD archival complete ===\n');
  console.log(`Next steps:`);
  console.log(`  1. Verify playback: ${vodUrl}`);
  console.log(`  2. Event page will auto-switch to VOD once vod_link is set`);
  console.log(`  3. (Optional) Delete Restreamer archive to free disk space`);
}

const eventSlug = process.argv[2];
if (!eventSlug) {
  console.error('Usage: npm run archive-vod -- <event-slug>');
  process.exit(1);
}

archiveVodToR2(eventSlug).catch((err) => {
  console.error('\n❌ VOD archival failed:', err);
  process.exit(1);
});
