import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('lib/security — HLS signing fails closed without a secret', () => {
  const ORIGINAL = process.env.HLS_SIGNING_SECRET;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.HLS_SIGNING_SECRET;
    else process.env.HLS_SIGNING_SECRET = ORIGINAL;
  });

  it('imports without throwing even when the secret is absent', async () => {
    delete process.env.HLS_SIGNING_SECRET;
    await expect(import('@/lib/security')).resolves.toBeTruthy();
  });

  it('sign → verify round-trips when the secret is set', async () => {
    process.env.HLS_SIGNING_SECRET = 'unit-test-secret';
    const { generateSignedStreamUrl, verifySignature } = await import('@/lib/security');

    const signed = await generateSignedStreamUrl('raj-priya', 300);
    const u = new URL(signed);
    const token = u.searchParams.get('token')!;
    const expires = Number(u.searchParams.get('expires'));

    expect(await verifySignature('/memfs/raj-priya.m3u8', token, expires)).toBe(true);
    expect(await verifySignature('/memfs/raj-priya.m3u8', 'deadbeef', expires)).toBe(false);
  });

  it('throws (no hardcoded fallback) when signing/verifying without a configured secret', async () => {
    delete process.env.HLS_SIGNING_SECRET;
    const { generateSignedStreamUrl, verifySignature } = await import('@/lib/security');

    await expect(generateSignedStreamUrl('x')).rejects.toThrow(/HLS_SIGNING_SECRET/);
    const future = Math.floor(Date.now() / 1000) + 300;
    await expect(verifySignature('/memfs/x.m3u8', 'aa', future)).rejects.toThrow(/HLS_SIGNING_SECRET/);
  });
});
