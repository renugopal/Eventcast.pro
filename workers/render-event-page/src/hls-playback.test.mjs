// Executable unit tests for the private-R2 playback helpers.
//
// These run the real functions (unlike the older static-source contract
// test in this package, which can only inspect index.ts text). No test
// framework, no Miniflare, no new dependency: node:test + node:assert only.
//
//   node --test src/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildR2Key,
  fallbackCacheControl,
  fallbackContentType,
  isValidPlaybackId,
  parseHlsAssetPath,
  rewriteManifest,
} from './hls-playback.mjs';

const PLAYBACK_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const SLUG = 'ananya-rohan-wedding';

// ---------------------------------------------------------------------------
// parseHlsAssetPath — the only gate between a request path and an R2 key
// ---------------------------------------------------------------------------

test('accepts exactly the three published asset shapes', () => {
  assert.deepEqual(parseHlsAssetPath('live/index.m3u8'), {
    kind: 'manifest', assetPath: 'live/index.m3u8', variant: 'live',
  });
  assert.deepEqual(parseHlsAssetPath('vod/index.m3u8'), {
    kind: 'manifest', assetPath: 'vod/index.m3u8', variant: 'vod',
  });
  assert.deepEqual(parseHlsAssetPath('media/sess-01/42-live_0.ts'), {
    kind: 'segment',
    assetPath: 'media/sess-01/42-live_0.ts',
    sessionId: 'sess-01',
    fileName: '42-live_0.ts',
  });
});

test('rejects path traversal in every spelling', () => {
  for (const bad of [
    '../live/index.m3u8',
    'media/../../secrets/key',
    'media/sess-01/../../../etc/passwd',
    'media/./sess-01/1-a.ts',
    'media/../sess-01/1-a.ts',
    'media/sess-01/..',
    'media/sess-01/.',
    '..',
    '../../events/other/live/index.m3u8',
  ]) {
    assert.equal(parseHlsAssetPath(bad), null, `must reject: ${bad}`);
  }
});

test('rejects percent-encoding rather than decoding it', () => {
  for (const bad of [
    'media/sess-01/%2e%2e%2fsecret.ts',
    'media%2fsess-01%2f1-a.ts',
    'live%2findex.m3u8',
    'media/sess%2D01/1-a.ts',
  ]) {
    assert.equal(parseHlsAssetPath(bad), null, `must reject: ${bad}`);
  }
});

test('rejects wrong shape: depth, empty components, separators, query, fragment', () => {
  for (const bad of [
    '',
    '/',
    'live',
    'live/index.m3u8/',
    '/live/index.m3u8',
    'live//index.m3u8',
    'media/sess-01',
    'media/sess-01/nested/1-a.ts',
    'media\\sess-01\\1-a.ts',
    'live/index.m3u8?token=1',
    'live/index.m3u8#frag',
    'other/index.m3u8',
    'live/playlist.m3u8',
    'vod/index.M3U8',
    'MEDIA/sess-01/1-a.ts',
  ]) {
    assert.equal(parseHlsAssetPath(bad), null, `must reject: ${bad}`);
  }
});

