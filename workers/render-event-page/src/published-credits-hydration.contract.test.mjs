// Focused contract test for the controlled Public Page Publish action's two
// public-render invariants: the page-state gate that decides whether a page
// is publicly renderable at all, and the frozen public Event Credit snapshot
// it renders (Baseline V2.1 CRT-012 / PART-006).
//
// LIMITATION: this worker package has no test harness (no jest/vitest/
// miniflare) and none is added here per scope constraints — same convention
// as `archived-event-filter.contract.test.mjs`. This test statically inspects
// the source text of index.ts rather than executing the Workers fetch handler
// against a mocked PostgREST backend. It proves the rendered credit input is
// taken from the event row's own frozen `published_credits` snapshot and that
// the Worker never queries the mutable `partners` / `event_credits` tables to
// rebuild it. It does not prove runtime behavior end-to-end.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8');

function lookupBlockAfter(marker, length = 400) {
  const idx = source.indexOf(marker);
  assert.ok(idx !== -1, `expected to find marker in source: ${marker}`);
  return source.slice(idx, idx + length);
}

// This Worker reads with the service-role key, which bypasses the
// `events_public_select_policy` RLS rule migration 0029 installed for
// anonymous reads. The Published requirement must therefore be stated
// explicitly in both lookups, or a Draft would render publicly before the
// controlled Publish action ever ran. `event_visibility=in.(public,unlisted)`
// (Visibility Foundation Gate, migration 0031) is this Worker's own
// deliberate widening — it is the sole path that delivers a Published +
// Unlisted page by exact direct link, since events_public_select_policy is
// intentionally left Public-only and never widened.
for (const [pathName, marker] of [
  ['primary slug lookup', '`?slug=eq.${encodeURIComponent(slug)}`'],
  ['hyphenated-slug fallback lookup', '`?slug=eq.${encodeURIComponent(hyphenatedSlug)}`'],
]) {
  test(`${pathName} renders only Published pages, keeping the existing visibility and archive filters`, () => {
    const block = lookupBlockAfter(marker);
    assert.match(block, /page_state=eq\.published/, `${pathName} must require page_state=eq.published`);
    assert.match(block, /event_visibility=in\.\(public,unlisted\)/, `${pathName} must keep event_visibility=in.(public,unlisted)`);
    assert.match(block, /archived_at=is\.null/, `${pathName} must keep archived_at=is.null`);
    assert.match(
      block,
      /page_state=eq\.published[\s\S]*?event_visibility=in\.\(public,unlisted\)[\s\S]*?archived_at=is\.null[\s\S]*?select=\*,photographers\(\*\)[\s\S]*?limit=1/,
      `${pathName} must apply all three row filters before select/limit`,
    );
  });
}

test('the page-state gate is present on every public event lookup, not just one path', () => {
  const gates = source.match(/&page_state=eq\.published/g) ?? [];
  assert.equal(gates.length, 2, 'both public event lookups must carry the page-state gate');
  // A Draft that fails the gate falls through to the two pre-existing
  // empty-result branches (retry trigger + generic 404) — no new "draft"
  // response branch, and therefore no way to distinguish a Draft from a
  // nonexistent event from outside.
  assert.ok(
    !/page_state[^\n]*draft/i.test(source),
    'the Worker must not introduce any draft-specific lookup or response branch',
  );
});

test('rendered event credits come from the row\'s frozen published_credits snapshot', () => {
  assert.match(
    source,
    /const publishedCredits: PublicEventCredit\[\] = Array\.isArray\(event\.published_credits\)\s*\?\s*event\.published_credits\s*:\s*\[\]/,
    'published_credits must be read straight off the fetched event row, defaulting to an empty list',
  );
  assert.match(
    source,
    /event\.event_credits = publishedCredits;/,
    'the renderer\'s eventCredits input must be hydrated from the frozen snapshot',
  );
});

test('the Worker never queries the mutable partners / event_credits tables to rebuild the snapshot', () => {
  assert.ok(
    !/rest\/v1\/partners/.test(source),
    'the Worker must not query the live partners table for public credit data',
  );
  assert.ok(
    !/rest\/v1\/event_credits/.test(source),
    'the Worker must not query the live event_credits table for public credit data',
  );
  // The only event lookups remain the two existing `select=*,photographers(*)`
  // reads — no extra embedded partner/credit join was added.
  const selectShapes = source.match(/&select=\*,photographers\(\*\)/g) ?? [];
  assert.equal(selectShapes.length, 2, 'both event lookups must keep their existing select shape');
});

test('the snapshot is consumed as-is: no re-projection of Partner fields in the Worker', () => {
  assert.match(
    source,
    /import \{\s*primaryPublicEventCreditToPhotographerRow,\s*type PublicEventCredit,?\s*\} from '\.\.\/\.\.\/\.\.\/eventcast-admin\/src\/lib\/eventContract'/,
    'the Worker must reuse the shared PublicEventCredit contract/adapter, not redefine one',
  );
  for (const privateField of ['contact_person', 'internal_notes', 'whatsapp']) {
    assert.ok(
      !source.includes(privateField),
      `private Partner field "${privateField}" must never appear in the Worker`,
    );
  }
});

test('the primary frozen credit fills the existing footer slot, with the legacy photographer as fallback', () => {
  assert.match(
    source,
    /const photographer: PhotographerRow \| null =\s*primaryPublicEventCreditToPhotographerRow\(publishedCredits\) \?\? legacyPhotographer;/,
    'a snapshot primary credit must take the footer slot, falling back to the legacy photographers join',
  );
  assert.match(
    source,
    /renderEvent\(\s*templateHtml, event, photographer,/,
    'renderEvent must still receive the single resolved photographer/credit footer value',
  );
});
