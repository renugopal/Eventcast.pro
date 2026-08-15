// Static contract test for the B2-VOD wiring in index.ts that cannot be
// unit-tested without a Workers runtime — mirrors r2-playback-path.contract
// .test.mjs's approach of inspecting source text for the properties a real
// request/response cycle cannot easily be constructed for here. Executable
// behaviour of the pure B2 helpers lives in b2playback.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8');
const rendererSource = readFileSync(
  join(__dirname, '..', '..', '..', 'eventcast-admin', 'src', 'lib', 'weddingTemplateRenderer.ts'),
  'utf8'
);

test('B2 credentials are never exposed as a direct URL, and no write-capable Media Agent env name is reused', () => {
  assert.doesNotMatch(source, /b2\.backblazeb2\.com\/[^'"` ]/, 'no hardcoded direct B2 host+path may appear');
  assert.doesNotMatch(source, /EVENTCAST_B2_ACCESS_KEY_ID|EVENTCAST_B2_SECRET_ACCESS_KEY/, 'the Media Agent write credential env names must not be reused here');
});

test('B2 VOD asset requests are gated before a key is built or B2 is fetched', () => {
  const fnAt = source.indexOf('async function serveB2VodAsset(');
  assert.ok(fnAt !== -1, 'serveB2VodAsset must exist');
  const body = source.slice(fnAt, fnAt + 2200);

  const parseAt = body.indexOf('parseB2VodAssetPath(assetPath)');
  const configAt = body.indexOf('loadB2PlaybackConfigFromEnv(env)');
  const eligibleAt = body.indexOf('isB2ReplayEligible(env, recording)');
  const signAt = body.indexOf('buildSignedB2GetRequest(');

  assert.ok(parseAt !== -1 && configAt !== -1 && eligibleAt !== -1 && signAt !== -1);
  assert.ok(parseAt < configAt, 'path validation must precede config resolution');
  assert.ok(configAt < eligibleAt, 'B2 must be confirmed configured before the eligibility gate runs');
  assert.ok(eligibleAt < signAt, 'eligibility must be confirmed before any B2 fetch is signed');
});

test('replay eligibility fails closed on every required evidence field, including retention expiry', () => {
  const fnAt = source.indexOf('function isB2ReplayEligible(');
  assert.ok(fnAt !== -1);
  const body = source.slice(fnAt, source.indexOf('\n}', fnAt));
  assert.match(body, /if \(!recording\) return false;/);
  assert.match(body, /if \(!loadB2PlaybackConfigFromEnv\(env\)\) return false;/);
  assert.match(body, /recording_state !== 'b2_finalized'/);
  assert.match(body, /!recording\.finalization_generation/);
  assert.match(body, /!recording\.integrity_verified_at/);
  assert.match(body, /!recording\.retention_expires_at/);
  assert.match(body, /new Date\(recording\.retention_expires_at\)\.getTime\(\) > Date\.now\(\)/);
});

test('B2 replay is never offered while the event is currently live', () => {
  assert.match(
    source,
    /const hasB2Replay = !hasLivePlayback && isB2ReplayEligible\(env, recordingEvidence\);/,
  );
});

test('the verified YouTube fallback only ever activates when neither live nor B2 replay can be offered', () => {
  const idx = source.indexOf('const verifiedYoutubeFallbackUrl =');
  assert.ok(idx !== -1);
  const snippet = source.slice(idx, idx + 400);
  assert.match(snippet, /!hasLivePlayback && !hasB2Replay/);
  assert.match(snippet, /youtube_fallback_verified === true/);
});

test('B2-VOD segments and manifests are only ever streamed through this Worker, never as a direct URL', () => {
  const fnAt = source.indexOf('async function serveB2VodAsset(');
  const body = source.slice(fnAt, source.indexOf('\n/**', fnAt + 10));
  assert.match(body, /upstream\.body/, 'segments must be streamed through the Worker response');
  assert.match(body, /rewriteB2Manifest\(await upstream\.text\(\), slug\)/, 'manifests must be rewritten before leaving the Worker');
  assert.match(body, /if \(rewritten === null\) return notFound\(\);/, 'manifest rewriting must fail closed');
});

test('renderEvent receives the B2 replay and verified-fallback signals, and the legacy vod_link chain is unchanged', () => {
  assert.match(
    source,
    /renderEvent\(\s*\n\s*templateHtml, event, photographer, slug, env, countryCode, hostname,\s*\n\s*hasLivePlayback, hasB2Replay, verifiedYoutubeFallbackUrl,\s*\n\s*\);/,
  );
  assert.match(rendererSource, /const vodArchiveUrl = event\.vod_link \?\? '';/, 'legacy VOD selection must stay unchanged');
  assert.match(rendererSource, /const primaryHlsUrl = liveHlsUrl \|\| b2ReplayUrl \|\| archivePlaybackUrl;/);
});
