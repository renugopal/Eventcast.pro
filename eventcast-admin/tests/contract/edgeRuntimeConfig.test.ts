import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Regression guard for the Cloudflare Pages cutover defect.
 *
 * Cloudflare Pages only runs Edge Runtime functions. A route that cannot be
 * prerendered to a static asset — every dynamic `[param]` segment here — must
 * therefore declare `runtime = 'edge'`, or `@cloudflare/next-on-pages` rejects
 * the whole build. That is not something `next build` catches: it happily
 * emits Node.js serverless functions, which is why this shipped green locally
 * and failed only in the Pages build.
 *
 * These assertions are deliberately source-level. They encode the exact set of
 * route segments Cloudflare named, so re-introducing a Node-runtime dynamic
 * route fails here instead of in production.
 */

const APP_DIR = path.join(__dirname, '..', '..', 'src', 'app');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(APP_DIR, relativePath), 'utf-8');
}

function declaresEdgeRuntime(source: string): boolean {
  return /^export const runtime = ['"]edge['"];$/m.test(source);
}

/**
 * The seven Event Workspace tabs do not each declare a runtime: they inherit
 * it from the one shared workspace layout segment. Asserting the layout (and
 * asserting that the tabs exist) keeps the real mechanism under test — if
 * someone deletes the layout's declaration, this fails even though every tab
 * file is untouched.
 */
const EVENT_WORKSPACE_LAYOUT = '(admin-v2)/events/[eventId]/layout.tsx';

const EVENT_WORKSPACE_TABS = [
  '(admin-v2)/events/[eventId]/overview/page.tsx',
  '(admin-v2)/events/[eventId]/event-page/page.tsx',
  '(admin-v2)/events/[eventId]/live/page.tsx',
  '(admin-v2)/events/[eventId]/media/page.tsx',
  '(admin-v2)/events/[eventId]/engagement/page.tsx',
  '(admin-v2)/events/[eventId]/analytics/page.tsx',
  '(admin-v2)/events/[eventId]/settings/page.tsx',
];

const DIRECTLY_DECLARED_DYNAMIC_ROUTES = [
  'platform/events/[eventId]/page.tsx',
  'platform/studios/[studioId]/page.tsx',
  'api/events/draft/[eventId]/preview/route.ts',
];

const DRAFT_PREVIEW_ROUTE = 'api/events/draft/[eventId]/preview/route.ts';

describe('Cloudflare Pages Edge Runtime configuration', () => {
  it('declares the Event Workspace segment once on its shared layout', () => {
    expect(declaresEdgeRuntime(read(EVENT_WORKSPACE_LAYOUT))).toBe(true);
  });

  it.each(EVENT_WORKSPACE_TABS)('keeps tab %s inside that layout segment', (tab) => {
    expect(fs.existsSync(path.join(APP_DIR, tab))).toBe(true);
  });

  it.each(DIRECTLY_DECLARED_DYNAMIC_ROUTES)('declares the Edge Runtime in %s', (route) => {
    expect(declaresEdgeRuntime(read(route))).toBe(true);
  });
});

describe('Draft Preview route edge safety', () => {
  it('never reaches for a Node filesystem at request time', () => {
    const source = read(DRAFT_PREVIEW_ROUTE);

    expect(source).not.toMatch(/from ['"]node:fs['"]/);
    expect(source).not.toMatch(/from ['"]node:path['"]/);
    expect(source).not.toContain('readFileSync');
    expect(source).not.toContain('process.cwd()');
  });

  it('takes its template markup from the drift-guarded canonical module', () => {
    const source = read(DRAFT_PREVIEW_ROUTE);

    expect(source).toContain("from '@/lib/canonicalWeddingTemplateHtml'");
    expect(source).toContain('CANONICAL_WEDDING_TEMPLATE_01_HTML');
  });
});
