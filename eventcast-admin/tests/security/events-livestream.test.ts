import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createFromMock, authSuccess, type MockQueryBuilder, type AuthSuccess } from './support/mocks';
import type { StudioMemberRole } from '@/lib/auth';

type LiveAuthSuccess = AuthSuccess & { studioMemberRole: StudioMemberRole };
function liveAuth(studioMemberRole: StudioMemberRole = 'owner'): LiveAuthSuccess {
  return { ...authSuccess(), studioMemberRole };
}

const EVENT_ID = 'evt-1';
const routeParams = { params: Promise.resolve({ eventId: EVENT_ID }) };

const { mockDb, mockRequireAdmin, mockEnsureDraftAssignment, mockActivateAssignment, mockDeactivateAssignment } =
  vi.hoisted(() => ({
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
    },
    mockRequireAdmin: vi.fn(async () => ({}) as LiveAuthSuccess),
    mockEnsureDraftAssignment: vi.fn(),
    mockActivateAssignment: vi.fn(),
    mockDeactivateAssignment: vi.fn(),
  }));

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, requireAdmin: mockRequireAdmin };
});
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));
vi.mock('@/lib/media-agent/assignmentWriter', () => ({ ensureDraftAssignment: mockEnsureDraftAssignment }));
vi.mock('@/lib/media-agent/assignmentActivation', () => ({ activateAssignment: mockActivateAssignment }));
vi.mock('@/lib/media-agent/assignmentDeactivation', () => ({ deactivateAssignment: mockDeactivateAssignment }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(liveAuth());
  mockDb.from = vi.fn((table: string): MockQueryBuilder => {
    throw new Error(`mockDb.from not configured for table '${table}' in this test`);
  });
});

// ─── GET status ──────────────────────────────────────────────────────────────

describe('GET /api/events/[eventId]/livestream/status', () => {
  async function loadRoute() {
    const mod = await import('@/app/api/events/[eventId]/livestream/status/route');
    return mod.GET;
  }

  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }) as never);
    const GET = await loadRoute();
    const res = await GET(new Request('http://test.local'), routeParams);
    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent event with the generic 404', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });
    const GET = await loadRoute();
    const res = await GET(new Request('http://test.local'), routeParams);
    expect(res.status).toBe(404);
  });

  it('returns a disabled status with no assignment row yet', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: EVENT_ID, youtube_url: null }, error: null }],
      media_event_assignments: [{ data: null, error: null }],
    });
    const GET = await loadRoute();
    const res = await GET(new Request('http://test.local'), routeParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status.enabled).toBe(false);
    expect(body.status.streamUrl).toBeNull();
    expect(body.youtubeWatchUrl).toBeNull();
  });

  it('constructs the non-secret stream URL from the assigned node hostname', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: EVENT_ID, youtube_url: 'https://youtube.com/watch?v=abc' }, error: null }],
      media_event_assignments: [
        {
          data: {
            event_id: EVENT_ID,
            ingest_id: 'ingest-abc',
            playback_id: 'playback-abc',
            enabled: true,
            publish_window_start_at: '2026-01-01T00:00:00Z',
            publish_window_end_at: '2026-01-02T00:00:00Z',
            config_version: 3,
            updated_at: '2026-01-01T00:00:00Z',
            youtube_enabled: false,
            media_nodes: { ingest_hostname: 'node1.eventcast.pro' },
          },
          error: null,
        },
      ],
    });
    const GET = await loadRoute();
    const res = await GET(new Request('http://test.local'), routeParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status.streamUrl).toBe('rtmp://node1.eventcast.pro/live');
    expect(body.youtubeWatchUrl).toBe('https://youtube.com/watch?v=abc');
    expect(JSON.stringify(body)).not.toContain('stream_secret_hash');
  });
});

// ─── POST enable ─────────────────────────────────────────────────────────────

