import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = path.resolve(__dirname, '..', '..');
const portalSource = readFileSync(path.join(appRoot, 'src', 'app', 'portal', '[slug]', 'page.tsx'), 'utf8');
const uploadSource = readFileSync(path.join(appRoot, 'src', 'app', 'api', 'guest-photos', 'upload', 'route.ts'), 'utf8');
const generateSource = readFileSync(path.join(appRoot, 'src', 'app', 'api', 'events', 'generate', 'route.ts'), 'utf8');

describe('event visibility application enforcement contract', () => {
  it('portal reads only public, unarchived events and uses the framework generic not-found path', () => {
    expect(portalSource).toMatch(/import \{ notFound, useParams \} from "next\/navigation"/);
    expect(portalSource).toMatch(/\.eq\('event_visibility', 'public'\)[\s\S]*?\.is\('archived_at', null\)[\s\S]*?\.single\(\)/);
    expect(portalSource).toMatch(/if \(!event\) \{\s*notFound\(\);\s*\}/);
  });

  it('guest-photo upload validates public visibility before rate-limit and R2 work', () => {
    const visibilityLookupAt = uploadSource.indexOf(".eq('event_visibility', 'public')");
    const archiveLookupAt = uploadSource.indexOf(".is('archived_at', null)");
    const rateLimitAt = uploadSource.indexOf('enforceRateLimit(');
    const uploadAt = uploadSource.lastIndexOf('uploadToR2(');

    expect(visibilityLookupAt).toBeGreaterThanOrEqual(0);
    expect(archiveLookupAt).toBeGreaterThan(visibilityLookupAt);
    expect(rateLimitAt).toBeGreaterThan(archiveLookupAt);
    expect(uploadAt).toBeGreaterThan(rateLimitAt);
    expect(uploadSource).toContain("error: 'Event not found'");
  });

  it('legacy event generation writes public visibility server-side without accepting client visibility', () => {
    expect(generateSource).toMatch(/event_visibility: 'public'/);
    expect(generateSource).not.toMatch(/event_visibility:\s*event\./);
  });
});
