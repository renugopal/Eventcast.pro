#!/usr/bin/env node
/**
 * Finalize VOD after event ends.
 *
 * 1. Catch-up upload any remaining segments + playlist
 * 2. Ensure index.m3u8 has EXT-X-ENDLIST (VOD mode)
 * 3. Update Supabase vod_link
 *
 * Usage:
 *   node finalize-vod.mjs <event-slug>
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  loadConfig,
  createS3Client,
  uploadBuffer,
  verifyUploaded,
  vodObjectKey,
  vodPublicUrl,
  sleep,
} from './lib/r2.mjs';
import { UploadState } from './lib/state.mjs';
import {
  listDiskDir,
  downloadDiskFile,
  deleteDiskFile,
  archiveDir,
} from './lib/restreamer.mjs';

const MAX_RETRIES = Number(process.env.MAX_RETRIES || 5);
const STATE_DIR = process.env.STATE_DIR || '/var/lib/eventcast-uploader/state';
const DELETE_AFTER_FINALIZE = process.env.DELETE_LOCAL_AFTER_FINALIZE === 'true';

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node finalize-vod.mjs <event-slug>');
  process.exit(1);
}

const cfg = loadConfig();
const s3 = createS3Client(cfg);

async function uploadWithRetry(fileName, body) {
  const key = vodObjectKey(slug, fileName);
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await uploadBuffer(s3, cfg.bucket, key, body, fileName);
      const ok = await verifyUploaded(s3, cfg.bucket, key, body.length);
      if (!ok) throw new Error('size mismatch');
      return;
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(attempt * 2000);
    }
  }
}

function ensureEndlist(playlistText) {
  if (playlistText.includes('#EXT-X-ENDLIST')) return playlistText;
  const trimmed = playlistText.trimEnd();
  return `${trimmed}\n#EXT-X-ENDLIST\n`;
}

async function catchUpAll() {
  const state = new UploadState(STATE_DIR, slug);
  const files = await listDiskDir(archiveDir(slug));

  if (!files.length) {
    console.log('No local archive files found — checking if already on R2');
    return;
  }

  console.log(`Catch-up: ${files.length} local files`);

  const segments = files.filter((f) => f.name?.endsWith('.ts')).sort((a, b) => a.name.localeCompare(b.name));

  for (const file of segments) {
    if (await state.isUploaded(file.name)) continue;
    const rel = `${archiveDir(slug)}/${file.name}`;
    const body = await downloadDiskFile(rel);
    await uploadWithRetry(file.name, body);
    await state.markUploaded(file.name, body.length);
    console.log(`  ✓ ${file.name}`);
    if (DELETE_AFTER_FINALIZE) await deleteDiskFile(rel);
  }

  const hasPlaylist = files.some((f) => f.name === 'index.m3u8');
  if (hasPlaylist) {
    const rel = `${archiveDir(slug)}/index.m3u8`;
    let body = await downloadDiskFile(rel);
    let text = body.toString('utf8');
    text = ensureEndlist(text);
    body = Buffer.from(text, 'utf8');
    await uploadWithRetry('index.m3u8', body);
    await state.markUploaded('index.m3u8', body.length);
    console.log('  ✓ index.m3u8 (finalized with ENDLIST)');
    if (DELETE_AFTER_FINALIZE) await deleteDiskFile(rel);
  }
}

async function updateSupabase(vodUrl) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.warn('Supabase not configured — skip vod_link update');
    console.log(`Set vod_link manually: ${vodUrl}`);
    return;
  }

  const supabase = createClient(url, key);
  const { error } = await supabase.from('events').update({ vod_link: vodUrl }).eq('slug', slug);
  if (error) throw new Error(`Supabase update failed: ${error.message}`);
  console.log('✓ Supabase vod_link updated');
}

async function main() {
  console.log(`\n=== Finalize VOD: ${slug} ===\n`);

  await catchUpAll();

  const vodUrl = vodPublicUrl(cfg, slug);
  if (!vodUrl) {
    throw new Error('R2_PUBLIC_URL not set — cannot build vod_link');
  }

  console.log(`\nVOD URL: ${vodUrl}`);
  await updateSupabase(vodUrl);

  console.log('\n=== Finalize complete ===');
  console.log('Event page will use VOD when vod_link is set.');
}

main().catch((err) => {
  console.error('\n❌ Finalize failed:', err.message);
  process.exit(1);
});