describe('POST /api/events/[eventId]/livestream/enable', () => {
  async function loadRoute() {
    const mod = await import('@/app/api/events/[eventId]/livestream/enable/route');
    return mod.POST;
  }

  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }) as never);
    const POST = await loadRoute();
    const res = await POST(new Request('http://test.local', { method: 'POST' }), routeParams);
    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a member-role studio user before any mutation', async () => {
    mockRequireAdmin.mockResolvedValue(liveAuth('member'));
    const POST = await loadRoute();
    const res = await POST(new Request('http://test.local', { method: 'POST' }), routeParams);
    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent event with the generic 404', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });
    const POST = await loadRoute();
    const res = await POST(new Request('http://test.local', { method: 'POST' }), routeParams);
    expect(res.status).toBe(404);
  });

  it('refuses to enable Private Livestream for an archived event, without calling the control plane', async () => {
    mockDb.from = createFromMock({ events: [{ data: { id: EVENT_ID, archived_at: '2026-01-01T00:00:00Z' }, error: null }] });
    const POST = await loadRoute();
    const res = await POST(new Request('http://test.local', { method: 'POST' }), routeParams);
    expect(res.status).toBe(409);
    expect(mockEnsureDraftAssignment).not.toHaveBeenCalled();
    expect(mockActivateAssignment).not.toHaveBeenCalled();
  });

  it('returns one-time credentials on successful activation', async () => {
    mockDb.from = createFromMock({ events: [{ data: { id: EVENT_ID, archived_at: null }, error: null }] });
    mockEnsureDraftAssignment.mockResolvedValue('created');
    mockActivateAssignment.mockResolvedValue({
      outcome: 'activated',
      ingestHostname: 'node1.eventcast.pro',
      ingestId: 'ingest-abc',
      token: 'raw-secret-token',
    });
    const POST = await loadRoute();
    const res = await POST(new Request('http://test.local', { method: 'POST' }), routeParams);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body).toEqual({
      success: true,
      streamUrl: 'rtmp://node1.eventcast.pro/live',
      streamKey: 'ingest-abc?token=raw-secret-token',
    });
  });

  it('maps already_activated to a 409 with no credentials', async () => {
    mockDb.from = createFromMock({ events: [{ data: { id: EVENT_ID, archived_at: null }, error: null }] });
    mockEnsureDraftAssignment.mockResolvedValue('exists');
    mockActivateAssignment.mockResolvedValue({ outcome: 'already_activated' });
    const POST = await loadRoute();
    const res = await POST(new Request('http://test.local', { method: 'POST' }), routeParams);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.streamKey).toBeUndefined();
  });

  it('maps no capacity outcomes to 503', async () => {
    mockDb.from = createFromMock({ events: [{ data: { id: EVENT_ID, archived_at: null }, error: null }] });
    mockEnsureDraftAssignment.mockResolvedValue('exists');
    mockActivateAssignment.mockResolvedValue({ outcome: 'node_at_capacity' });
    const POST = await loadRoute();
    const res = await POST(new Request('http://test.local', { method: 'POST' }), routeParams);
    expect(res.status).toBe(503);
  });
});

// ─── POST end ────────────────────────────────────────────────────────────────

describe('POST /api/events/[eventId]/livestream/end', () => {
  async function loadRoute() {
    const mod = await import('@/app/api/events/[eventId]/livestream/end/route');
    return mod.POST;
  }

  it('rejects a member-role studio user before any mutation', async () => {
    mockRequireAdmin.mockResolvedValue(liveAuth('member'));
    const POST = await loadRoute();
    const res = await POST(new Request('http://test.local', { method: 'POST' }), routeParams);
    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent event with the generic 404', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });
    const POST = await loadRoute();
    const res = await POST(new Request('http://test.local', { method: 'POST' }), routeParams);
    expect(res.status).toBe(404);
  });

  it('is idempotent: ending an already-inactive stream is a 200, not an error', async () => {
    mockDb.from = createFromMock({ events: [{ data: { id: EVENT_ID }, error: null }] });
    mockDeactivateAssignment.mockResolvedValue({ outcome: 'already_inactive' });
    const POST = await loadRoute();
    const res = await POST(new Request('http://test.local', { method: 'POST' }), routeParams);
    expect(res.status).toBe(200);
  });

  it('deactivates an enabled stream', async () => {
    mockDb.from = createFromMock({ events: [{ data: { id: EVENT_ID }, error: null }] });
    mockDeactivateAssignment.mockResolvedValue({ outcome: 'deactivated' });
    const POST = await loadRoute();
    const res = await POST(new Request('http://test.local', { method: 'POST' }), routeParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, status: 'deactivated' });
  });
});

// ─── PATCH youtube ───────────────────────────────────────────────────────────

describe('PATCH /api/events/[eventId]/livestream/youtube', () => {
  async function loadRoute() {
    const mod = await import('@/app/api/events/[eventId]/livestream/youtube/route');
    return mod.PATCH;
  }

  function makeRequest(body: unknown): Request {
    return new Request('http://test.local', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('rejects a member-role studio user before any mutation', async () => {
    mockRequireAdmin.mockResolvedValue(liveAuth('member'));
    const PATCH = await loadRoute();
    const res = await PATCH(makeRequest({ youtubeUrl: 'https://youtube.com/watch?v=abc' }), routeParams);
    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a non-YouTube URL', async () => {
    mockDb.from = createFromMock({ events: [{ data: { id: EVENT_ID }, error: null }] });
    const PATCH = await loadRoute();
    const res = await PATCH(makeRequest({ youtubeUrl: 'https://evil.example.com/live' }), routeParams);
    expect(res.status).toBe(400);
  });

  it('accepts a valid youtube.com watch link', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: EVENT_ID }, error: null }, { error: null }],
    });
    const PATCH = await loadRoute();
    const res = await PATCH(makeRequest({ youtubeUrl: 'https://www.youtube.com/watch?v=abc' }), routeParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.youtubeUrl).toBe('https://www.youtube.com/watch?v=abc');
  });

  it('accepts a valid youtu.be short link', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: EVENT_ID }, error: null }, { error: null }],
    });
    const PATCH = await loadRoute();
    const res = await PATCH(makeRequest({ youtubeUrl: 'https://youtu.be/abc123' }), routeParams);
    expect(res.status).toBe(200);
  });

  it('accepts null to clear the watch link', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: EVENT_ID }, error: null }, { error: null }],
    });
    const PATCH = await loadRoute();
    const res = await PATCH(makeRequest({ youtubeUrl: null }), routeParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.youtubeUrl).toBeNull();
    const updateCall = (mockDb.from as unknown as { mock: { results: { value: MockQueryBuilder }[] } }).mock.results[1]
      .value;
    expect(updateCall.update).toHaveBeenCalledWith({ youtube_url: null });
  });
});
