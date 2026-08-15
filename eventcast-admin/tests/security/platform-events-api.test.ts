import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const { mockRequireSuperAdmin, mockFrom } = vi.hoisted(() => ({
  mockRequireSuperAdmin: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('@/lib/superAdmin', () => ({ requireSuperAdmin: mockRequireSuperAdmin }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mockFrom }, supabaseAdmin: { from: mockFrom } }));

function makeRequest(): Request {
  return new Request('http://test.local/api/platform/events');
}

describe('GET /api/platform/events', () => {
  beforeEach(() => {
    mockRequireSuperAdmin.mockReset();
    mockFrom.mockReset();
  });

  it('rejects before any DB call when not a super admin', async () => {
    mockRequireSuperAdmin.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    );
    const { GET } = await import('@/app/api/platform/events/route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns a cross-tenant event list for an authorized super admin', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'event-1',
            slug: 'wedding-1',
            page_state: 'published',
            event_visibility: 'public',
            scheduled_start_at: '2026-09-01T10:00:00Z',
            archived_at: null,
            studio_id: 'studio-a',
            studios: { slug: 'studio-a-slug' },
          },
          {
            id: 'event-2',
            slug: 'wedding-2',
            page_state: 'published',
            event_visibility: 'public',
            scheduled_start_at: '2026-09-02T10:00:00Z',
            archived_at: null,
            studio_id: 'studio-b',
            studios: { slug: 'studio-b-slug' },
          },
        ],
        error: null,
        count: 2,
      }),
    });

    const { GET } = await import('@/app/api/platform/events/route');
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // Cross-tenant: rows from two different studios both returned.
    expect(json.events.map((e: { studioId: string }) => e.studioId).sort()).toEqual(['studio-a', 'studio-b']);
  });
});
