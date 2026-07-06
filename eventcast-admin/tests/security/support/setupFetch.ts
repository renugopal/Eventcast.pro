import { beforeEach, vi } from 'vitest';

/**
 * Default fail-fast global.fetch for every security test. Any route that
 * reaches an unmocked network call fails loudly here instead of silently
 * attempting a real request. Tests that intentionally exercise Google OAuth,
 * YouTube, Cloudinary, or GitHub flows override global.fetch locally; the
 * `unstubGlobals` vitest option restores this default before the next test.
 */
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Parameters<typeof globalThis.fetch>[0]) => {
      throw new Error(
        `Unexpected network call to ${String(input)} in a security test. ` +
        'Mock global.fetch explicitly in this test if the call is expected.'
      );
    })
  );
});
