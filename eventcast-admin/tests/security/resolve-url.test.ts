import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { authSuccess } from './support/mocks';

const { mockRequireAdmin } = vi.hoisted(() => ({ mockRequireAdmin: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAdmin: mockRequireAdmin }));

async function loadRoute() {
  return (await import('@/app/api/resolve-url/route')).POST;
}

function reqOf(url: unknown): NextRequest {
  return new NextRequest('http://test.local/api/resolve-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess());
});

describe('POST /api/resolve-url — SSRF guard', () => {
  const blocked = [
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://169.254.169.254/latest/meta-data/',
    'http://192.168.1.1/',
    'http://100.64.0.1/',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:169.254.169.254]/',
    'file:///etc/passwd',
    'gopher://127.0.0.1/',
    'http://localhost/',
    'https://user:pass@www.google.com/',
    'http://evil.com/',
    'https://notgoogle.com/',
  ];

  it('rejects private / non-http / credentialed / non-allowlisted targets before fetching', async () => {
    const POST = await loadRoute();
    for (const u of blocked) {
      const res = await POST(reqOf(u));
      expect(res.status, u).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a redirect that points at a private target (after fetching the allowed first hop)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })
    ));
    const POST = await loadRoute();
    const res = await POST(reqOf('https://maps.app.goo.gl/abc'));
    expect(res.status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('resolves an allowlisted public target through a redirect', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      calls.push(String(input));
      if (calls.length === 1) {
        return new Response(null, { status: 302, headers: { location: 'https://www.google.com/maps/place/Venue' } });
      }
      return new Response('ok', { status: 200 });
    }));
    const POST = await loadRoute();
    const res = await POST(reqOf('https://maps.app.goo.gl/abc'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resolvedUrl).toBe('https://www.google.com/maps/place/Venue');
  });
});
