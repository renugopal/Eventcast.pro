import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createFromMock, authSuccess, type MockQueryBuilder, type AuthSuccess } from './support/mocks';
import type { StudioMemberRole } from '@/lib/auth';

type WishAuthSuccess = AuthSuccess & { studioMemberRole: StudioMemberRole };
function wishAuth(studioMemberRole: StudioMemberRole = 'owner'): WishAuthSuccess {
  return { ...authSuccess(), studioMemberRole };
}

const { mockDb, mockRequireAdmin } = vi.hoisted(() => {
  return {
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
    },
    mockRequireAdmin: vi.fn(async () => ({} as WishAuthSuccess)),
  };
});

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, requireAdmin: mockRequireAdmin };
});
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadListRoute() {
  const mod = await import('@/app/api/events/[eventId]/wishes/route');
  return mod.GET;
}

async function loadItemRoute() {
  const mod = await import('@/app/api/events/[eventId]/wishes/[wishId]/route');
  return { PATCH: mod.PATCH, DELETE: mod.DELETE };
}

const routeParams = { params: Promise.resolve({ eventId: 'evt-1' }) };
const routeParamsWithWish = { params: Promise.resolve({ eventId: 'evt-1', wishId: 'wish-1' }) };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(wishAuth());
});

describe('GET /api/events/[eventId]/wishes', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }) as never);
    const GET = await loadListRoute();
    const res = await GET(new Request('http://test.local'), routeParams);
    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent event with the generic 404', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });
    const GET = await loadListRoute();
    const res = await GET(new Request('http://test.local'), routeParams);
    expect(res.status).toBe(404);
  });

  it('lists wishes pinned-first then newest-first, including hidden/rejected', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: 'evt-1' }, error: null }],
      wishes: [{ data: [{ id: 'w1', status: 'hidden' }, { id: 'w2', status: 'approved' }], error: null }],
    });
    const GET = await loadListRoute();
    const res = await GET(new Request('http://test.local'), routeParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, wishes: [{ id: 'w1', status: 'hidden' }, { id: 'w2', status: 'approved' }] });
  });
});

describe('PATCH /api/events/[eventId]/wishes/[wishId]', () => {
  it('rejects a cross-tenant or nonexistent event before resolving the wish', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });
    const { PATCH } = await loadItemRoute();
    const res = await PATCH(
      new Request('http://test.local', { method: 'PATCH', body: JSON.stringify({ status: 'hidden' }) }),
      routeParamsWithWish
    );
    expect(res.status).toBe(404);
  });

  it('rejects a wish belonging to a different event with the generic 404', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: 'evt-1' }, error: null }],
      wishes: [{ data: null, error: null }],
    });
    const { PATCH } = await loadItemRoute();
    const res = await PATCH(
      new Request('http://test.local', { method: 'PATCH', body: JSON.stringify({ status: 'hidden' }) }),
      routeParamsWithWish
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Wish not found' });
  });

  it('rejects an invalid status value', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: 'evt-1' }, error: null }],
      wishes: [{ data: { id: 'wish-1' }, error: null }],
    });
    const { PATCH } = await loadItemRoute();
    const res = await PATCH(
      new Request('http://test.local', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'not-a-status' }),
      }),
      routeParamsWithWish
    );
    expect(res.status).toBe(400);
  });

  it('rejects member-role PATCH before any mutation', async () => {
    mockRequireAdmin.mockResolvedValue(wishAuth('member'));
    const { PATCH } = await loadItemRoute();
    const res = await PATCH(
      new Request('http://test.local', { method: 'PATCH', body: JSON.stringify({ status: 'hidden' }) }),
      routeParamsWithWish
    );
    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('updates status and isPinned independently in one call scoped by id + event_id', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: 'evt-1' }, error: null }],
      wishes: [{ data: { id: 'wish-1' }, error: null }, { data: null, error: null }],
    });
    const { PATCH } = await loadItemRoute();
    const res = await PATCH(
      new Request('http://test.local', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected', isPinned: true }),
      }),
      routeParamsWithWish
    );
    expect(res.status).toBe(200);
    const updateCall = mockDb.from.mock.results[2].value;
    expect(updateCall.update).toHaveBeenCalledWith({ status: 'rejected', is_pinned: true });
    expect(updateCall.eq.mock.calls).toEqual([
      ['id', 'wish-1'],
      ['event_id', 'evt-1'],
    ]);
  });
});

describe('DELETE /api/events/[eventId]/wishes/[wishId]', () => {
  it('deletes scoped by id + event_id', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: 'evt-1' }, error: null }],
      wishes: [{ data: { id: 'wish-1' }, error: null }, { data: null, error: null }],
    });
    const { DELETE } = await loadItemRoute();
    const res = await DELETE(new Request('http://test.local', { method: 'DELETE' }), routeParamsWithWish);
    expect(res.status).toBe(200);
    const deleteCall = mockDb.from.mock.results[2].value;
    expect(deleteCall.delete).toHaveBeenCalled();
    expect(deleteCall.eq.mock.calls).toEqual([
      ['id', 'wish-1'],
      ['event_id', 'evt-1'],
    ]);
  });
});
