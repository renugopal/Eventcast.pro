import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createFromMock, authSuccess, type MockQueryBuilder, type AuthResult } from './support/mocks';

const { mockDb, mockRequireAdmin } = vi.hoisted(() => {
  return {
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
    },
    mockRequireAdmin: vi.fn(async (): Promise<AuthResult> => authSuccess()),
  };
});

vi.mock('@/lib/auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadVisibilityRoute() {
  const mod = await import('@/app/api/events/[eventId]/visibility/route');
  return { PATCH: mod.PATCH };
}

function makeVisibilityRequest(body?: unknown): Request {
  return new Request('http://test.local/api/events/event-1/visibility', {
    method: 'PATCH',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

const routeParams = { params: Promise.resolve({ eventId: 'event-1' }) };

const OWNED_PUBLISHED_PUBLIC_ROW = { id: 'event-1', page_state: 'published' };
const OWNED_DRAFT_ROW = { id: 'event-1', page_state: 'draft' };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess());
});

describe('PATCH /api/events/[eventId]/visibility — auth and ownership', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));

    const { PATCH } = await loadVisibilityRoute();
    const res = await PATCH(makeVisibilityRequest({ visibility: 'unlisted' }), routeParams);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent event with the existing generic non-enumerating 404, before any write', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const { PATCH } = await loadVisibilityRoute();
    const res = await PATCH(makeVisibilityRequest({ visibility: 'unlisted' }), routeParams);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('scopes the ownership read to both the event id and the authenticated studio id', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const { PATCH } = await loadVisibilityRoute();
    await PATCH(makeVisibilityRequest({ visibility: 'unlisted' }), routeParams);

    const ownershipBuilder = mockDb.from.mock.results[0].value;
    expect(ownershipBuilder.eq).toHaveBeenNthCalledWith(1, 'id', 'event-1');
    expect(ownershipBuilder.eq).toHaveBeenNthCalledWith(2, 'studio_id', 'studio-a');
  });
});

describe('PATCH /api/events/[eventId]/visibility — Draft events cannot be modified through this endpoint', () => {
  it('refuses to change visibility on a Draft event, without writing', async () => {
    mockDb.from = createFromMock({ events: [{ data: OWNED_DRAFT_ROW, error: null }] });

    const { PATCH } = await loadVisibilityRoute();
    const res = await PATCH(makeVisibilityRequest({ visibility: 'public' }), routeParams);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH /api/events/[eventId]/visibility — value validation', () => {
  it('rejects a missing visibility value, before any write', async () => {
    mockDb.from = createFromMock({ events: [{ data: OWNED_PUBLISHED_PUBLIC_ROW, error: null }] });

    const { PATCH } = await loadVisibilityRoute();
    const res = await PATCH(makeVisibilityRequest({}), routeParams);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.field).toBe('visibility');
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('rejects legacy or otherwise non-canonical visibility values, before any write', async () => {
    for (const invalid of ['private', 'synthetic', 'PUBLIC', 'Unlisted', '', 123, null]) {
      mockDb.from = createFromMock({ events: [{ data: OWNED_PUBLISHED_PUBLIC_ROW, error: null }] });

      const { PATCH } = await loadVisibilityRoute();
      const res = await PATCH(makeVisibilityRequest({ visibility: invalid }), routeParams);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.field).toBe('visibility');
      expect(mockDb.from).toHaveBeenCalledTimes(1);
    }
  });
});

describe('PATCH /api/events/[eventId]/visibility — successful switches', () => {
  it('switches a Published Public event to Unlisted, writing only event_visibility', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: OWNED_PUBLISHED_PUBLIC_ROW, error: null }, // ownership
        { data: { id: 'event-1', event_visibility: 'unlisted' }, error: null }, // update
      ],
    });

    const { PATCH } = await loadVisibilityRoute();
    const res = await PATCH(makeVisibilityRequest({ visibility: 'unlisted' }), routeParams);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, id: 'event-1', visibility: 'unlisted' });

    const updateCall = mockDb.from.mock.results[1].value;
    expect(updateCall.update).toHaveBeenCalledWith({ event_visibility: 'unlisted' });
    expect(Object.keys(updateCall.update.mock.calls[0][0])).toEqual(['event_visibility']);
    expect(updateCall.eq.mock.calls).toEqual([
      ['id', 'event-1'],
      ['studio_id', 'studio-a'],
      ['page_state', 'published'],
    ]);
  });

  it('switches a Published Unlisted event back to Public, without touching published_credits or page_state', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: OWNED_PUBLISHED_PUBLIC_ROW, error: null }, // ownership
        { data: { id: 'event-1', event_visibility: 'public' }, error: null }, // update
      ],
    });

    const { PATCH } = await loadVisibilityRoute();
    const res = await PATCH(makeVisibilityRequest({ visibility: 'public' }), routeParams);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, id: 'event-1', visibility: 'public' });

    const updateCall = mockDb.from.mock.results[1].value;
    const written = updateCall.update.mock.calls[0][0];
    expect(written).not.toHaveProperty('published_credits');
    expect(written).not.toHaveProperty('page_state');
  });

  it('reports a lost race (event no longer Published by write time) as a conflict, not success', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: OWNED_PUBLISHED_PUBLIC_ROW, error: null }, // ownership
        { data: null, error: null }, // update matched no row
      ],
    });

    const { PATCH } = await loadVisibilityRoute();
    const res = await PATCH(makeVisibilityRequest({ visibility: 'unlisted' }), routeParams);

    expect(res.status).toBe(409);
    expect((await res.json()).success).toBe(false);
  });

  it('surfaces a database update failure instead of reporting success', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: OWNED_PUBLISHED_PUBLIC_ROW, error: null },
        { data: null, error: { message: 'connection reset' } },
      ],
    });

    const { PATCH } = await loadVisibilityRoute();
    const res = await PATCH(makeVisibilityRequest({ visibility: 'unlisted' }), routeParams);

    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });
});
