import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CANONICAL_WEDDING_TEMPLATE_01_HTML } from '@/lib/canonicalWeddingTemplateHtml';

/**
 * Drift guard for the one canonical TLF-001 template source (baseline
 * TPL-002).
 *
 * The Admin Draft Preview route runs on the Cloudflare Pages Edge Runtime and
 * therefore cannot read the Worker's template asset from disk at request time,
 * so the markup is embedded in `src/lib/canonicalWeddingTemplateHtml.ts`. That
 * embedding is only safe while it stays identical to the file the public
 * Worker actually deploys — otherwise Admin Preview would silently become a
 * second, divergent TLF-001 implementation, which is exactly what TPL-002
 * forbids. This test makes that divergence impossible to merge unnoticed.
 *
 * Line endings are normalized on both sides: the repository stores this
 * template with LF, but a Windows checkout materializes it with CRLF. That is
 * a checkout artifact, not template content, so comparing raw bytes would make
 * the suite pass on Linux CI and fail on a Windows working tree while nothing
 * about the template had actually changed.
 */

const TEMPLATE_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'workers',
  'render-event-page',
  'templates',
  'wedding-template-01',
  'index.html'
);

function toLf(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

describe('canonical wedding-template-01 HTML module', () => {
  it('is byte-identical to the Worker template the public site deploys', () => {
    const onDisk = toLf(fs.readFileSync(TEMPLATE_PATH, 'utf-8'));

    expect(CANONICAL_WEDDING_TEMPLATE_01_HTML).toBe(onDisk);
  });

  it('is stored LF-normalized so the embedded copy matches the deployed bytes', () => {
    expect(CANONICAL_WEDDING_TEMPLATE_01_HTML).not.toContain('\r');
  });

  it('carries the real template markup rather than an empty or placeholder value', () => {
    expect(CANONICAL_WEDDING_TEMPLATE_01_HTML.length).toBeGreaterThan(10_000);
    expect(CANONICAL_WEDDING_TEMPLATE_01_HTML).toContain('<!DOCTYPE html>');
    expect(CANONICAL_WEDDING_TEMPLATE_01_HTML).toContain('id="livestream"');
    expect(CANONICAL_WEDDING_TEMPLATE_01_HTML).toContain('id="countdown"');
  });
});
