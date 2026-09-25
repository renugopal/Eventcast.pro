import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PORTAL_EVENT_FIELDS,
  PORTAL_EVENT_SELECT,
  fetchPortalEvent,
  projectPortalEvent,
} from '@/lib/portalEvent';

/**
 * S3 security containment (2026-09-25): the legacy `events.youtube_stream_key`
 * column was publicly readable for published events and was shipped to
 * browsers by the legacy `/portal/[slug]` page's client-side `select('*')`.
 * These tests pin the application-side containment. Scope is deliberately
 * limited to browser/public code paths — server-side/service-role queries are
 * out of this hotfix's scope and are not constrained here. Fixture values are
 * obviously fake placeholders — never real credentials.
 */

const repoRoot = path.resolve(__dirname, '..', '..');
const srcRoot = path.join(repoRoot, 'src');
const portalPagePath = path.join(srcRoot, 'app', 'portal', '[slug]', 'page.tsx');
const FAKE_KEY = 'fake-placeholder-not-a-real-key';

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** A Next.js client component — code that ships to and runs in the browser. */
function isClientComponent(source: string): boolean {
  return /^\s*["']use client["'];?/.test(source);
}

/** Browser-side Supabase usage: a client component that imports a Supabase client. */
function isBrowserSupabaseUsage(source: string): boolean {
  return (
    isClientComponent(source) &&
    /from\s+['"](@\/lib\/supabase|@supabase\/supabase-js)['"]/.test(source)
  );
}

interface Call {
  method: string;
  args: unknown[];
}

function mockClient(result: { data: Record<string, unknown> | null; error: unknown }) {
  const calls: Call[] = [];
  const query = {
    eq: (...args: unknown[]) => {
      calls.push({ method: 'eq', args });
      return query;
    },
    is: (...args: unknown[]) => {
      calls.push({ method: 'is', args });
      return query;
    },
    single: () => {
      calls.push({ method: 'single', args: [] });
      return Promise.resolve(result);
    },
  };
  const client = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] });
      return {
        select: (columns: string) => {
          calls.push({ method: 'select', args: [columns] });
          return query;
        },
      };
    },
  };
  return { client, calls };
}

