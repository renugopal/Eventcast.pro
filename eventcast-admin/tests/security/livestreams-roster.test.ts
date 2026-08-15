import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createFromMock, authSuccess, type MockQueryBuilder } from './support/mocks';

const { mockDb, mockRequireAdmin } = vi.hoisted(() => ({
  mockDb: {
    from: vi.fn((table: string): MockQueryBuilder => {
      throw new Error(`mockDb.from not configured for table '${table}' in this test`);
    }),
  },
  mockRequireAdmin: vi.fn(async () => authSuccess()),
}));

vi.mock('@/lib/auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess({ studioId: 'studio-a' }));
});

async function loadRoute() {
  const mod = await import('@/app/api/livestreams/route');
  return mod.GET;
}

describe('GET /api/livestreams', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }) as never);
    const GET = await loadRoute();
    const res = await GET(new Request('http://test.local'));
    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('scopes the query to the authenticated studio, never a client-supplied one', async () => {
    const fromMock = createFromMock({ events: [{ data: [], error: null }] });
    mockDb.from = fromMock;
    await (await loadRoute())(new Request('http://test.local'));
    const result = fromMock.mock.results[0].value;
    expect(result.eq).toHaveBeenCalledWith('studio_id', 'studio-a');
    expect(result.is).toHaveBeenCalledWith('archived_at', null);
  });

  it('reports livestreamEnabled from the embedded assignment row', async () => {
    mockDb.from = createFromMock({
      events: [
        {
          data: [
            {
              id: 'evt-1',
              event_type: 'Wedding',
              groom_name: 'A',
              bride_name: 'B',
              celebrant_name: null,
              event_date: '2026-01-01',
              event_time: '10:00',
              venue_name: 'Hall',
              slug: 'a-b-wedding',
              page_state: 'published',
              youtube_url: 'https://youtube.com/watch?v=abc',
              archived_at: null,
              media_event_assignments: { enabled: true },
            },
            {
              id: 'evt-2',
              event_type: 'Wedding',
              groom_name: 'C',
              bride_name: 'D',
              celebrant_name: null,
              event_date: '2026-01-01',
              event_time: '10:00',
              venue_name: null,
              slug: 'c-d-wedding',
              page_state: 'draft',
              youtube_url: null,
              archived_at: null,
              media_event_assignments: null,
            },
          ],
          error: null,
        },
      ],
    });
    const res = await (await loadRoute())(new Request('http://test.local'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.items).toEqual([
      expect.objectContaining({ eventId: 'evt-1', livestreamEnabled: true, youtubeConfigured: true }),
      expect.objectContaining({ eventId: 'evt-2', livestreamEnabled: false, youtubeConfigured: false }),
    ]);
  });

  it('never exposes assignment secrets even if present on the row', async () => {
    mockDb.from = createFromMock({
      events: [
        {
          data: [
            {
              id: 'evt-1',
              event_type: 'Wedding',
              groom_name: 'A',
              bride_name: 'B',
              celebrant_name: null,
              event_date: '2026-01-01',
              event_time: '10:00',
              venue_name: null,
              slug: 'a-b',
              page_state: 'published',
              youtube_url: null,
              archived_at: null,
              media_event_assignments: { enabled: true, stream_secret_hash: 'should-never-appear' },
            },
          ],
          error: null,
        },
      ],
    });
    const res = await (await loadRoute())(new Request('http://test.local'));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('should-never-appear');
  });
});