test('rejects hostile component charsets, control bytes, and non-strings', () => {
  for (const bad of [
    'media/sess 01/1-a.ts',
    'media/sess-01/1 a.ts',
    'media/sess-01/1-a.ts\u0000.png',
    'media/sess-01/.ts',
    'media/.hidden/1-a.ts',
    'media/sess-01/.hidden.ts',
    'media/sess-01/1-a.exe',
    'media/sess-01/1-a',
    `media/${'s'.repeat(129)}/1-a.ts`,
    `media/sess-01/${'a'.repeat(200)}.ts`,
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(parseHlsAssetPath(bad), null, `must reject: ${String(bad)}`);
  }
});

test('accepts the Media Agent segment naming convention verbatim', () => {
  // internal/spool.SegmentFileName => "<seq_no>-<sanitized basename>",
  // sanitized to [A-Za-z0-9._-].
  const parsed = parseHlsAssetPath('media/2f0c9e1a/1738-live-0_1.ts');
  assert.equal(parsed?.kind, 'segment');
  assert.equal(parsed?.fileName, '1738-live-0_1.ts');
});

// ---------------------------------------------------------------------------
// isValidPlaybackId / buildR2Key
// ---------------------------------------------------------------------------

test('playback id validation matches the key-component charset', () => {
  assert.equal(isValidPlaybackId(PLAYBACK_ID), true);
  for (const bad of ['', '../other', 'a/b', 'a b', '.hidden', '-lead', 'x'.repeat(129), null, 7]) {
    assert.equal(isValidPlaybackId(bad), false, `must reject: ${String(bad)}`);
  }
});

test('builds keys in the Media Agent layout (internal/upload/keys.go)', () => {
  assert.equal(buildR2Key(PLAYBACK_ID, 'live/index.m3u8'), `events/${PLAYBACK_ID}/live/index.m3u8`);
  assert.equal(buildR2Key(PLAYBACK_ID, 'vod/index.m3u8'), `events/${PLAYBACK_ID}/vod/index.m3u8`);
  assert.equal(
    buildR2Key(PLAYBACK_ID, 'media/sess-01/42-live_0.ts'),
    `events/${PLAYBACK_ID}/media/sess-01/42-live_0.ts`,
  );
});

test('never builds a key from an invalid playback id or asset path', () => {
  assert.equal(buildR2Key('../escape', 'live/index.m3u8'), null);
  assert.equal(buildR2Key(PLAYBACK_ID, '../../other/live/index.m3u8'), null);
  assert.equal(buildR2Key(PLAYBACK_ID, 'media/sess-01/%2e%2e/x.ts'), null);
  assert.equal(buildR2Key(null, 'live/index.m3u8'), null);
});

// ---------------------------------------------------------------------------
// rewriteManifest
// ---------------------------------------------------------------------------

const AGENT_MANIFEST = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:6',
  '#EXT-X-MEDIA-SEQUENCE:12',
  '#EXTINF:6.000,',
  `/events/${PLAYBACK_ID}/media/sess-01/12-live_0.ts`,
  '#EXT-X-DISCONTINUITY',
  '#EXTINF:5.960,',
  `/events/${PLAYBACK_ID}/media/sess-02/13-live_0.ts`,
  '',
].join('\n');

test('rewrites every segment reference onto the public route', () => {
  const out = rewriteManifest(AGENT_MANIFEST, PLAYBACK_ID, SLUG);
  assert.equal(
    out,
    [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:6',
      '#EXT-X-MEDIA-SEQUENCE:12',
      '#EXTINF:6.000,',
      `/events/${SLUG}/hls/media/sess-01/12-live_0.ts`,
      '#EXT-X-DISCONTINUITY',
      '#EXTINF:5.960,',
      `/events/${SLUG}/hls/media/sess-02/13-live_0.ts`,
      '',
    ].join('\n'),
  );
});

test('the rewritten manifest never contains the playback id', () => {
  const out = rewriteManifest(AGENT_MANIFEST, PLAYBACK_ID, SLUG);
  assert.ok(out !== null);
  assert.ok(!out.includes(PLAYBACK_ID), 'playback id must not survive rewriting');
});

test('tags, blank lines, and CRLF terminators are preserved byte-for-byte', () => {
  const crlf = `#EXTM3U\r\n#EXTINF:6.000,\r\n/events/${PLAYBACK_ID}/media/s1/1-a.ts\r\n#EXT-X-ENDLIST\r\n`;
  assert.equal(
    rewriteManifest(crlf, PLAYBACK_ID, SLUG),
    `#EXTM3U\r\n#EXTINF:6.000,\r\n/events/${SLUG}/hls/media/s1/1-a.ts\r\n#EXT-X-ENDLIST\r\n`,
  );
});

test('rewrites absolute segment URLs onto the public route too', () => {
  const absolute = `#EXTM3U\n#EXTINF:6.000,\nhttps://cdn.example.net/events/${PLAYBACK_ID}/media/s1/1-a.ts\n`;
  assert.equal(
    rewriteManifest(absolute, PLAYBACK_ID, SLUG),
    `#EXTM3U\n#EXTINF:6.000,\n/events/${SLUG}/hls/media/s1/1-a.ts\n`,
  );
});

