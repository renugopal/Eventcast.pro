// Static contract test for the wiring in index.ts that cannot be unit-tested
// without a Workers runtime (no jest/vitest/miniflare in this package, and
// none is added per scope constraints). It inspects source text only.
//
// Executable behaviour of the pure helpers lives in hls-playback.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8');
// The pure render/URL-construction logic this file also guards lives in the
// canonical renderer module — physically inside the eventcast-admin project
// tree (Turbopack, unlike this Worker's esbuild/Wrangler bundler, cannot
// resolve a relative import that crosses outside its detected project root,
// so the shared implementation moved rather than being aliased across it).
// This Worker's own index.ts imports it by relative path; those specific
// assertions read this file instead.
const rendererSource = readFileSync(
  join(__dirname, '..', '..', '..', 'eventcast-admin', 'src', 'lib', 'weddingTemplateRenderer.ts'),
  'utf8'
);

test('the legacy Restreamer/memfs playback path is gone with no fallback', () => {
  assert.doesNotMatch(source, /media\.eventcast\.pro\/memfs/, 'memfs upstream must not remain');
  assert.doesNotMatch(source, /proxyHlsAsset/, 'legacy proxy helper must be removed');
  // The EventRow column stays declared (the DB column still exists); what must
  // be gone is any code path that reads it or builds the old URL shape.
  assert.doesNotMatch(
    source,
    /event\.restreamer_hls_url/,
    'the legacy restreamer_hls_url column must no longer drive playback',
  );
  assert.doesNotMatch(
    source,
    /\/hls\/\$\{slug\}\.m3u8/,
    'the legacy /hls/{slug}.m3u8 URL shape must no longer be constructed',
  );
});

test('playback assets are read only through the private R2 binding', () => {
  assert.match(source, /MEDIA_R2\?: R2Bucket/, 'the binding must be declared on Env');
  assert.match(source, /const bucket = env\.MEDIA_R2;/, 'reads must go through the binding');
  assert.match(source, /bucket\.get\(key\)/, 'objects must be fetched via the binding');
  assert.doesNotMatch(source, /r2\.cloudflarestorage\.com/, 'no direct R2 URL may appear');
  assert.doesNotMatch(source, /bucket_name|accountId|R2_ACCESS/, 'no bucket/account identifiers may appear');
});

test('the asset path is validated before a playback id is resolved or a key is built', () => {
  const fnAt = source.indexOf('async function serveHlsAssetFromR2(');
  assert.ok(fnAt !== -1, 'serveHlsAssetFromR2 must exist');
  const body = source.slice(fnAt, source.indexOf('function notFound(): Response {', fnAt));

  const parseAt = body.indexOf('parseHlsAssetPath(assetPath)');
  const resolveAt = body.indexOf('resolveAssignmentPlayback(env, eventId)');
  const keyAt = body.indexOf('buildR2Key(');
  const gateAt = body.indexOf('disabledHlsAssetRequirement(asset)');
  const getAt = body.indexOf('bucket.get(');

  assert.ok(parseAt !== -1 && resolveAt !== -1 && keyAt !== -1 && gateAt !== -1 && getAt !== -1);
  assert.ok(parseAt < resolveAt, 'path validation must precede playback-id resolution');
  assert.ok(resolveAt < keyAt, 'playback id must be resolved before the key is built');
  assert.ok(keyAt < getAt, 'the key must be built before the R2 read');
  assert.ok(gateAt < getAt, 'a disabled assignment must pass its continuity gate before any R2 read');
});

test('one consistent assignment snapshot is read; a disabled row never authorizes by itself', () => {
  const fnAt = source.indexOf('async function resolveAssignmentPlayback(');
  assert.ok(fnAt !== -1);
  const body = source.slice(fnAt, fnAt + 1400);
  assert.match(body, /media_event_assignments/);
  assert.match(body, /&select=playback_id,enabled/, 'playback id and enabled must come from ONE row read');
  assert.doesNotMatch(body, /enabled=is\.true/, 'disabled rows are evaluated by the continuity gates, not dropped');
  assert.match(body, /isValidPlaybackId\(playbackId\)/, 'the playback id must be validated before use');
  assert.match(body, /typeof enabled !== 'boolean'/, 'a non-boolean enabled flag must fail closed');
  assert.match(body, /return null;/, 'failures must collapse to null');

  const serveAt = source.indexOf('async function serveHlsAssetFromR2(');
  const serveBody = source.slice(serveAt, source.indexOf('function notFound(): Response {', serveAt));
  assert.match(serveBody, /const requirement = assignment\.enabled \? null : disabledHlsAssetRequirement\(asset\);/);
  assert.match(serveBody, /requirement === 'r2_final' && !\(await isR2FinalAuthorized\(env, eventId, assignment\)\)/);
  assert.match(serveBody, /requirement === 'bridge' && !isBridgeManifestFresh\(object\.uploaded, Date\.now\(\), bridgeMaxAgeSeconds\(env\)\)/);
});

test('every playback failure returns the same non-cacheable 404', () => {
  const fnAt = source.indexOf('function notFound(): Response {');
  assert.ok(fnAt !== -1, 'the shared 404 helper must exist');
  const helper = source.slice(fnAt, fnAt + 400);
  assert.match(helper, /status: 404/);
  assert.match(helper, /'Cache-Control': 'no-store, max-age=0'/);
  assert.match(helper, /'Not Found'/);

  const serveAt = source.indexOf('async function serveHlsAssetFromR2(');
  const serveBody = source.slice(serveAt, source.indexOf('function notFound(): Response {', serveAt));
  const returns = serveBody.match(/return notFound\(\);/g) ?? [];
  assert.ok(returns.length >= 6, `expected every failure branch to return notFound(); found ${returns.length}`);
  assert.doesNotMatch(serveBody, /status: 40[13]|status: 500/, 'no distinguishable status may be returned');
});

test('manifests are rewritten before leaving the Worker and fail closed', () => {
  const serveAt = source.indexOf('async function serveHlsAssetFromR2(');
  const serveBody = source.slice(serveAt, source.indexOf('function notFound(): Response {', serveAt));
  assert.match(serveBody, /rewriteManifest\(await object\.text\(\), playbackId, slug\)/);
  assert.match(serveBody, /if \(rewritten === null\) return notFound\(\);/);
  const rewriteAt = serveBody.indexOf('rewriteManifest(');
  const rawReturnAt = serveBody.indexOf('new Response(object.body');
  assert.ok(rawReturnAt !== -1 && rawReturnAt < rewriteAt, 'only segments may be streamed unrewritten');
});

test('stored Content-Type and Cache-Control win over the fallbacks', () => {
  assert.match(source, /object\.httpMetadata\?\.contentType \?\? fallbackContentType\(asset\)/);
  assert.match(source, /object\.httpMetadata\?\.cacheControl \?\? fallbackCacheControl\(asset\)/);
});

test('the live player URL points at the public live route only when playback is enabled', () => {
  assert.match(
    rendererSource,
    /hasLivePlayback\s*\r?\n?\s*\?\s*`https:\/\/\$\{hostname\}\/events\/\$\{encodeURIComponent\(slug\)\}\/hls\/live\/index\.m3u8`/,
    'live URL must be /events/{slug}/hls/live/index.m3u8',
  );
  assert.match(
    source,
    /const hasLivePlayback = assignmentPlayback\?\.enabled === true;/,
    'live playback must be gated on an enabled assignment',
  );
  assert.match(rendererSource, /const vodArchiveUrl = event\.vod_link \?\? '';/, 'VOD selection must stay unchanged');
});
