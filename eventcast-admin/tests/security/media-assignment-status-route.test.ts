import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFromMock, authSuccess, type MockQueryBuilder } from './support/mocks';

const EVENT_ID = 'event-uuid-1';

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
  mockRequireAdmin.mockResolvedValue(authSuccess());
});

async function loadRoute() {
  const mod = await import('@/app/api/media/assignment-status/route');
  return mod.GET;
}

function makeRequest(eventId: string | null): Request {
  const url = eventId
    ? `http://test.local/api/media/assignment-status?eventId=${eventId}`
    : 'http://test.local/api/media/assignment-status';
  return new Request(url, { method: 'GET' });
}

function activatedRow() {
  return {
    data: {
      event_id: EVENT_ID,
      ingest_id: 'a'.repeat(64),
      playback_id: 'b'.repeat(64),
      enabled: true,
      publish_window_start_at: '2026-01-01T00:00:00Z',
      publish_window_end_at: '2026-01-02T00:00:00Z',
      config_version: 2,
      updated_at: '2026-01-01T00:00:00Z',
      youtube_enabled: true,
    },
    error: null,
  };
}

describe('GET /api/media/assignment-status', () => {
  it("requires authentication — returns requireAdmin's response as-is without touching the database", async () => {
    const { NextResponse } = await import('next/server');
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const GET = await loadRoute();
    const res = await GET(makeRequest(EVENT_ID));

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('returns 400 when eventId is missing, without touching the database', async () => {
    const GET = await loadRoute();
    const res = await GET(makeRequest(null));

    expect(res.status).toBe(400);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('returns 404 for a cross-tenant or nonexistent event, without querying assignment status', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const GET = await loadRoute();
    const res = await GET(makeRequest(EVENT_ID));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
    expect(mockDb.from).toHaveBeenCalledWith('events');
  });

  it('scopes the ownership lookup to the authenticated studio, never a client-supplied one', async () => {
    const fromMock = createFromMock({
      events: [{ data: { id: EVENT_ID }, error: null }],
      media_event_assignments: [{ data: null, error: null }],
    });
    mockDb.from = fromMock;
    mockRequireAdmin.mockResolvedValue(authSuccess({ studioId: 'studio-mine' }));

    const GET = await loadRoute();
    await GET(makeRequest(EVENT_ID));

    const eventsResult = fromMock.mock.results[0].value;
    expect(eventsResult.eq).toHaveBeenCalledWith('id', EVENT_ID);
    expect(eventsResult.eq).toHaveBeenCalledWith('studio_id', 'studio-mine');
  });

  it('returns status: null when the event is owned but has no assignment row yet', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: EVENT_ID }, error: null }],
      media_event_assignments: [{ data: null, error: null }],
    });

    const GET = await loadRoute();
    const res = await GET(makeRequest(EVENT_ID));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, status: null });
  });

  it('returns the browser-safe assignment fields for an activated assignment', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: EVENT_ID }, error: null }],
      media_event_assignments: [activatedRow()],
    });

    const GET = await loadRoute();
    const res = await GET(makeRequest(EVENT_ID));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      status: {
        ingestId: 'a'.repeat(64),
        eventId: EVENT_ID,
        playbackId: 'b'.repeat(64),
        enabled: true,
        publishWindowStartAt: '2026-01-01T00:00:00Z',
        publishWindowEndAt: '2026-01-02T00:00:00Z',
        configVersion: '2',
        updatedAt: '2026-01-01T00:00:00Z',
        youtubeEnabled: true,
      },
    });
  });

  it('never exposes stream_secret_hash, node ids, or the YouTube stream key/destination', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: EVENT_ID }, error: null }],
      media_event_assignments: [activatedRow()],
    });

    const GET = await loadRoute();
    const res = await GET(makeRequest(EVENT_ID));
    const body = await res.json();

    for (const forbidden of [
      'streamSecretHash',
      'stream_secret_hash',
      'assignedMediaNodeId',
      'assigned_media_node_id',
      'youtubeStreamKey',
      'youtubeSecretReference',
      'youtubeDestinationBaseUrl',
    ]) {
      expect(JSON.stringify(body)).not.toContain(forbidden);
    }
  });

  it('the assignment-status query never selects a secret-bearing column', async () => {
    const fromMock = createFromMock({
      events: [{ data: { id: EVENT_ID }, error: null }],
      media_event_assignments: [activatedRow()],
    });
    mockDb.from = vi.fn((table: string) => {
      const builder = fromMock(table);
      if (table === 'media_event_assignments') {
        const originalSelect = builder.select;
        builder.select = vi.fn((columns: string) => {
          expect(columns).not.toMatch(
            /stream_secret_hash|youtube_secret_reference|youtube_destination_base_url|assigned_media_node_id/
          );
          return originalSelect(columns);
        });
      }
      return builder;
    });

    const GET = await loadRoute();
    await GET(makeRequest(EVENT_ID));
  });

  it('returns 500 without leaking the database error message on a generic failure', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: EVENT_ID }, error: null }],
      media_event_assignments: [{ data: null, error: { message: 'connection reset to 10.0.0.5' } }],
    });

    const GET = await loadRoute();
    const res = await GET(makeRequest(EVENT_ID));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
  });
});
