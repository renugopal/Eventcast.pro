#!/usr/bin/env node

/**
 * VOD Archiver — Eventcast.pro
 *
 * Automated pipeline that runs as a cron job on the GCP Media Server:
 *   1. Poll Supabase for completed events with no VOD URL
 *   2. Locate HLS (.m3u8 + .ts) files written by Datarhei Restreamer
 *   3. Stitch all segments into a single MP4 via FFmpeg (copy, no re-encode)
 *   4. Upload the MP4 to Cloudflare R2 using multipart S3 API
 *   5. Persist the public R2 URL back to the Supabase `events` row
 *   6. Delete the temporary MP4 and all raw HLS files to reclaim disk space
 *
 * Safety guarantees:
 *   - PID lock file prevents concurrent runs from overlapping
 *   - `video_url = 'processing'` sentinel blocks double-processing across crashes
 *   - On any error the sentinel is reset to NULL so the event is retried next run
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

// ─── Logger ───────────────────────────────────────────────────────────────────
// Emits JSON lines to stdout (captured by journald/systemd) and optionally a
// log file set via LOG_FILE env var.

function createLogger() {
  const logFile = process.env.LOG_FILE || null;

  function write(level, message, meta = {}) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...meta });
    process.stdout.write(line + '\n');
    if (logFile) {
      try { fs.appendFileSync(logFile, line + '\n'); } catch { /* non-fatal */ }
    }
  }

  return {
    info:  (msg, meta) => write('INFO',  msg, meta),
    warn:  (msg, meta) => write('WARN',  msg, meta),
    error: (msg, meta) => write('ERROR', msg, meta),
  };
}

const log = createLogger();

// ─── Config ───────────────────────────────────────────────────────────────────

function loadConfig() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'R2_PUBLIC_URL',
  ];

  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    log.error('Missing required environment variables', { missing });
    process.exit(1);
  }

  return {
    supabaseUrl:      process.env.SUPABASE_URL,
    supabaseKey:      process.env.SUPABASE_SERVICE_ROLE_KEY,
    r2AccountId:      process.env.R2_ACCOUNT_ID,
    r2AccessKeyId:    process.env.R2_ACCESS_KEY_ID,
    r2SecretKey:      process.env.R2_SECRET_ACCESS_KEY,
    r2Bucket:         process.env.R2_BUCKET_NAME,
    r2PublicUrl:      process.env.R2_PUBLIC_URL.replace(/\/$/, ''),
    r2KeyPrefix:      process.env.R2_KEY_PREFIX      || 'vods',
    dataDir:          process.env.RESTREAMER_DATA_DIR || '/opt/restreamer/data',
    tempDir:          process.env.TEMP_DIR            || '/tmp/vod-archiver',
    lockFile:         process.env.LOCK_FILE           || '/tmp/vod-archiver.lock',
    ffmpegBin:        process.env.FFMPEG_BIN          || 'ffmpeg',
    // How long (ms) an event can stay in 'processing' before we consider it
    // stale and automatically reset it. Default: 4 hours.
    staleThresholdMs: parseInt(process.env.STALE_THRESHOLD_MS || '14400000', 10),
  };
}

// ─── PID Lock ─────────────────────────────────────────────────────────────────
// Only one archiver process should run at a time (FFmpeg is CPU/IO heavy).

function acquireLock(lockFile) {
  if (fs.existsSync(lockFile)) {
    const raw = fs.readFileSync(lockFile, 'utf8').trim();
    const pid = parseInt(raw, 10);
    try {
      process.kill(pid, 0); // throws if process does not exist
      log.warn('Another instance is already running — exiting', { pid });
      process.exit(0);
    } catch {
      log.warn('Removing stale lock file from dead process', { pid });
    }
  }

  fs.writeFileSync(lockFile, String(process.pid));

  const releaseLock = () => { try { fs.unlinkSync(lockFile); } catch { /* ignore */ } };
  process.on('exit', releaseLock);
  process.on('SIGINT',  () => { releaseLock(); process.exit(0); });
  process.on('SIGTERM', () => { releaseLock(); process.exit(0); });
}

// ─── HLS File Discovery ───────────────────────────────────────────────────────
// Datarhei Restreamer writes HLS in two common layouts depending on version:
//   Flat:   /data/<slug>.m3u8  +  /data/<slug>NNNNNN.ts
//   Nested: /data/<slug>/index.m3u8  +  /data/<slug>/NNNNNN.ts

