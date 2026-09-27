// Executes the shared renderer (eventcast-admin/src/lib/weddingTemplateRenderer.ts,
// dependency-free) directly under Node 24 type stripping to pin the
// state-aware source order and the playbackMode presentation signal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderEvent } from '../../../eventcast-admin/src/lib/weddingTemplateRenderer.ts';

const TEMPLATE = '<html><head></head><body></body></html>';
const ENV = { SUPABASE_URL: 'https://supabase.test', SUPABASE_ANON_KEY: 'anon' };
const HOST = 'eventcast.pro';
const SLUG = 'demo';

function event(overrides = {}) {
  return { id: 'e1', slug: SLUG, studio_id: 's1', event_date: '2026-09-01', ...overrides };
}

function render(ev, { live = false, b2 = false, fallback = null, continuity = {} } = {}) {
  const html = renderEvent(TEMPLATE, ev, null, SLUG, ENV, 'IN', HOST, live, b2, fallback, continuity);
  const pick = (name) => html.match(new RegExp(`${name}: "([^"]*)"`))?.[1] ?? null;
  return { src: pick('restreamerUrl'), mode: pick('playbackMode'), youtubeId: pick('youtubeId') };
}

const LIVE_URL = `https://${HOST}/events/${SLUG}/hls/live/index.m3u8`;
const R2_URL = `https://${HOST}/events/${SLUG}/hls/vod/index.m3u8`;
const B2_URL = `https://${HOST}/events/${SLUG}/vod/b2/index.m3u8`;

test('actual live: live URL, live mode; continuity signals are ignored while live', () => {
  const r = render(event(), { live: true, b2: true, continuity: { r2VodReplay: true, liveBridge: true } });
  assert.equal(r.src, LIVE_URL);
  assert.equal(r.mode, 'live');
});

test('state-aware order after End: B2 > finalized R2 > bridge > legacy archive, all replay mode', () => {
  const legacy = event({ vod_link: 'https://archive.example.com/x.m3u8' });
  assert.deepEqual(
    [render(legacy, { b2: true, continuity: { r2VodReplay: true, liveBridge: true } }).src],
    [B2_URL],
  );
  assert.equal(render(legacy, { continuity: { r2VodReplay: true, liveBridge: true } }).src, R2_URL);
  const bridge = render(legacy, { continuity: { liveBridge: true } });
  assert.equal(bridge.src, LIVE_URL, 'bridge reuses the live URL an open player already holds');
  assert.equal(bridge.mode, 'replay', 'the bridge is never presented as live');
  const archive = render(legacy);
  assert.equal(archive.src, 'https://archive.example.com/x.m3u8');
  assert.equal(archive.mode, 'replay');
});

test('legacy vod_link YouTube id and the verified fallback are replay; broadcast/url stay default', () => {
  assert.equal(render(event({ vod_link: 'https://youtu.be/VODID123' })).mode, 'replay');
  assert.equal(render(event({ youtube_broadcast_id: 'BCAST1' })).mode, '');
  assert.equal(render(event({ youtube_url: 'https://youtu.be/URLID9' })).mode, '');
  const verified = render(event(), { fallback: 'https://youtu.be/VERIFIED7' });
  assert.equal(verified.youtubeId, 'VERIFIED7');
  assert.equal(verified.mode, 'replay');
});

test('verified YouTube fallback never displaces finalized R2 or bridge playback', () => {
  assert.equal(render(event(), { fallback: 'https://youtu.be/V7', continuity: { r2VodReplay: true } }).youtubeId, '');
  assert.equal(render(event(), { fallback: 'https://youtu.be/V7', continuity: { liveBridge: true } }).youtubeId, '');
});

test('existing callers without the continuity argument behave exactly as before', () => {
  const html = renderEvent(TEMPLATE, event(), null, SLUG, ENV, 'IN', HOST, false, true, null);
  assert.match(html, /restreamerUrl: "https:\/\/eventcast\.pro\/events\/demo\/vod\/b2\/index\.m3u8"/);
});
