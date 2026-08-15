import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createFromMock, authSuccess, type MockQueryBuilder, type AuthSuccess } from './support/mocks';
import type { StudioMemberRole } from '@/lib/auth';

type MediaAuthSuccess = AuthSuccess & { studioMemberRole: StudioMemberRole };
function mediaAuth(studioMemberRole: StudioMemberRole = 'owner'): MediaAuthSuccess {
  return { ...authSuccess(), studioMemberRole };
}

const { mockDb, mockRequireAdmin } = vi.hoisted(() => {
  return {
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
    },
    mockRequireAdmin: vi.fn(async () => ({} as MediaAuthSuccess)),
  };
});

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, requireAdmin: mockRequireAdmin };
});
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadRoute() {
  const mod = await import('@/app/api/events/[eventId]/media/route');
  return { GET: mod.GET, PATCH: mod.PATCH };
}

function makeGetRequest(): Request {
  return new Request('http://test.local/api/events/evt-1/media');
}

function makePatchRequest(body: unknown): Request {
  return new Request('http://test.local/api/events/evt-1/media', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const routeParams = { params: Promise.resolve({ eventId: 'evt-1' }) };
const OWNED_ID_ROW = { id: 'evt-1' };
const VALID_VIDEO = 'https://cdn.example.com/studios/studio-a/video/uuid-1-clip.mp4';
const VALID_IMAGE = 'https://cdn.example.com/studios/studio-a/gallery/uuid-1-p.jpg';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(mediaAuth());
  process.env.R2_PUBLIC_URL = 'https://cdn.example.com';
});

describe('GET /api/events/[eventId]/media', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }) as never);
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), routeParams);
    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent event with the generic 404', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), routeParams);
    expect(res.status).toBe(404);
  });

  it('returns the current invitation video and slideshow images', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: 'evt-1', invitation_video_url: 'https://a/one.mp4', gallery_urls: ['https://a/1.jpg', 'https://a/2.jpg'] }, error: null }],
    });
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), routeParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      invitationVideoUrl: 'https://a/one.mp4',
      slideshowImages: ['https://a/1.jpg', 'https://a/2.jpg'],
    });
  });
});

describe('PATCH /api/events/[eventId]/media — authorization', () => {
  it('rejects a member-role studio user before any mutation', async () => {
    mockRequireAdmin.mockResolvedValue(mediaAuth('member'));
    const { PATCH } = await loadRoute();
    const res = await PATCH(makePatchRequest({ invitationVideoUrl: VALID_VIDEO }), routeParams);
    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent event with the generic 404', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });
    const { PATCH } = await loadRoute();
    const res = await PATCH(makePatchRequest({ invitationVideoUrl: VALID_VIDEO }), routeParams);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/events/[eventId]/media — invitation video validation', () => {
  it('rejects an external-origin URL', async () => {
    mockDb.from = createFromMock({ events: [{ data: OWNED_ID_ROW, error: null }] });
    const { PATCH } = await loadRoute();
    const res = await PATCH(makePatchRequest({ invitationVideoUrl: 'https://evil.example.com/studios/studio-a/video/x.mp4' }), routeParams);
    expect(res.status).toBe(400);
  });

  it("rejects another studio's video path", async () => {
    mockDb.from = createFromMock({ events: [{ data: OWNED_ID_ROW, error: null }] });
    const { PATCH } = await loadRoute();
    const res = await PATCH(makePatchRequest({ invitationVideoUrl: 'https://cdn.example.com/studios/studio-b/video/x.mp4' }), routeParams);
    expect(res.status).toBe(400);
  });

  it('accepts null to remove the invitation video', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_ID_ROW, error: null }, { data: null, error: null }],
    });
    const { PATCH } = await loadRoute();
    const res = await PATCH(makePatchRequest({ invitationVideoUrl: null }), routeParams);
    expect(res.status).toBe(200);
    const updateCall = mockDb.from.mock.results[1].value;
    expect(updateCall.update).toHaveBeenCalledWith({ invitation_video_url: null });
  });
});

describe('PATCH /api/events/[eventId]/media — slideshow validation', () => {
  it('rejects a non-array slideshowImages', async () => {
    mockDb.from = createFromMock({ events: [{ data: OWNED_ID_ROW, error: null }] });
    const { PATCH } = await loadRoute();
    const res = await PATCH(makePatchRequest({ slideshowImages: 'not-an-array' }), routeParams);
    expect(res.status).toBe(400);
  });

  it('rejects an image from another studio', async () => {
    mockDb.from = createFromMock({ events: [{ data: OWNED_ID_ROW, error: null }] });
    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makePatchRequest({ slideshowImages: ['https://cdn.example.com/studios/studio-b/gallery/x.jpg'] }),
      routeParams
    );
    expect(res.status).toBe(400);
  });

  it('persists the array in the exact order given (order = display order)', async () => {
    const images = [VALID_IMAGE, 'https://cdn.example.com/studios/studio-a/gallery/uuid-2-q.jpg'];
    mockDb.from = createFromMock({
      events: [{ data: OWNED_ID_ROW, error: null }, { data: null, error: null }],
    });
    const { PATCH } = await loadRoute();
    const res = await PATCH(makePatchRequest({ slideshowImages: images }), routeParams);
    expect(res.status).toBe(200);
    const updateCall = mockDb.from.mock.results[1].value;
    expect(updateCall.update).toHaveBeenCalledWith({ gallery_urls: images });
    expect(updateCall.eq.mock.calls).toEqual([
      ['id', 'evt-1'],
      ['studio_id', 'studio-a'],
    ]);
  });
});
