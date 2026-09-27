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
              gap_count: 0,
              gap_status: 'none',
              // Deliberately present, as the real RPC-written row would
              // carry it, to prove it is stripped from the response below
              // even when a real value exists.
              r2_playback_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
              created_at: '2026-08-01T00:00:00Z',
              updated_at: '2026-08-02T00:05:00Z',
            },
            error: null,
          }),
        };
      }
      // getProviderSafeRecordingViewForOwnedEvent (migration 0044) reads the
      // event's single assignment row (playback id + enabled) to evaluate
      // finalized-R2 replay eligibility — a legitimate, additional read
      // alongside 'events' and 'event_recordings'.
      if (table === 'media_event_assignments') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { playback_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', enabled: false },
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
    // A fully archived, integrity-verified, retention-frozen recording IS
    // reported as "available" once its finalized-R2 pointer is proven equal
    // to the disabled assignment's preserved playback id (migration 0044) —
    // this fixture's b2 evidence alone (no B2 playback credentials
    // configured in this test env) would still be "processing"; the R2
    // path is what makes it "available" here. See toProviderSafeRecordingView.
    expect(json.recording.replayStatus).toBe('available');
    expect(json.recording.retentionExpiresAt).toBe('2026-10-31T00:05:00Z');
    expect(serialized).not.toContain('b2_object_key');
    expect(serialized).not.toContain('b2_bucket');
    expect(serialized).not.toContain('integrity_verified_at');
    expect(serialized).not.toContain('finalization_failure_reason');
    // The raw finalized-R2 playback id must never reach a provider response.
    expect(serialized).not.toContain('a1b2c3d4e5f60718293a4b5c6d7e8f90');
    expect(serialized).not.toContain('r2_playback_id');
  });

  it('reports "processing" (not "available") when the assignment is still enabled (live), even with a fully evidenced recording', async () => {
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
              gap_count: 0,
              gap_status: 'none',
              r2_playback_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
              created_at: '2026-08-01T00:00:00Z',
              updated_at: '2026-08-02T00:05:00Z',
            },
            error: null,
          }),
        };
      }
      if (table === 'media_event_assignments') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          // Still enabled: the event is live, so R2-final replay must never
          // be reported even though the pointer would otherwise match.
          maybeSingle: vi.fn().mockResolvedValue({
            data: { playback_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', enabled: true },
            error: null,
          }),
        };
      }
      throw new Error(`Unexpected .from('${table}') call`);
    });

    const res = await callRoute();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.recording.replayStatus).toBe('processing');
  });
});
