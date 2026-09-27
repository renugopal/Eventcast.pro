// Behavior tests for post-End playback continuity, executing the REAL
// Worker fetch handler (index.ts) against an in-memory PostgREST stub and a
// fake R2 bucket (see worker-test-harness.mjs).

import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLUG,
  baseEnv,
  createDb,
  createFakeBucket,
  installSupabaseFetch,
  loadWorker,
  playlist,
  readConfig,
  request,
} from './worker-test-harness.mjs';

const P1 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';
const P2 = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2';
const HOUR = 3600_000;

let worker;
let restoreFetch = () => {};

before(async () => {
  worker = await loadWorker();
});

afterEach(() => {
  restoreFetch();
});

function setup({ assignment, recording = null, event = {}, envExtra = {} } = {}) {
  const db = createDb({ assignment, recording, event });
  restoreFetch = installSupabaseFetch(db);
  const bucket = createFakeBucket();
  const env = baseEnv(bucket, envExtra);
  return { db, bucket, env };
}

async function get(env, path) {
  const res = await worker.fetch(request(path), env);
  return { status: res.status, text: await res.text() };
}

const LIVE = `/events/${SLUG}/hls/live/index.m3u8`;
const VOD = `/events/${SLUG}/hls/vod/index.m3u8`;
const SEG = `/events/${SLUG}/hls/media/sess1/seg-1.ts`;
const PAGE = `/events/${SLUG}`;