async function findHlsFiles(dataDir, slug) {
  const candidates = [
    path.join(dataDir, `${slug}.m3u8`),
    path.join(dataDir, slug, 'index.m3u8'),
    path.join(dataDir, slug, `${slug}.m3u8`),
  ];

  for (const m3u8Path of candidates) {
    if (!fs.existsSync(m3u8Path)) continue;

    const hlsDir = path.dirname(m3u8Path);
    const entries = await fsp.readdir(hlsDir);

    // Collect every .ts file that belongs to this slug
    const tsFiles = entries
      .filter((f) => f.endsWith('.ts') && (f.startsWith(slug) || hlsDir.endsWith(slug)))
      .map((f) => path.join(hlsDir, f));

    if (tsFiles.length === 0) {
      log.warn('M3U8 found but no .ts segments present — stream may still be live', {
        slug, m3u8Path,
      });
      return null;
    }

    return { m3u8Path, hlsDir, tsFiles };
  }

  return null;
}

// ─── FFmpeg Stitch ────────────────────────────────────────────────────────────
// Merges HLS segments into MP4 using stream copy (zero quality loss, fast).
// `-movflags +faststart` moves the moov atom to the front so video can be
// played before fully downloading. `-bsf:a aac_adtstoasc` fixes AAC framing
// when muxing ADTS audio (common in MPEG-TS) into MP4.

function stitchHlsToMp4(ffmpegBin, m3u8Path, hlsDir, outputMp4) {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-allowed_extensions', 'ALL',
      '-protocol_whitelist', 'file,crypto,data,http,https,tcp,tls',
      '-i', m3u8Path,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-bsf:a', 'aac_adtstoasc',
      outputMp4,
    ];

    log.info('Spawning FFmpeg', { args: args.join(' ') });

    // Run FFmpeg from the HLS directory so relative segment paths resolve
    const ff = spawn(ffmpegBin, args, { cwd: hlsDir, stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    ff.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    ff.on('close', (code) => {
      if (code === 0) {
        log.info('FFmpeg stitch complete', { outputMp4 });
        resolve();
      } else {
        // Include the last 2 KB of FFmpeg stderr for debugging
        reject(new Error(`FFmpeg exited ${code}\n${stderr.slice(-2048)}`));
      }
    });

    ff.on('error', (err) => reject(new Error(`FFmpeg spawn error: ${err.message}`)));
  });
}

// ─── R2 Upload ────────────────────────────────────────────────────────────────
// Uses @aws-sdk/lib-storage for automatic multipart upload (handles files of
// any size; splits into 100 MB chunks, 4 concurrent streams).

async function uploadToR2(s3Client, bucket, key, filePath) {
  const stats = await fsp.stat(filePath);
  const sizeMB = (stats.size / 1_048_576).toFixed(1);
  log.info('Starting R2 upload', { key, sizeMB: `${sizeMB} MB` });

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket:        bucket,
      Key:           key,
      Body:          fs.createReadStream(filePath),
      ContentType:   'video/mp4',
      ContentLength: stats.size,
    },
    queueSize:  4,
    partSize:   100 * 1024 * 1024, // 100 MB per part
    leavePartsOnError: false,
  });

  upload.on('httpUploadProgress', ({ loaded, total }) => {
    if (total) {
      log.info('Upload progress', { key, pct: `${((loaded / total) * 100).toFixed(1)}%` });
    }
  });

  await upload.done();
  log.info('R2 upload complete', { key });
}

// ─── Verify Upload ────────────────────────────────────────────────────────────

async function verifyR2Upload(s3Client, bucket, key) {
  const res = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  return typeof res.ContentLength === 'number' && res.ContentLength > 0;
}

// ─── Disk Cleanup ─────────────────────────────────────────────────────────────

