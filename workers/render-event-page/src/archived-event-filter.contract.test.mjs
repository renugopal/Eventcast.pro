// Focused contract test for the archived-event filtering fix in index.ts.
//
// LIMITATION: this worker package has no test harness (no jest/vitest/miniflare)
// and none is added here per scope constraints. This test statically inspects
// the source text of index.ts rather than executing the Workers fetch handler
// against a mocked PostgREST backend. It proves the two outbound Supabase
// REST query strings carry `archived_at=is.null` (so PostgREST itself excludes
// archived rows) and that no separate "archived" response branch was
// introduced (so an archived event still falls through to the existing
// generic not-found response). It does not prove runtime behavior end-to-end.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8');

function blockAfter(marker, length = 400) {
  const idx = source.indexOf(marker);
  assert.ok(idx !== -1, `expected to find marker in source: ${marker}`);
  return source.slice(idx, idx + length);
}

test('primary slug lookup permits public and unlisted (not private/synthetic), unarchived events before select/limit', () => {
  const block = blockAfter('`?slug=eq.${encodeURIComponent(slug)}`');
  assert.match(block, /event_visibility=in\.\(public,unlisted\)/, 'primary lookup must include event_visibility=in.(public,unlisted)');
  assert.match(block, /archived_at=is\.null/, 'primary lookup must include archived_at=is.null');
  assert.match(
    block,
    /event_visibility=in\.\(public,unlisted\)[\s\S]*?archived_at=is\.null[\s\S]*?select=\*,photographers\(\*\)[\s\S]*?limit=1/,
    'visibility and archive filters must appear before select/limit in the primary lookup',
  );
});

test('hyphenated-slug fallback lookup permits public and unlisted (not private/synthetic), unarchived events before select/limit', () => {
  const block = blockAfter('`?slug=eq.${encodeURIComponent(hyphenatedSlug)}`');
  assert.match(block, /event_visibility=in\.\(public,unlisted\)/, 'fallback lookup must include event_visibility=in.(public,unlisted)');
  assert.match(block, /archived_at=is\.null/, 'fallback lookup must include archived_at=is.null');
  assert.match(
    block,
    /event_visibility=in\.\(public,unlisted\)[\s\S]*?archived_at=is\.null[\s\S]*?select=\*,photographers\(\*\)[\s\S]*?limit=1/,
    'visibility and archive filters must appear before select/limit in the fallback lookup',
  );
});

test('an active (non-archived) event is unaffected: the filter only excludes rows, it does not change the select/columns/limit shape', () => {
  // Source builds the URL as concatenated template-literal segments, e.g.
  //   `&archived_at=is.null` +\n  `&select=*,photographers(*)` +\n  `&limit=1`
  // so match tolerating the intervening backtick/plus/whitespace between segments.
  const shapePattern = /&event_visibility=in\.\(public,unlisted\)`\s*\+\s*`&archived_at=is\.null`\s*\+\s*`&select=\*,photographers\(\*\)`\s*\+\s*`&limit=1`/g;
  const occurrences = source.match(shapePattern) ?? [];
  assert.equal(
    occurrences.length,
    2,
    'both queries must retain their original select/limit shape unchanged (with the widened filter inserted just before it), so active events keep the exact same row shape returned today',
  );
});

test('private, synthetic, archived, and missing events share a generic non-cacheable not-found response', () => {
  const notFoundChecks = source.match(/if \(!events \|\| events\.length === 0\)/g) ?? [];
  assert.equal(
    notFoundChecks.length,
    2,
    'expected exactly the two pre-existing empty-result checks (retry trigger + final not-found) — a new count would indicate an added branch',
  );

  assert.match(source, /return htmlError\(404\);/, 'the empty lookup must use the generic 404 helper');
  assert.match(source, /'Cache-Control': 'no-store, max-age=0'/, 'denied responses must not be cached');
});

test('HLS proxy, manifest, and service-worker responses cannot bypass the visibility lookup', () => {
  const eventResolvedAt = source.indexOf('const event = events[0];');
  const hlsReturnAt = source.indexOf('return serveHlsAssetFromR2(env, slug, event.id, hlsMatch[2]);');
  const serviceWorkerReturnAt = source.indexOf('return deferredServiceWorkerResponse;');
  const manifestAt = source.indexOf('if (manifestMatch) {');

  assert.ok(eventResolvedAt !== -1 && hlsReturnAt > eventResolvedAt, 'HLS proxy must run after the filtered event lookup');
  assert.ok(eventResolvedAt !== -1 && serviceWorkerReturnAt > eventResolvedAt, 'service worker must run after the filtered event lookup');
  assert.ok(eventResolvedAt !== -1 && manifestAt > eventResolvedAt, 'manifest must run after the filtered event lookup');
});