function finalizedRecording(overrides = {}) {
  return {
    recording_state: 'local_finalized',
    finalization_generation: 'gen-1',
    integrity_verified_at: null,
    retention_expires_at: null,
    youtube_fallback_url: null,
    youtube_fallback_verified: false,
    r2_playback_id: P1,
    gap_count: 0,
    gap_status: 'none',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Zero-gap End
// ---------------------------------------------------------------------------

test('zero-gap: flipping enabled true->false never by itself 404s the live manifest or segments', async () => {
  const { db, bucket, env } = setup({ assignment: { playback_id: P1, enabled: true } });
  bucket.put(`events/${P1}/live/index.m3u8`, playlist(P1), { uploaded: new Date() });
  bucket.put(`events/${P1}/media/sess1/seg-1.ts`, 'SEGMENT-BYTES');

  const liveBefore = await get(env, LIVE);
  const segBefore = await get(env, SEG);
  assert.equal(liveBefore.status, 200);
  assert.equal(segBefore.status, 200);

  // Provider End: only the enabled flag changes; the playback id is preserved.
  db.assignment = { playback_id: P1, enabled: false };

  const liveAfter = await get(env, LIVE);
  const segAfter = await get(env, SEG);
  assert.equal(liveAfter.status, 200, 'bridge must keep serving the same live URL');
  assert.equal(segAfter.status, 200);
  assert.equal(liveAfter.text, liveBefore.text, 'same rewritten manifest, no URL change');
  assert.equal(segAfter.text, 'SEGMENT-BYTES');
  assert.doesNotMatch(liveAfter.text, new RegExp(P1), 'the private playback id never leaves the Worker');
  assert.match(liveAfter.text, new RegExp(`/events/${SLUG}/hls/media/sess1/seg-1\\.ts`));
});

test('bridge -> finalized R2: once the pointer is proven, new pages advertise VOD while the open live URL keeps working', async () => {
  const { db, bucket, env } = setup({ assignment: { playback_id: P1, enabled: false } });
  bucket.put(`events/${P1}/live/index.m3u8`, playlist(P1), { uploaded: new Date() });
  bucket.put(`events/${P1}/media/sess1/seg-1.ts`, 'SEGMENT-BYTES');

  let page = await get(env, PAGE);
  assert.match(readConfig(page.text).restreamerUrl, /\/hls\/live\/index\.m3u8$/, 'bridge advertised pre-finalization');

  // Finalization lands: VOD published + durable proven pointer.
  bucket.put(`events/${P1}/vod/index.m3u8`, playlist(P1, { endlist: true }));
  db.recording = finalizedRecording();

  page = await get(env, PAGE);
  assert.match(readConfig(page.text).restreamerUrl, /\/hls\/vod\/index\.m3u8$/, 'finalized R2 preferred for new loads');
  assert.equal((await get(env, VOD)).status, 200);
  assert.equal((await get(env, LIVE)).status, 200, 'already-open players keep their live URL (no 404 gap)');
  assert.equal((await get(env, SEG)).status, 200);
});

// ---------------------------------------------------------------------------
// Stale / missing intermediate manifests and configuration
// ---------------------------------------------------------------------------

test('stale intermediate manifest beyond the default 3h bound: 404 and not advertised', async () => {
  const { bucket, env } = setup({ assignment: { playback_id: P1, enabled: false } });
  bucket.put(`events/${P1}/live/index.m3u8`, playlist(P1), { uploaded: new Date(Date.now() - 3 * HOUR - 60_000) });
  bucket.put(`events/${P1}/media/sess1/seg-1.ts`, 'SEGMENT-BYTES');

  assert.equal((await get(env, LIVE)).status, 404);
  assert.equal((await get(env, SEG)).status, 404, 'segments need a fresh bridge or finalized R2');
  const cfg = readConfig((await get(env, PAGE)).text);
  assert.equal(cfg.restreamerUrl, '');
});

test('within the default bound (2h old) the bridge still serves', async () => {
  const { bucket, env } = setup({ assignment: { playback_id: P1, enabled: false } });
  bucket.put(`events/${P1}/live/index.m3u8`, playlist(P1), { uploaded: new Date(Date.now() - 2 * HOUR) });
  assert.equal((await get(env, LIVE)).status, 200);
});

test('configured bound is honored; invalid configuration falls back to the 3h default', async () => {
  const configured = setup({
    assignment: { playback_id: P1, enabled: false },
    envExtra: { PLAYBACK_BRIDGE_MAX_AGE_SECONDS: '60' },
  });
  configured.bucket.put(`events/${P1}/live/index.m3u8`, playlist(P1), { uploaded: new Date(Date.now() - 120_000) });
  assert.equal((await get(configured.env, LIVE)).status, 404);
  restoreFetch();

  const invalid = setup({
    assignment: { playback_id: P1, enabled: false },
    envExtra: { PLAYBACK_BRIDGE_MAX_AGE_SECONDS: 'not-a-number' },
  });
  invalid.bucket.put(`events/${P1}/live/index.m3u8`, playlist(P1), { uploaded: new Date(Date.now() - 120_000) });
  assert.equal((await get(invalid.env, LIVE)).status, 200);
});

test('missing intermediate manifest: 404 and no bridge advertised', async () => {
  const { env } = setup({ assignment: { playback_id: P1, enabled: false } });
  assert.equal((await get(env, LIVE)).status, 404);
  assert.equal(readConfig((await get(env, PAGE)).text).restreamerUrl, '');
});

test('a never-activated assignment (no playback id) serves nothing', async () => {
  const { env } = setup({ assignment: { playback_id: null, enabled: false } });
  assert.equal((await get(env, LIVE)).status, 404);
  assert.equal((await get(env, VOD)).status, 404);
});

// ---------------------------------------------------------------------------
// Finalized R2 gating
// ---------------------------------------------------------------------------

test('finalized R2 VOD requires the proven pointer, eligible gap state and the object', async () => {
  const cases = [
    { name: 'eligible', recording: finalizedRecording(), vod: true, expect: 200 },
    { name: 'no pointer', recording: finalizedRecording({ r2_playback_id: null }), vod: true, expect: 404 },
    { name: 'pending_review', recording: finalizedRecording({ gap_count: 1, gap_status: 'pending_review' }), vod: true, expect: 404 },
    { name: 'rejected', recording: finalizedRecording({ gap_count: 1, gap_status: 'rejected' }), vod: true, expect: 404 },
    { name: 'acknowledged', recording: finalizedRecording({ gap_count: 1, gap_status: 'acknowledged' }), vod: true, expect: 200 },
    { name: 'failed state', recording: finalizedRecording({ recording_state: 'failed' }), vod: true, expect: 404 },
    { name: 'retention expired', recording: finalizedRecording({ retention_expires_at: new Date(Date.now() - 1000).toISOString() }), vod: true, expect: 404 },
    { name: 'object missing', recording: finalizedRecording(), vod: false, expect: 404 },
  ];
  for (const c of cases) {
    const { bucket, env } = setup({ assignment: { playback_id: P1, enabled: false }, recording: c.recording });
    if (c.vod) bucket.put(`events/${P1}/vod/index.m3u8`, playlist(P1, { endlist: true }));
    assert.equal((await get(env, VOD)).status, c.expect, c.name);
    restoreFetch();
  }
});

test('pending_review recording is not advertised as R2 replay (bridge only while fresh)', async () => {
  const { bucket, env } = setup({
    assignment: { playback_id: P1, enabled: false },
    recording: finalizedRecording({ gap_count: 3, gap_status: 'pending_review' }),
  });
  bucket.put(`events/${P1}/vod/index.m3u8`, playlist(P1, { endlist: true }));
  bucket.put(`events/${P1}/live/index.m3u8`, playlist(P1), { uploaded: new Date() });
  const cfg = readConfig((await get(env, PAGE)).text);
  assert.match(cfg.restreamerUrl, /\/hls\/live\/index\.m3u8$/, 'falls back to the bridge, never the gapped VOD');
  assert.equal(cfg.playbackMode, 'replay');
});

// ---------------------------------------------------------------------------
// Reactivation
// ---------------------------------------------------------------------------

test('reactivation: a new enabled playback id serves only its own objects; the previous bridge/VOD is unreachable', async () => {
  const { db, bucket, env } = setup({
    assignment: { playback_id: P1, enabled: false },
    recording: finalizedRecording(),
  });
  bucket.put(`events/${P1}/live/index.m3u8`, playlist(P1), { uploaded: new Date() });
  bucket.put(`events/${P1}/vod/index.m3u8`, playlist(P1, { endlist: true }));
  assert.equal((await get(env, VOD)).status, 200);

  // Re-activation: new playback id + enabled in one UPDATE.
  db.assignment = { playback_id: P2, enabled: true };
  assert.equal((await get(env, LIVE)).status, 404, 'P2 has no live manifest yet; P1 must not be served');
  assert.equal((await get(env, VOD)).status, 404, 'P1 VOD is unreachable through P2');

  bucket.put(`events/${P2}/live/index.m3u8`, playlist(P2), { uploaded: new Date() });
  const live = await get(env, LIVE);
  assert.equal(live.status, 200);
  assert.equal(readConfig((await get(env, PAGE)).text).playbackMode, 'live');

  // Second End: the stale P1 pointer can never become R2-final under P2.
  db.assignment = { playback_id: P2, enabled: false };
  bucket.put(`events/${P2}/vod/index.m3u8`, playlist(P2, { endlist: true }));
  assert.equal((await get(env, VOD)).status, 404, 'pointer (P1) != preserved playback id (P2)');
  assert.equal((await get(env, LIVE)).status, 200, 'bridge continues under P2');
});

// ---------------------------------------------------------------------------
// Multi-prefix / multi-activation fail-closed
// ---------------------------------------------------------------------------

test('a bridge manifest spanning another playback id prefix fails closed (404)', async () => {
  const { bucket, env } = setup({ assignment: { playback_id: P2, enabled: false } });
  const mixed = `${playlist(P2)}#EXTINF:4.000,\n/events/${P1}/media/sess0/seg-9.ts\n`;
  bucket.put(`events/${P2}/live/index.m3u8`, mixed, { uploaded: new Date() });
  assert.equal((await get(env, LIVE)).status, 404);
});

test('a VOD object that exists without a proven pointer (multi-activation) is never served', async () => {
  const { bucket, env } = setup({
    assignment: { playback_id: P2, enabled: false },
    recording: finalizedRecording({ r2_playback_id: null }),
  });
  bucket.put(`events/${P2}/vod/index.m3u8`, playlist(P2, { endlist: true }));
  assert.equal((await get(env, VOD)).status, 404);
  assert.doesNotMatch(readConfig((await get(env, PAGE)).text).restreamerUrl, /\/hls\/vod\//);
});

// ---------------------------------------------------------------------------
// Page precedence, playback mode, legacy fallback preservation
// ---------------------------------------------------------------------------

test('actual live event gets the live URL and live playback mode', async () => {
  const { bucket, env } = setup({ assignment: { playback_id: P1, enabled: true } });
  bucket.put(`events/${P1}/live/index.m3u8`, playlist(P1), { uploaded: new Date() });
  const cfg = readConfig((await get(env, PAGE)).text);
  assert.match(cfg.restreamerUrl, /\/hls\/live\/index\.m3u8$/);
  assert.equal(cfg.playbackMode, 'live');
});

test('ended bridge is advertised on the live URL but in replay mode (never LIVE NOW)', async () => {
  const { bucket, env } = setup({ assignment: { playback_id: P1, enabled: false } });
  bucket.put(`events/${P1}/live/index.m3u8`, playlist(P1), { uploaded: new Date() });
  const cfg = readConfig((await get(env, PAGE)).text);
  assert.match(cfg.restreamerUrl, /\/hls\/live\/index\.m3u8$/);
  assert.equal(cfg.playbackMode, 'replay');
});

test('B2 authoritative replay outranks finalized R2 and the bridge, in replay mode', async () => {
  const { bucket, env } = setup({
    assignment: { playback_id: P1, enabled: false },
    recording: finalizedRecording({
      recording_state: 'b2_finalized',
      integrity_verified_at: new Date().toISOString(),
      retention_expires_at: new Date(Date.now() + 30 * 24 * HOUR).toISOString(),
    }),
    envExtra: {
      B2_S3_ENDPOINT: 'https://b2.test',
      B2_REGION: 'us-west-000',
      B2_BUCKET_NAME: 'b',
      B2_ACCESS_KEY_ID: 'k',
      B2_SECRET_ACCESS_KEY: 's',
    },
  });
  bucket.put(`events/${P1}/vod/index.m3u8`, playlist(P1, { endlist: true }));
  bucket.put(`events/${P1}/live/index.m3u8`, playlist(P1), { uploaded: new Date() });
  const cfg = readConfig((await get(env, PAGE)).text);
  assert.match(cfg.restreamerUrl, /\/vod\/b2\/index\.m3u8$/);
  assert.equal(cfg.playbackMode, 'replay');
});

test('finalized R2 page is in replay mode', async () => {
  const { bucket, env } = setup({ assignment: { playback_id: P1, enabled: false }, recording: finalizedRecording() });
  bucket.put(`events/${P1}/vod/index.m3u8`, playlist(P1, { endlist: true }));
  const cfg = readConfig((await get(env, PAGE)).text);
  assert.match(cfg.restreamerUrl, /\/hls\/vod\/index\.m3u8$/);
  assert.equal(cfg.playbackMode, 'replay');
});

test('legacy vod_link fallback is preserved when no Worker playback path applies', async () => {
  const { env } = setup({
    assignment: null,
    event: { vod_link: 'https://archive.example.com/legacy/event.m3u8' },
  });
  const cfg = readConfig((await get(env, PAGE)).text);
  assert.equal(cfg.restreamerUrl, 'https://archive.example.com/legacy/event.m3u8');
  assert.equal(cfg.playbackMode, 'replay');
});

test('a Worker playback path outranks the legacy vod_link archive', async () => {
  const { bucket, env } = setup({
    assignment: { playback_id: P1, enabled: false },
    event: { vod_link: 'https://archive.example.com/legacy/event.m3u8' },
  });
  bucket.put(`events/${P1}/live/index.m3u8`, playlist(P1), { uploaded: new Date() });
  assert.match(readConfig((await get(env, PAGE)).text).restreamerUrl, /\/hls\/live\/index\.m3u8$/);
});

test('a legacy YouTube broadcast (live state unknowable server-side) keeps the template default mode', async () => {
  const { env } = setup({ assignment: null, event: { youtube_broadcast_id: 'abcdEFGH123' } });
  const cfg = readConfig((await get(env, PAGE)).text);
  assert.equal(cfg.youtubeId, 'abcdEFGH123');
  assert.equal(cfg.playbackMode, '');
});

test('no playback at all: empty player source and default mode', async () => {
  const { env } = setup({ assignment: null });
  const cfg = readConfig((await get(env, PAGE)).text);
  assert.equal(cfg.restreamerUrl, '');
  assert.equal(cfg.playbackMode, '');
});