describe('S3 — /portal/[slug] public event read', () => {
  it('uses an explicit allowlist that excludes the legacy stream key and any wildcard', () => {
    expect(PORTAL_EVENT_FIELDS).toEqual(['id', 'slug', 'event_type', 'groom_name', 'bride_name', 'celebrant_name']);
    expect(PORTAL_EVENT_SELECT).not.toContain('*');
    expect(PORTAL_EVENT_SELECT).not.toMatch(/youtube|stream|key|secret|token/i);
  });

  it('requests only the allowlisted columns, with the same public filters as before', async () => {
    const { client, calls } = mockClient({ data: { id: 'evt-1', slug: 's' }, error: null });
    await fetchPortalEvent(client, 's');
    expect(calls).toEqual([
      { method: 'from', args: ['events'] },
      { method: 'select', args: [PORTAL_EVENT_SELECT] },
      { method: 'eq', args: ['slug', 's'] },
      { method: 'eq', args: ['event_visibility', 'public'] },
      { method: 'is', args: ['archived_at', null] },
      { method: 'single', args: [] },
    ]);
  });

  it('never returns youtube_stream_key even if a row unexpectedly carries it', async () => {
    const row = {
      id: 'evt-1',
      slug: 'asha-ravi',
      event_type: 'Wedding',
      groom_name: 'Ravi',
      bride_name: 'Asha',
      celebrant_name: null,
      youtube_stream_key: FAKE_KEY,
      youtube_broadcast_id: 'fake-broadcast',
    };
    const { client } = mockClient({ data: row, error: null });
    const event = await fetchPortalEvent(client, 'asha-ravi');

    expect(event).toEqual({
      id: 'evt-1',
      slug: 'asha-ravi',
      event_type: 'Wedding',
      groom_name: 'Ravi',
      bride_name: 'Asha',
      celebrant_name: null,
    });
    expect(Object.keys(event ?? {})).not.toContain('youtube_stream_key');
    expect(JSON.stringify(event)).not.toContain(FAKE_KEY);
  });

  it('projectPortalEvent drops every non-allowlisted field', () => {
    const projected = projectPortalEvent({ id: 'x', youtube_stream_key: FAKE_KEY, internal: 'y' });
    expect(Object.keys(projected).sort()).toEqual([...PORTAL_EVENT_FIELDS].sort());
    expect(JSON.stringify(projected)).not.toContain(FAKE_KEY);
  });

  it('returns null for a missing event or a query error', async () => {
    expect(await fetchPortalEvent(mockClient({ data: null, error: null }).client, 'nope')).toBeNull();
    expect(await fetchPortalEvent(mockClient({ data: null, error: { message: 'x' } }).client, 'nope')).toBeNull();
  });

  it('the page is a browser client component that reads the event only through the helper', () => {
    const source = readFileSync(portalPagePath, 'utf8');
    expect(isBrowserSupabaseUsage(source)).toBe(true);
    expect(source).toContain('fetchPortalEvent(');
    expect(source).not.toMatch(/from\(\s*['"]events['"]\s*\)/);
    expect(source).not.toMatch(/youtube_stream_key/);
  });

  it('the page renders only allowlisted event fields', () => {
    const source = readFileSync(portalPagePath, 'utf8');
    const used = new Set([...source.matchAll(/\b(?:event|eventData)\.(\w+)/g)].map((m) => m[1]));
    expect(used.size).toBeGreaterThan(0);
    for (const field of used) {
      expect(PORTAL_EVENT_FIELDS as readonly string[]).toContain(field);
    }
  });
});

describe('S3 — no browser/public code path exposes youtube_stream_key', () => {
  const files = listSourceFiles(srcRoot);

  it('no client component references the legacy column', () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return isClientComponent(source) && /youtube_stream_key/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("no browser-side (client component) Supabase query reads public.events with select('*')", () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return (
        isBrowserSupabaseUsage(source) &&
        /from\(\s*['"]events['"]\s*\)\s*\.select\(\s*['"]\*['"]/.test(source)
      );
    });
    expect(offenders).toEqual([]);
  });

  it('no API/internal route references the legacy column', () => {
    const routeFiles = files.filter((file) => /[\\/]app[\\/](api|internal)[\\/]/.test(file));
    const offenders = routeFiles.filter((file) => /youtube_stream_key/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the shared public renderer never emits the legacy column', () => {
    const renderer = readFileSync(path.join(srcRoot, 'lib', 'weddingTemplateRenderer.ts'), 'utf8');
    expect(renderer).not.toMatch(/youtube_stream_key|youtubeStreamKey/);
  });
});

describe('S3 — retired legacy platform-channel YouTube routes', () => {
  const apiRoot = path.join(srcRoot, 'app', 'api');

  it.each([
    ['POST /api/youtube', path.join(apiRoot, 'youtube', 'route.ts')],
    ['GET /api/youtube/sync-status', path.join(apiRoot, 'youtube', 'sync-status', 'route.ts')],
    ['POST /api/youtube/toggle-live', path.join(apiRoot, 'youtube', 'toggle-live', 'route.ts')],
  ])('%s no longer exists (App Router serves 404)', (_label, routeFile) => {
    expect(existsSync(routeFile)).toBe(false);
  });

  it('no source file still calls the retired routes', () => {
    const offenders = listSourceFiles(srcRoot).filter((file) =>
      /['"`]\/api\/youtube(\/sync-status|\/toggle-live)?['"`?]/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('sync-live-status cron route: subsequently retired (2026-09-25) — see legacy-sync-live-status-cron-retirement.test.ts', () => {
    // At S3 hotfix time this route was deliberately KEPT (it was the only
    // actively-scheduled consumer of the retired legacy YouTube routes'
    // shared platform Google OAuth credential, and D17's exclusion of
    // OAuth-managed events from it was left for the future OAuth package).
    // A later, separately-approved product/security decision retired this
    // cron entirely instead of building that exclusion, once a read-only
    // assessment found every event it served already historical (event_date
    // in the past) and the shared credential compromised. This assertion is
    // updated to match; the retirement itself is covered by the dedicated
    // suite referenced above.
    expect(existsSync(path.join(apiRoot, 'cron', 'sync-live-status', 'route.ts'))).toBe(false);
  });
});
