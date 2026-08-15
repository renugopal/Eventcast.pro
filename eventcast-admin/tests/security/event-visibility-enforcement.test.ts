import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = path.resolve(__dirname, '..', '..');
const portalSource = readFileSync(path.join(appRoot, 'src', 'app', 'portal', '[slug]', 'page.tsx'), 'utf8');
const uploadSource = readFileSync(path.join(appRoot, 'src', 'app', 'api', 'guest-photos', 'upload', 'route.ts'), 'utf8');

describe('event visibility application enforcement contract', () => {
  it('portal reads only public, unarchived events and uses the framework generic not-found path', () => {
    expect(portalSource).toMatch(/import \{ notFound, useParams \} from "next\/navigation"/);
    expect(portalSource).toMatch(/\.eq\('event_visibility', 'public'\)[\s\S]*?\.is\('archived_at', null\)[\s\S]*?\.single\(\)/);
    expect(portalSource).toMatch(/if \(!event\) \{\s*notFound\(\);\s*\}/);
  });

  it('guest-photo upload validates published state before rate-limit and R2 work, and only allows public/unlisted visibility (Visibility Foundation Gate)', () => {
    const publishedLookupAt = uploadSource.indexOf(".eq('page_state', 'published')");
    const archiveLookupAt = uploadSource.indexOf(".is('archived_at', null)");
    const rateLimitAt = uploadSource.indexOf('enforceRateLimit(');
    const uploadAt = uploadSource.lastIndexOf('uploadToR2(');

    expect(publishedLookupAt).toBeGreaterThanOrEqual(0);
    expect(archiveLookupAt).toBeGreaterThan(publishedLookupAt);
    expect(rateLimitAt).toBeGreaterThan(archiveLookupAt);
    expect(uploadAt).toBeGreaterThan(rateLimitAt);
    expect(uploadSource).toContain("error: 'Event not found'");
    // page_state=published excludes Drafts (whose event_visibility defaults
    // to 'unlisted'); the application-level allowlist below then admits
    // only public/unlisted, never legacy private/synthetic.
    expect(uploadSource).toMatch(/CANONICAL_PUBLISHED_VISIBILITIES\s*=\s*\['public',\s*'unlisted'\]/);
    expect(uploadSource).not.toMatch(/'private'/);
    expect(uploadSource).not.toMatch(/'synthetic'/);
  });
});
