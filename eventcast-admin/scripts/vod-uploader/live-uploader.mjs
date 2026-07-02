#!/usr/bin/env node
/**
 * Live segment uploader — polls Restreamer archive folders and uploads to R2.
 *
 * Safety rules:
 *  - Upload → verify size on R2 → mark state → delete local (.ts only)
 *  - On failure: keep local file, retry next poll
 *  - index.m3u8: upload on change, NEVER delete locally during stream
 *  - Live HLS / YouTube outputs are untouched
 *
 * Run on GCP VM (same host as Restreamer):
 *   npm start
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

// Load .env from script directory (robust for systemd service)
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '.env') });
import {
  loadConfig,
  createS3Client,
  uploadBuffer,
  verifyUploaded,
  vodObjectKey,
  sleep,
} from './lib/r2.mjs';
import { UploadState } from './lib/state.mjs';
import {
  listProcesses,
  listDiskDir,
  downloadDiskFile,
  deleteDiskFile,
  archiveDir,
} from './lib/restreamer.mjs';

const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 4000);
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 5);
const DELETE_TS = process.env.DELETE_AFTER_UPLOAD !== 'false';
const STATE_DIR = process.env.STATE_DIR || '/var/lib/eventcast-uploader/state';
const DISK_WARN_PERCENT = Number(process.env.DISK_WARN_PERCENT || 75);

const cfg = loadConfig();
const s3 = createS3Client(cfg);

/** Per-slug playlist debounce */
const playlistPending = new Map();

/** In-flight uploads to avoid duplicate work */
const inFlight = new Set();

function log(slug, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${slug || 'sys'}] ${msg}`);
}

async function getDiskUsagePercent() {
  try {
    const stats = await fs.statfs('/');
    const total = stats.blocks * stats.bsize;
    const free = stats.bfree * stats.bsize;
    const used = total - free;
    return Math.round((used / total) * 100);
  } catch {
    return 0;
  }
}

async function uploadWithRetry(slug, fileName, body) {
  const key = vodObjectKey(slug, fileName);
  let lastErr;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await uploadBuffer(s3, cfg.bucket, key, body, fileName);
      const ok = await verifyUploaded(s3, cfg.bucket, key, body.length);
      if (!ok) throw new Error('R2 size mismatch after upload');
      return key;
    } catch (err) {
      lastErr = err;
      log(slug, `upload ${fileName} attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) await sleep(attempt * 2000);
    }
  }

  throw lastErr;
}

async function processSegment(slug, file) {
  const flightKey = `${slug}:${file.name}`;
  if (inFlight.has(flightKey)) return;
  inFlight.add(flightKey);

  try {
    const state = new UploadState(STATE_DIR, slug);
    if (await state.isUploaded(file.name)) {
      if (DELETE_TS) {
        try {
          await deleteDiskFile(`${archiveDir(slug)}/${file.name}`);
        } catch {
          /* orphan local file — ok */
        }
      }
      return;
    }

    const rel = `${archiveDir(slug)}/${file.name}`;
    const body = await downloadDiskFile(rel);

    await uploadWithRetry(slug, file.name, body);
    await state.markUploaded(file.name, body.length);
    log(slug, `✓ ${file.name} (${(body.length / 1024 / 1024).toFixed(2)} MB) → R2`);

    if (DELETE_TS) {
      await deleteDiskFile(rel);
      log(slug, `  local deleted ${file.name}`);
    }
  } catch (err) {
    log(slug, `✗ ${file.name} kept on disk: ${err.message}`);
  } finally {
    inFlight.delete(flightKey);
  }
}

async function processPlaylist(slug) {
  if (playlistPending.has(slug)) clearTimeout(playlistPending.get(slug));

  playlistPending.set(
    slug,
    setTimeout(async () => {
      playlistPending.delete(slug);
      const flightKey = `${slug}:index.m3u8`;
      if (inFlight.has(flightKey)) return;
      inFlight.add(flightKey);

      try {
        const rel = `${archiveDir(slug)}/index.m3u8`;
        const body = await downloadDiskFile(rel);
        await uploadWithRetry(slug, 'index.m3u8', body);
        const state = new UploadState(STATE_DIR, slug);
        await state.markUploaded('index.m3u8', body.length);
        log(slug, `✓ index.m3u8 updated on R2 (${body.length} bytes)`);
        // NEVER delete index.m3u8 locally during live stream
      } catch (err) {
        log(slug, `✗ index.m3u8 upload failed (local kept): ${err.message}`);
      } finally {
        inFlight.delete(flightKey);
      }
    }, 2000),
  );
}

async function pollSlug(slug) {
  const files = await listDiskDir(archiveDir(slug));
  if (!files.length) return;

  const segments = files
    .filter((f) => {
      const n = (f.name || '').replace(/^\//, '');
      return n.endsWith('.ts');
    })
    .map((f) => ({ ...f, name: (f.name || '').replace(/^\//, '').split('/').pop() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const hasPlaylist = files.some((f) => (f.name || '').replace(/^\//, '').endsWith('index.m3u8'));

  for (const seg of segments) {
    await processSegment(slug, seg);
  }

  if (hasPlaylist) {
    await processPlaylist(slug);
  }
}

async function discoverSlugs() {
  const slugs = new Set();

  try {
    const entries = await listDiskDir('recordings');
    for (const e of entries) {
      const name = (e.name || '').replace(/^\//, '').split('/')[0];
      if (name && !name.includes('.')) slugs.add(name);
    }
  } catch {
    /* recordings/ may not exist until first stream */
  }

  try {
    const procs = await listProcesses();
    for (const p of procs) {
      if (p.id) slugs.add(p.id);
    }
  } catch {
    /* Restreamer briefly unavailable */
  }

  return [...slugs];
}

async function pollOnce() {
  const diskPct = await getDiskUsagePercent();
  if (diskPct >= DISK_WARN_PERCENT) {
    log('sys', `⚠ disk usage ${diskPct}% — uploads may be behind; local files kept until uploaded`);
  }

  const slugs = await discoverSlugs();
  for (const slug of slugs) {
    try {
      await pollSlug(slug);
    } catch (err) {
      log(slug, `poll error: ${err.message}`);
    }
  }
}

async function main() {
  log('sys', 'Eventcast live segment uploader starting');
  log('sys', `Poll interval: ${POLL_MS}ms | Delete .ts after upload: ${DELETE_TS}`);
  log('sys', `R2 bucket: ${cfg.bucket} | State: ${STATE_DIR}`);

  await fs.mkdir(STATE_DIR, { recursive: true });

  for (;;) {
    try {
      await pollOnce();
    } catch (err) {
      log('sys', `poll cycle error: ${err.message}`);
    }
    await sleep(POLL_MS);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
