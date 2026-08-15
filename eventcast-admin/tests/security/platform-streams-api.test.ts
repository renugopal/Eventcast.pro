import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const { mockRequireSuperAdmin, mockFrom } = vi.hoisted(() => ({
  mockRequireSuperAdmin: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('@/lib/superAdmin', () => ({ requireSuperAdmin: mockRequireSuperAdmin }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mockFrom }, supabaseAdmin: { from: mockFrom } }));

function makeRequest(): Request {
  return new Request('http://test.local/api/platform/streams');
}

describe('GET /api/platform/streams', () => {
  beforeEach(() => {
    mockRequireSuperAdmin.mockReset();
    mockFrom.mockReset();
  });

  it('rejects before any DB call when not a super admin', async () => {
    mockRequireSuperAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { GET } = await import('@/app/api/platform/streams/route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('never claims "active"/"live" status derived from enabled=true alone', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          {
            event_id: 'event-1',
            enabled: true,
            ingest_id: 'ingest-1',
            playback_id: 'playback-1',
            publish_window_start_at: null,
            publish_window_end_at: null,
            youtube_enabled: false,
            updated_at: '2026-08-01T00:00:00Z',
            events: { slug: 'wedding-1', studio_id: 'studio-a' },
          },
        ],
        error: null,
      }),
    });

    const { GET } = await import('@/app/api/platform/streams/route');
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    const serialized = JSON.stringify(json).toLowerCase();
    expect(serialized).not.toContain('"active":true');
    expect(json.enabledStreamAssignments[0].liveStatus).toBe('unavailable');
  });
});
