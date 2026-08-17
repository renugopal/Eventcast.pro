import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Runtime-configuration guard for the Cloudflare Workers / OpenNext deployment.
 *
 * History, because this file's assertion was deliberately inverted:
 *
 *  1. The Milestone O cutover shipped with dynamic routes on the default
 *     Node.js runtime. `@cloudflare/next-on-pages` rejected them, because
 *     Pages Functions run only Edge Runtime code.
 *  2. The corrective commit added `export const runtime = 'edge'` to satisfy
 *     that, and this test pinned those declarations in place.
 *  3. That Pages build then failed on bundle size (62,396,851 bytes against a
 *     25 MiB limit), because next-on-pages emits one function per route, each
 *     carrying its own copy of its dependency graph.
 *  4. The app moved to `@opennextjs/cloudflare`, which requires the **Node.js**
 *     runtime and does not support edge-runtime routes at all.
 *
 * So the invariant is now the exact opposite of what it was: no source file may
 * declare the edge runtime. Reintroducing one would break the OpenNext build,
 * which is why this is asserted here rather than left to a deploy to discover.
 *
 * The Draft Preview route's filesystem-free requirement is unchanged and still
 * asserted below — it never depended on which runtime was in use. The deployed
 * Worker has no project filesystem either way.
 */

const ADMIN_ROOT = path.join(__dirname, '..', '..');
const APP_DIR = path.join(ADMIN_ROOT, 'src', 'app');

const DRAFT_PREVIEW_ROUTE = 'api/events/draft/[eventId]/preview/route.ts';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(APP_DIR, relativePath), 'utf-8');
}

/**
 * Strips comments so the filesystem assertions below judge executable code
 * only. Without this, a doc comment that accurately explains *why* the route
 * must not call `process.cwd()` would itself fail the test — punishing the
 * documentation for describing the invariant it protects.
 */
function codeWithoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/**
 * Derived from the repository rather than a hard-coded list, so a newly added
 * edge-runtime route is caught even though no one thought to name it here.
 */
function filesDeclaringEdgeRuntime(): string[] {
  try {
    return execFileSync(
      'git',
      ['grep', '-rlE', "export +const +runtime *= *['\"]edge['\"]", '--', 'src'],
      { cwd: ADMIN_ROOT, encoding: 'utf-8' }
    )
      .split(/\r?\n/)
      .filter(Boolean);
  } catch (error: unknown) {
    // `git grep` exits 1 with no output when nothing matches, which is the
    // state this test wants. Anything else is a real failure worth surfacing.
    const status = (error as { status?: number }).status;
    const stdout = String((error as { stdout?: unknown }).stdout ?? '');
    if (status === 1 && stdout.trim() === '') return [];
    throw error;
  }
}

describe('Cloudflare Workers / OpenNext runtime configuration', () => {
  it('declares the edge runtime nowhere in src, as OpenNext requires', () => {
    expect(filesDeclaringEdgeRuntime()).toEqual([]);
  });

  it('keeps the Event Workspace layout free of a runtime declaration', () => {
    expect(read('(admin-v2)/events/[eventId]/layout.tsx')).not.toMatch(
      /export +const +runtime/
    );
  });

  it.each([
    'platform/events/[eventId]/page.tsx',
    'platform/studios/[studioId]/page.tsx',
    DRAFT_PREVIEW_ROUTE,
  ])('keeps %s free of a runtime declaration', (route) => {
    expect(read(route)).not.toMatch(/export +const +runtime/);
  });
});

describe('Draft Preview route edge safety', () => {
  it('never reaches for a Node filesystem at request time', () => {
    const code = codeWithoutComments(read(DRAFT_PREVIEW_ROUTE));

    expect(code).not.toMatch(/from ['"]node:fs['"]/);
    expect(code).not.toMatch(/from ['"]node:path['"]/);
    expect(code).not.toContain('readFileSync');
    expect(code).not.toContain('process.cwd()');
  });

  it('takes its template markup from the drift-guarded canonical module', () => {
    const source = read(DRAFT_PREVIEW_ROUTE);

    expect(source).toContain("from '@/lib/canonicalWeddingTemplateHtml'");
    expect(source).toContain('CANONICAL_WEDDING_TEMPLATE_01_HTML');
  });
});