test('slug is URL-encoded in rewritten references', () => {
  const out = rewriteManifest(
    `#EXTM3U\n/events/${PLAYBACK_ID}/media/s1/1-a.ts\n`,
    PLAYBACK_ID,
    'a b/c',
  );
  assert.equal(out, `#EXTM3U\n/events/a%20b%2Fc/hls/media/s1/1-a.ts\n`);
});

test('fails closed on any URI line it cannot fully account for', () => {
  const foreignPlaybackId = 'ffffffffffffffffffffffffffffffff';
  for (const hostile of [
    // another event's playback id
    `#EXTM3U\n/events/${foreignPlaybackId}/media/s1/1-a.ts\n`,
    // a direct bucket URL
    '#EXTM3U\nhttps://eventcast-media.r2.cloudflarestorage.com/events/x/media/s1/1-a.ts\n',
    // traversal smuggled into the session component
    `#EXTM3U\n/events/${PLAYBACK_ID}/media/../../secret/1-a.ts\n`,
    // wrong depth under our own prefix
    `#EXTM3U\n/events/${PLAYBACK_ID}/media/s1/nested/1-a.ts\n`,
    // an unrelated URI line
    '#EXTM3U\nhttps://media.eventcast.pro/memfs/live.m3u8\n',
  ]) {
    assert.equal(rewriteManifest(hostile, PLAYBACK_ID, SLUG), null, `must fail closed: ${hostile}`);
  }
});

test('rejects invalid rewrite inputs outright', () => {
  assert.equal(rewriteManifest('#EXTM3U\n', '../bad', SLUG), null);
  assert.equal(rewriteManifest('#EXTM3U\n', PLAYBACK_ID, ''), null);
  assert.equal(rewriteManifest(null, PLAYBACK_ID, SLUG), null);
});

test('fails closed on empty or whitespace-only manifest bodies', () => {
  assert.equal(rewriteManifest('', PLAYBACK_ID, SLUG), null);
  assert.equal(rewriteManifest('   ', PLAYBACK_ID, SLUG), null);
  assert.equal(rewriteManifest('\n\n  \n', PLAYBACK_ID, SLUG), null);
});

test('fails closed on non-HLS text lacking a valid #EXTM3U header', () => {
  assert.equal(rewriteManifest('hello world', PLAYBACK_ID, SLUG), null);
  assert.equal(rewriteManifest('# not a real header\n# still not one\n', PLAYBACK_ID, SLUG), null);
  assert.equal(rewriteManifest('<html>not a playlist</html>', PLAYBACK_ID, SLUG), null);
});

test('accepts a legitimate header-only manifest with no segment lines yet', () => {
  const headerOnly = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n';
  assert.equal(rewriteManifest(headerOnly, PLAYBACK_ID, SLUG), headerOnly);
});

test('still accepts and rewrites a valid manifest with URI lines', () => {
  const out = rewriteManifest(AGENT_MANIFEST, PLAYBACK_ID, SLUG);
  assert.ok(out !== null);
  assert.ok(out.startsWith('#EXTM3U'));
  assert.ok(out.includes(`/events/${SLUG}/hls/media/sess-01/12-live_0.ts`));
});

// ---------------------------------------------------------------------------
// Content-Type / Cache-Control fallbacks
// ---------------------------------------------------------------------------

test('fallback content types match the asset kind', () => {
  assert.equal(fallbackContentType(parseHlsAssetPath('live/index.m3u8')), 'application/vnd.apple.mpegurl');
  assert.equal(fallbackContentType(parseHlsAssetPath('vod/index.m3u8')), 'application/vnd.apple.mpegurl');
  assert.equal(fallbackContentType(parseHlsAssetPath('media/s1/1-a.ts')), 'video/MP2T');
  assert.equal(fallbackContentType(parseHlsAssetPath('media/s1/1-a.m4s')), 'video/mp4');
});

test('fallback cache control never caches manifests and freezes segments', () => {
  assert.equal(fallbackCacheControl(parseHlsAssetPath('live/index.m3u8')), 'no-store, no-cache, must-revalidate');
  assert.equal(fallbackCacheControl(parseHlsAssetPath('vod/index.m3u8')), 'no-store, no-cache, must-revalidate');
  assert.equal(fallbackCacheControl(parseHlsAssetPath('media/s1/1-a.ts')), 'public, max-age=31536000, immutable');
});
