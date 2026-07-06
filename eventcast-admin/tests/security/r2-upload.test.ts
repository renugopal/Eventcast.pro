import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { authSuccess } from './support/mocks';

const { mockRequireAdmin } = vi.hoisted(() => ({ mockRequireAdmin: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAdmin: mockRequireAdmin }));

async function loadRoute() {
  return (await import('@/app/api/r2-upload/route')).POST;
}

function makeForm(fields: { file?: File; purpose?: string }): NextRequest {
  const fd = new FormData();
  if (fields.file) fd.set('file', fields.file);
  if (fields.purpose !== undefined) fd.set('purpose', fields.purpose);
  return new NextRequest('http://test.local/api/r2-upload', { method: 'POST', body: fd });
}

function imageFile(bytes = 16, type = 'image/png', name = 'p.png'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess({ studioId: 'studio-a' }));
  process.env.R2_ACCESS_KEY_ID = 'ak';
  process.env.R2_SECRET_ACCESS_KEY = 'sk';
  process.env.R2_BUCKET_NAME = 'bucket';
  process.env.R2_S3_ENDPOINT = 'https://r2.example.com';
  process.env.R2_PUBLIC_URL = 'https://cdn.example.com';
});

describe('POST /api/r2-upload — auth, scoping, validation', () => {
  it('returns the auth failure response and never uploads when not an admin', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));
    const POST = await loadRoute();
    const res = await POST(makeForm({ file: imageFile(), purpose: 'thumbnail' }));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a missing purpose with 400 (no default)', async () => {
    const POST = await loadRoute();
    const res = await POST(makeForm({ file: imageFile() }));
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects unknown / path-traversal purposes with 400', async () => {
    const POST = await loadRoute();
    for (const p of ['../../secrets', 'events', 'random', '']) {
      const res = await POST(makeForm({ file: imageFile(), purpose: p }));
      expect(res.status, p).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a wrong MIME type for the purpose with 415', async () => {
    const POST = await loadRoute();
    const res = await POST(makeForm({ file: new File(['x'], 'x.html', { type: 'text/html' }), purpose: 'thumbnail' }));
    expect(res.status).toBe(415);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an oversize file with 413 before any upload', async () => {
    const POST = await loadRoute();
    const big = new File([new Uint8Array(16 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    const res = await POST(makeForm({ file: big, purpose: 'thumbnail' }));
    expect(res.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uploads with a studio-scoped key derived only from auth, never a client folder', async () => {
    const putUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      putUrls.push(String(input));
      return new Response('', { status: 200 });
    }));

    const POST = await loadRoute();
    const res = await POST(makeForm({ file: imageFile(), purpose: 'gallery' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.key).toMatch(/^studios\/studio-a\/gallery\/[0-9a-f-]+-p\.png$/);
    expect(putUrls[0]).toContain('/studios/studio-a/gallery/');
  });
});