async function deleteFiles(filePaths) {
  for (const f of filePaths) {
    try {
      await fsp.unlink(f);
      log.info('Deleted file', { path: f });
    } catch (err) {
      log.warn('Could not delete file (non-fatal)', { path: f, error: err.message });
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log.info('VOD Archiver starting', { pid: process.pid, node: process.version });

  const cfg = loadConfig();

  acquireLock(cfg.lockFile);

  // Ensure the temp directory exists
  await fsp.mkdir(cfg.tempDir, { recursive: true });

  // ── Clients ──────────────────────────────────────────────────────────────
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: false },
  });

  const s3 = new S3Client({
    region:   'auto',
    endpoint: `https://${cfg.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     cfg.r2AccessKeyId,
      secretAccessKey: cfg.r2SecretKey,
    },
  });

  // ── Safety net: warn about stuck-processing events ───────────────────────
  const { data: stuckEvents } = await supabase
    .from('events')
    .select('id, slug, updated_at')
    .eq('video_url', 'processing');

  if (stuckEvents?.length) {
    const now = Date.now();
    for (const evt of stuckEvents) {
      const age = now - new Date(evt.updated_at).getTime();
      if (age > cfg.staleThresholdMs) {
        log.warn('Resetting stale processing event', { id: evt.id, slug: evt.slug, ageMs: age });
        await supabase.from('events').update({ video_url: null }).eq('id', evt.id);
      } else {
        log.warn('Event is currently being processed (or crashed recently)', {
          id: evt.id, slug: evt.slug, ageMs: age,
        });
      }
    }
  }

  // ── Fetch pending events ──────────────────────────────────────────────────
  const { data: events, error: fetchErr } = await supabase
    .from('events')
    .select('id, slug')
    .eq('youtube_status', 'completed')
    .is('video_url', null)
    .order('created_at', { ascending: true });

  if (fetchErr) {
    log.error('Failed to query Supabase', { error: fetchErr.message });
    process.exit(1);
  }

  if (!events?.length) {
    log.info('No pending events — nothing to do');
    return;
  }

  log.info(`Found ${events.length} pending event(s)`, { slugs: events.map((e) => e.slug) });

  // ── Process each event sequentially ──────────────────────────────────────
  for (const event of events) {
    const { id, slug } = event;
    const mp4Path = path.join(cfg.tempDir, `${slug}.mp4`);
    const r2Key   = `${cfg.r2KeyPrefix}/${slug}.mp4`;
    let hlsFiles  = null;

    log.info('─── Processing event', { id, slug });

    // Mark as in-progress so a concurrent restart won't double-process
    const { error: markErr } = await supabase
      .from('events')
      .update({ video_url: 'processing' })
      .eq('id', id)
      .is('video_url', null); // guard: only if still null

    if (markErr) {
      log.error('Could not mark event as processing — skipping', { id, slug, error: markErr.message });
      continue;
    }

    try {
      // 1. Locate HLS files on disk
      hlsFiles = await findHlsFiles(cfg.dataDir, slug);
      if (!hlsFiles) {
        throw new Error(
          `No HLS files found for slug "${slug}" under ${cfg.dataDir}. ` +
          'Stream may still be live or data dir is wrong.'
        );
      }
      log.info('HLS files located', {
        m3u8: hlsFiles.m3u8Path,
        segments: hlsFiles.tsFiles.length,
      });

      // 2. Stitch HLS → MP4
      await stitchHlsToMp4(cfg.ffmpegBin, hlsFiles.m3u8Path, hlsFiles.hlsDir, mp4Path);

      // 3. Upload to Cloudflare R2
      await uploadToR2(s3, cfg.r2Bucket, r2Key, mp4Path);

      // 4. Verify object exists in R2 before touching the DB
      const verified = await verifyR2Upload(s3, cfg.r2Bucket, r2Key);
      if (!verified) throw new Error(`R2 object verification failed for key: ${r2Key}`);

      const videoUrl = `${cfg.r2PublicUrl}/${r2Key}`;

      // 5. Persist VOD URL in Supabase
      const { error: updateErr } = await supabase
        .from('events')
        .update({ video_url: videoUrl })
        .eq('id', id);

      if (updateErr) throw new Error(`Supabase update failed: ${updateErr.message}`);

      log.info('Supabase updated with VOD URL', { id, slug, videoUrl });

      // 6. Clean up local disk — only after DB is confirmed updated
      await deleteFiles([mp4Path, hlsFiles.m3u8Path, ...hlsFiles.tsFiles]);

      log.info('Event archived successfully ✓', { id, slug, videoUrl });

    } catch (err) {
      log.error('Failed to archive event — will retry next run', {
        id, slug, error: err.message,
      });

      // Reset the sentinel so the event is picked up on the next cron run
      await supabase
        .from('events')
        .update({ video_url: null })
        .eq('id', id);

      // Remove partial MP4 to avoid a corrupt leftover on disk
      if (fs.existsSync(mp4Path)) {
        try { await fsp.unlink(mp4Path); } catch { /* ignore */ }
      }
    }
  }

  log.info('VOD Archiver run complete');
}

main().catch((err) => {
  log.error('Fatal unhandled error', { error: err.message, stack: err.stack });
  process.exit(1);
});
