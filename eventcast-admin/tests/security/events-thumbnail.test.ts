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

vi.mock('@/lib/auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadThumbnailRoute() {
  const mod = await import('@/app/api/events/[eventId]/thumbnail/route');
  return mod.PATCH;
}

async function loadDraftRoute() {
  const mod = await import('@/app/api/events/draft/[eventId]/route');
  return mod.PATCH;
}

function makePatchRequest(body: unknown, path = '/api/events/evt-1/thumbnail'): Request {
  return new Request(`http://test.local${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const routeParams = { params: Promise.resolve({ eventId: 'evt-1' }) };

const OWNED_ROW = { id: 'evt-1' };

const VALID_URL = 'https://cdn.example.com/studios/studio-a/thumbnail/uuid-1-p.png';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess());
  process.env.R2_PUBLIC_URL = 'https://cdn.example.com';
});

describe('PATCH /api/events/[eventId]/thumbnail — auth and ownership', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));

    const PATCH = await loadThumbnailRoute();
    const res = await PATCH(makePatchRequest({ thumbnailUrl: VALID_URL }), routeParams);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent event with the existing generic ownership 404', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const PATCH = await loadThumbnailRoute();
    const res = await PATCH(makePatchRequest({ thumbnailUrl: VALID_URL }), routeParams);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH /api/events/[eventId]/thumbnail — URL validation', () => {
  it('rejects a malformed URL', async () => {
    mockDb.from = createFromMock({ events: [{ data: OWNED_ROW, error: null }] });

    const PATCH = await loadThumbnailRoute();
    const res = await PATCH(makePatchRequest({ thumbnailUrl: 'not-a-url' }), routeParams);

    expect(res.status).toBe(400);
    expect(mockDb.from).toHaveBeenCalledTimes(1); // ownership only, no update
  });

  it('rejects an external-origin URL', async () => {
    mockDb.from = createFromMock({ events: [{ data: OWNED_ROW, error: null }] });

    const PATCH = await loadThumbnailRoute();
    const res = await PATCH(
      makePatchRequest({ thumbnailUrl: 'https://evil.example.com/studios/studio-a/thumbnail/x.png' }),
      routeParams
    );

    expect(res.status).toBe(400);
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it("rejects another studio's thumbnail path", async () => {
    mockDb.from = createFromMock({ events: [{ data: OWNED_ROW, error: null }] });

    const PATCH = await loadThumbnailRoute();
    const res = await PATCH(
      makePatchRequest({ thumbnailUrl: 'https://cdn.example.com/studios/studio-b/thumbnail/x.png' }),
      routeParams
    );

    expect(res.status).toBe(400);
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-thumbnail R2 path (e.g. gallery)', async () => {
    mockDb.from = createFromMock({ events: [{ data: OWNED_ROW, error: null }] });

    const PATCH = await loadThumbnailRoute();
    const res = await PATCH(
      makePatchRequest({ thumbnailUrl: 'https://cdn.example.com/studios/studio-a/gallery/x.png' }),
      routeParams
    );

    expect(res.status).toBe(400);
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH /api/events/[eventId]/thumbnail — successful assignment', () => {
  it("updates only thumbnail_url, scoped by both event id and studio id", async () => {
    mockDb.from = createFromMock({
      events: [
        { data: OWNED_ROW, error: null }, // ownership
        { data: null, error: null }, // update
      ],
    });

    const PATCH = await loadThumbnailRoute();
    const res = await PATCH(makePatchRequest({ thumbnailUrl: VALID_URL }), routeParams);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, thumbnailUrl: VALID_URL });

    const updateCall = mockDb.from.mock.results[1].value;
    expect(updateCall.update).toHaveBeenCalledWith({ thumbnail_url: VALID_URL });
    expect(updateCall.eq.mock.calls).toEqual([
      ['id', 'evt-1'],
      ['studio_id', 'studio-a'],
    ]);
  });
});

describe('Draft Create/Edit route does not gain thumbnail mutation capability', () => {
  it('ignores a thumbnailUrl field sent to PATCH /api/events/draft/[eventId]', async () => {
    const DRAFT_ROW = {
      id: 'evt-1',
      event_type: 'Wedding',
      groom_name: 'Raj',
      bride_name: 'Priya',
      venue_name: 'Taj Krishna',
      slug: 'raj-priya-wedding',
      template_id: 'wedding-template-01',
      template_version: '1.0.0',
      scheduled_start_at: '2026-12-01T18:30:00+05:30',
      page_state: 'draft',
      guest_photo_wall_enabled: true,
    };
    mockDb.from = createFromMock({
      events: [
        { data: DRAFT_ROW, error: null }, // ownership
        { data: null, error: null }, // update
      ],
    });

    const PATCH = await loadDraftRoute();
    const res = await PATCH(
      makePatchRequest(
        {
          groomName: 'Raj',
          brideName: 'Priya',
          scheduledStartAtLocal: '2026-12-01T18:30',
          venueName: 'Taj Krishna',
          slug: 'raj-priya-wedding',
          thumbnailUrl: VALID_URL,
        },
        '/api/events/draft/evt-1'
      ),
      routeParams
    );

    expect(res.status).toBe(200);
    const updateCall = mockDb.from.mock.results[1].value;
    const updatedPayload = updateCall.update.mock.calls[0][0];
    expect(updatedPayload).not.toHaveProperty('thumbnail_url');
  });
});
