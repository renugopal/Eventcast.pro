import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const { mockRequireAdmin, mockFrom } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireAdmin: mockRequireAdmin };
});
vi.mock('@/lib/supabase', () => ({ supabase: { from: mockFrom }, supabaseAdmin: { from: mockFrom } }));

function makeRequest(): Request {
  return new Request('http://test.local/api/events/event-1/recording');
}

async function callRoute() {
  const { GET } = await import('@/app/api/events/[eventId]/recording/route');
  return GET(makeRequest(), { params: Promise.resolve({ eventId: 'event-1' }) });
}

describe('GET /api/events/[eventId]/recording', () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset();
    mockFrom.mockReset();
  });

  it('rejects before any DB call when unauthenticated', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await callRoute();
    expect(res.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns generic 404 for a cross-tenant/nonexistent event before any recording query', async () => {
    mockRequireAdmin.mockResolvedValue({ studioId: 'studio-a', userId: 'user-1' });
    // getOwnedEventById queries 'events' first and finds nothing.
    mockFrom.mockImplementation((table: string) => {
      if (table === 'events') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      throw new Error(`Unexpected .from('${table}') call — recording table must not be queried before ownership is proven`);
    });

    const res = await callRoute();
    expect(res.status).toBe(404);
  });

  it('never returns b2_object_key, b2_bucket, or integrity_verified_at — the raw row is never returned', async () => {
    mockRequireAdmin.mockResolvedValue({ studioId: 'studio-a', userId: 'user-1' });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'events') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'event-1' }, error: null }),
        };
      }
      if (table === 'event_recordings') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: 'rec-1',
              event_id: 'event-1',
              recording_state: 'b2_finalized',
              b2_object_key: 'events/event-1/final.mp4',
              b2_bucket: 'eventcast-vod',
              b2_finalized_at: '2026-08-02T00:00:00Z',
              integrity_verified_at: '2026-08-02T00:05:00Z',
              local_finalized_at: '2026-08-01T00:00:00Z',
              finalization_failure_reason: null,
              youtube_fallback_url: null,
              youtube_fallback_verified: false,
              retention_effective_days: 90,
              retention_frozen_at: '2026-08-02T00:05:00Z',
              retention_expires_at: '2026-10-31T00:05:00Z',
              created_at: '2026-08-01T00:00:00Z',
              updated_at: '2026-08-02T00:05:00Z',
            },
            error: null,
          }),
        };
      }
      throw new Error(`Unexpected .from('${table}') call`);
    });

    const res = await callRoute();
    const json = await res.json();
    const serialized = JSON.stringify(json);

    expect(res.status).toBe(200);
    // A fully archived, integrity-verified, retention-frozen recording is
    // still reported as "processing", not "available": the B2 bucket is
    // private and no approved playback-delivery path exists yet, so telling
    // a provider the replay is ready would be untrue. See
    // toProviderSafeRecordingView.
    expect(json.recording.replayStatus).toBe('processing');
    expect(json.recording.retentionExpiresAt).toBe('2026-10-31T00:05:00Z');
    expect(serialized).not.toContain('b2_object_key');
    expect(serialized).not.toContain('b2_bucket');
    expect(serialized).not.toContain('integrity_verified_at');
    expect(serialized).not.toContain('finalization_failure_reason');
  });
});
