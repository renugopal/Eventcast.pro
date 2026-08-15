import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createFromMock, authSuccess, type MockQueryBuilder, type AuthResult, type QueryResult } from './support/mocks';

/**
 * Audience-analytics integrity (migration 0034, pre-apply review blocker A).
 *
 * The database accepts at most one heartbeat per (event, session, 20-second
 * bucket), and this route must derive watch time from *distinct accepted
 * buckets* rather than from a raw row count — so that a retried, duplicated,
 * or deliberately replayed heartbeat can never manufacture watch time even
 * if such a row reached the table through a privileged writer.
 */

const { mockDb, mockRequireAdmin } = vi.hoisted(() => {
  return {
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
    },
    mockRequireAdmin: vi.fn(async (): Promise<AuthResult> => {
      throw new Error('mockRequireAdmin not configured for this test');
    }),
  };
});

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireAdmin: mockRequireAdmin };
});
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadRoute() {
  const mod = await import('@/app/api/events/[eventId]/analytics/route');
  return { GET: mod.GET };
}

const routeParams = { params: Promise.resolve({ eventId: 'event-1' }) };

function makeRequest(): Request {
  return new Request('http://test.local/api/events/event-1/analytics');
}

function countResult(count: number): QueryResult {
  return { data: null, error: null, count } as unknown as QueryResult;
}

interface HeartbeatRow {
  viewer_id: string;
  session_id: string;
  bucket_started_at: string;
}

function configureDb(heartbeats: HeartbeatRow[], pageViews: unknown[] = []) {
  mockDb.from = createFromMock({
    events: [{ data: { id: 'event-1' }, error: null }],
    page_views: [{ data: pageViews, error: null }],
    wishes: [countResult(0)],
    guest_photos: [countResult(0)],
    event_audience_heartbeats: [{ data: heartbeats, error: null }],
  });
}

// Three consecutive 20-second buckets.
const BUCKET_1 = '2026-08-12T10:00:00.000Z';
const BUCKET_2 = '2026-08-12T10:00:20.000Z';
const BUCKET_3 = '2026-08-12T10:00:40.000Z';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess());
});

describe('GET /api/events/[eventId]/analytics — audience integrity', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), routeParams);
    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent event before reading any analytics', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), routeParams);
    expect(res.status).toBe(404);
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('reads heartbeats by server bucket, scoped to the owned event', async () => {
    configureDb([]);
    const { GET } = await loadRoute();
    await GET(makeRequest(), routeParams);

    const heartbeatCall = mockDb.from.mock.results[4].value;
    expect(heartbeatCall.select).toHaveBeenCalledWith('viewer_id, session_id, bucket_started_at');
    expect(heartbeatCall.eq).toHaveBeenCalledWith('event_id', 'event-1');
    expect(heartbeatCall.order).toHaveBeenCalledWith('bucket_started_at', { ascending: false });
  });

  it('counts one honest session as interval * distinct buckets', async () => {
    configureDb([
      { viewer_id: 'viewer-1', session_id: 'session-1', bucket_started_at: BUCKET_1 },
      { viewer_id: 'viewer-1', session_id: 'session-1', bucket_started_at: BUCKET_2 },
      { viewer_id: 'viewer-1', session_id: 'session-1', bucket_started_at: BUCKET_3 },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), routeParams);
    const { analytics } = await res.json();

    expect(analytics.audienceAnalytics.totalWatchTimeSeconds).toBe(60);
    expect(analytics.audienceAnalytics.totalUniqueViewers).toBe(1);
    expect(analytics.audienceAnalytics.averageWatchTimeSeconds).toBe(60);
  });

  it('adds no watch time for duplicate or replayed heartbeats in the same bucket', async () => {
    const replayed: HeartbeatRow[] = [
      { viewer_id: 'viewer-1', session_id: 'session-1', bucket_started_at: BUCKET_1 },
      { viewer_id: 'viewer-1', session_id: 'session-1', bucket_started_at: BUCKET_2 },
      { viewer_id: 'viewer-1', session_id: 'session-1', bucket_started_at: BUCKET_3 },
    ];
    // 500 replays of buckets that were already counted — the shape a spammed
    // or retried heartbeat path would produce.
    for (let i = 0; i < 500; i += 1) {
      replayed.push({ viewer_id: 'viewer-1', session_id: 'session-1', bucket_started_at: BUCKET_2 });
    }

    configureDb(replayed);
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), routeParams);
    const { analytics } = await res.json();

    // Identical to the honest three-bucket case above.
    expect(analytics.audienceAnalytics.totalWatchTimeSeconds).toBe(60);
    expect(analytics.audienceAnalytics.averageWatchTimeSeconds).toBe(60);
    expect(analytics.audienceAnalytics.peakConcurrentViewers).toBe(1);
  });

  it('keeps separate playback sessions from one browser as separate watch time', async () => {
    configureDb([
      { viewer_id: 'viewer-1', session_id: 'session-1', bucket_started_at: BUCKET_1 },
      { viewer_id: 'viewer-1', session_id: 'session-2', bucket_started_at: BUCKET_1 },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), routeParams);
    const { analytics } = await res.json();

    expect(analytics.audienceAnalytics.totalWatchTimeSeconds).toBe(40);
    // Still one browser/player identity, not two people.
    expect(analytics.audienceAnalytics.totalUniqueViewers).toBe(1);
    expect(analytics.audienceAnalytics.peakConcurrentViewers).toBe(1);
  });

  it('counts distinct viewers within a peak window', async () => {
    configureDb([
      { viewer_id: 'viewer-1', session_id: 'session-1', bucket_started_at: BUCKET_1 },
      { viewer_id: 'viewer-2', session_id: 'session-2', bucket_started_at: BUCKET_2 },
      { viewer_id: 'viewer-3', session_id: 'session-3', bucket_started_at: BUCKET_3 },
    ]);
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), routeParams);
    const { analytics } = await res.json();

    expect(analytics.audienceAnalytics.totalUniqueViewers).toBe(3);
    expect(analytics.audienceAnalytics.peakConcurrentViewers).toBe(3);
    expect(analytics.audienceAnalytics.totalWatchTimeSeconds).toBe(60);
  });

  it('reports zero rather than a fabricated figure when nothing was measured', async () => {
    configureDb([]);
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), routeParams);
    const { analytics } = await res.json();

    expect(analytics.audienceAnalytics).toMatchObject({
      currentViewers: 0,
      peakConcurrentViewers: 0,
      totalUniqueViewers: 0,
      totalWatchTimeSeconds: 0,
      averageWatchTimeSeconds: 0,
      heartbeatIntervalSeconds: 20,
    });
  });

  it('never counts a page view without a visitor_id as a unique visitor', async () => {
    configureDb(
      [],
      [
        { referrer: 'Direct', device_type: 'Mobile', country: 'IN', visitor_id: null },
        { referrer: 'Direct', device_type: 'Mobile', country: 'IN', visitor_id: 'v-1' },
        { referrer: 'Direct', device_type: 'Mobile', country: 'IN', visitor_id: 'v-1' },
      ]
    );
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(), routeParams);
    const { analytics } = await res.json();

    expect(analytics.pageAnalytics.totalPageViews).toBe(3);
    expect(analytics.pageAnalytics.uniqueVisitors).toBe(1);
    expect(analytics.pageAnalytics.uniqueVisitorsCoverageNote).toBeTruthy();
  });
});
