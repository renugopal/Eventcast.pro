import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFromMock, type MockQueryBuilder, type QueryResult } from './support/mocks';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    rpc: vi.fn(),
    from: vi.fn((table: string): MockQueryBuilder => {
      throw new Error(`mockDb.from not configured for table '${table}' in this test`);
    }),
  },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockDb) }));

async function loadRoute() {
  return (await import('@/app/api/guest-photos/upload/route')).POST;
}

function uploadReq(eventId = 'evt-1'): NextRequest {
  const fd = new FormData();
  fd.set('file', new File([new Uint8Array(10)], 'p.webp', { type: 'image/webp' }));
  fd.set('event_id', eventId);
  fd.set('uploader_name', 'Guest');
  return new NextRequest('http://test.local/api/guest-photos/upload', {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.9' },
    body: fd,
  });
}

function expectNoDownstreamWork() {
  expect(mockDb.from).not.toHaveBeenCalled();
  expect(mockDb.rpc).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.R2_ACCESS_KEY_ID = 'ak';
  process.env.R2_SECRET_ACCESS_KEY = 'sk';
  process.env.R2_BUCKET_NAME = 'bucket';
  process.env.R2_S3_ENDPOINT = 'https://r2.example.com';
  process.env.R2_PUBLIC_URL = 'https://cdn.example.com';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
});

describe('POST /api/guest-photos/upload — rate limiting', () => {
  it('returns a generic 400 without downstream work when FormData parsing fails', async () => {
    const POST = await loadRoute();
    const res = await POST(
      new NextRequest('http://test.local/api/guest-photos/upload', { method: 'POST' })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid form data' });
    expectNoDownstreamWork();
  });

  it('rejects malformed multipart input before any downstream work', async () => {
    const POST = await loadRoute();
    const res = await POST(
      new NextRequest('http://test.local/api/guest-photos/upload', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=expected-boundary' },
        body: '--different-boundary--\r\n',
      })
    );

    expect(res.status).toBe(400);
    expectNoDownstreamWork();
  });

  it('keeps the existing missing-file response for a well-formed empty multipart body', async () => {
    const POST = await loadRoute();
    const res = await POST(
      new NextRequest('http://test.local/api/guest-photos/upload', {
        method: 'POST',
        body: new FormData(),
      })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'No file provided' });
    expectNoDownstreamWork();
  });

  it('rejects a valid upload for an unknown event before rate-limit, R2, or insert work', async () => {
    mockDb.from = createFromMock({
      events: [{ data: null, error: null }],
    });
    const POST = await loadRoute();
    const res = await POST(uploadReq(crypto.randomUUID()));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
    expect(mockDb.rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mockDb.from.mock.results[0].value.insert).not.toHaveBeenCalled();
  });

  it('returns 429 and never writes to R2 when over the per-IP+event limit', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: 'evt-1', guest_photo_limit: 50 }, error: null }],
    });
    mockDb.rpc.mockResolvedValue({ data: false, error: null });
    const POST = await loadRoute();
    const res = await POST(uploadReq());

    expect(res.status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();

    expect(mockDb.rpc).toHaveBeenCalledWith(
      'check_rate_limit',
      expect.objectContaining({ p_endpoint: 'guest-photos/upload:evt-1' })
    );
    const args = mockDb.rpc.mock.calls[0][1] as Record<string, string>;
    expect(args.p_ip_hash).not.toContain('203.0.113.9');
    expect(args.p_ip_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a non-public or archived event before rate-limit and R2 work', async () => {
    mockDb.from = createFromMock({
      events: [{ data: null, error: null }],
    });
    const POST = await loadRoute();
    const res = await POST(uploadReq());

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    const eventQuery = mockDb.from.mock.results[0].value;
    expect(eventQuery.eq).toHaveBeenCalledWith('event_visibility', 'public');
    expect(eventQuery.is).toHaveBeenCalledWith('archived_at', null);
  });

  it('allows a normal upload: rate check passes, then R2 write + insert happen', async () => {
    mockDb.rpc.mockResolvedValue({ data: true, error: null });
    mockDb.from = createFromMock({
      events: [{ data: { id: 'evt-1', guest_photo_limit: 50 }, error: null }],
      guest_photos: [
        { data: null, error: null, count: 0 } as QueryResult,
        { data: { id: 'photo-1' }, error: null },
      ],
    });

    const putCalls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      putCalls.push(String(input));
      return new Response('', { status: 200 });
    }));

    const POST = await loadRoute();
    const res = await POST(uploadReq());

    expect(res.status).toBe(200);
    expect(mockDb.rpc).toHaveBeenCalledTimes(1);
    expect(putCalls.length).toBe(1);
  });
});
