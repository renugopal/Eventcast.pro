import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createFromMock, authSuccess, type MockQueryBuilder } from './support/mocks';

const { mockDb, mockRequireAdmin } = vi.hoisted(() => {
  return {
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
    },
    mockRequireAdmin: vi.fn(async () => authSuccess()),
  };
});

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, requireAdmin: mockRequireAdmin };
});
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess());
});

describe('GET /api/media', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }) as never);
    const { GET } = await import('@/app/api/media/route');
    const res = await GET(new Request('http://test.local'));
    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('scopes the events query to the authenticated studio and reports real, non-fabricated totals', async () => {
    mockDb.from = createFromMock({
      events: [
        {
          data: [
            {
              id: 'evt-1',
              groom_name: 'Raj',
              bride_name: 'Priya',
              slug: 'raj-priya',
              page_state: 'published',
              thumbnail_url: 'https://cdn/thumb.jpg',
              invitation_video_url: 'https://cdn/vid.mp4',
              gallery_urls: ['https://cdn/1.jpg', 'https://cdn/2.jpg'],
            },
            {
              id: 'evt-2',
              groom_name: 'Arjun',
              bride_name: null,
              slug: 'arjun',
              page_state: 'draft',
              thumbnail_url: null,
              invitation_video_url: null,
              gallery_urls: [],
            },
          ],
          error: null,
        },
      ],
    });

    const { GET } = await import('@/app/api/media/route');
    const res = await GET(new Request('http://test.local'));
    expect(res.status).toBe(200);

    const builder = mockDb.from.mock.results[0].value;
    expect(builder.eq).toHaveBeenCalledWith('studio_id', 'studio-a');

    const body = await res.json();
    expect(body.totals).toEqual({
      eventsWithThumbnail: 1,
      eventsWithInvitationVideo: 1,
      totalSlideshowImages: 2,
      recordingsAvailable: false,
    });
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ eventId: 'evt-1', eventName: 'Raj & Priya', slideshowImageCount: 2 });
  });
});
