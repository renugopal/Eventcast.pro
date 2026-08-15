// Focused contract test for the Public / Unlisted Visibility Foundation
// Gate's Worker-side delivery rules.
//
// LIMITATION: this worker package has no test harness (no jest/vitest/
// miniflare) and none is added here per scope constraints — same convention
// as the other `*.contract.test.mjs` files in this directory. This test
// statically inspects the source text of index.ts rather than executing the
// Workers fetch handler against a mocked PostgREST backend. It does not
// prove runtime behavior end-to-end.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8');

test('both public event lookups accept Public and Unlisted only, never private/synthetic', () => {
  const inClauseOccurrences = source.match(/event_visibility=in\.\(public,unlisted\)/g) ?? [];
  assert.equal(inClauseOccurrences.length, 2, 'both the primary and fallback lookups must use the widened IN clause');
  assert.ok(
    !source.includes('event_visibility=eq.public'),
    'the old Public-only equality filter must be fully replaced, not left alongside the new one',
  );
  assert.ok(!source.includes('unlisted,private') && !source.includes('private,unlisted'), 'private must never be an accepted value');
  assert.ok(!source.includes('unlisted,synthetic') && !source.includes('synthetic,unlisted'), 'synthetic must never be an accepted value');
});

test('both public event lookups still require Published state and non-archived rows', () => {
  const publishedGates = source.match(/&page_state=eq\.published/g) ?? [];
  assert.equal(publishedGates.length, 2, 'both public event lookups must keep the page-state gate');
  const archivedGates = source.match(/&archived_at=is\.null/g) ?? [];
  assert.equal(archivedGates.length, 2, 'both public event lookups must keep the archive gate');
});

test('the resolved row carries event_visibility so the response header can be decided', () => {
  assert.match(
    source,
    /interface PublicEventRow extends EventRow \{[\s\S]*?event_visibility\?:\s*string \| null;[\s\S]*?\}/,
    'PublicEventRow must expose event_visibility from the select=* row',
  );
});

test('X-Robots-Tag noindex is applied only when the resolved event is unlisted', () => {
  assert.match(
    source,
    /if \(event\.event_visibility === 'unlisted'\) \{\s*responseHeaders\['X-Robots-Tag'\] = 'noindex';\s*\}/,
    'noindex must be set conditionally, only for an unlisted event',
  );

  // The base headers object literal itself must not unconditionally carry
  // X-Robots-Tag, so a Public response never receives it.
  const headersLiteralMatch = source.match(/const responseHeaders: Record<string, string> = \{[\s\S]*?\};/);
  assert.ok(headersLiteralMatch, 'expected a responseHeaders object literal to exist');
  assert.ok(
    !headersLiteralMatch[0].includes('X-Robots-Tag'),
    'X-Robots-Tag must not be unconditionally present in the base response headers (that would apply it to Public responses too)',
  );

  // The final Response must be constructed from this same headers object,
  // not a second, separately-built headers literal that could diverge.
  assert.match(
    source,
    /return new Response\(rendered, \{\s*status: 200,\s*headers: responseHeaders,\s*\}\);/,
    'the rendered response must use the conditionally-built responseHeaders object',
  );
});

test('no sitemap or robots.txt infrastructure is introduced', () => {
  assert.ok(!/sitemap/i.test(source), 'no sitemap handling should be added by this change');
  assert.ok(!/robots\.txt/i.test(source), 'no robots.txt route should be added by this change');
});
