import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createFromMock, authSuccess, type MockQueryBuilder, type AuthSuccess } from './support/mocks';
import type { StudioMemberRole } from '@/lib/auth';

type GmAuthSuccess = AuthSuccess & { studioMemberRole: StudioMemberRole };
function gmAuth(studioMemberRole: StudioMemberRole = 'owner'): GmAuthSuccess {
  return { ...authSuccess(), studioMemberRole };
}

const { mockDb, mockRequireAdmin } = vi.hoisted(() => {
  return {
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
    },
    mockRequireAdmin: vi.fn(async () => ({} as GmAuthSuccess)),
  };
});

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, requireAdmin: mockRequireAdmin };
});
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadListRoute() {
  const mod = await import('@/app/api/events/[eventId]/guest-memories/route');
  return mod.GET;
}

async function loadSettingsRoute() {
  const mod = await import('@/app/api/events/[eventId]/guest-memories/settings/route');
  return { GET: mod.GET, PATCH: mod.PATCH };
}

async function loadItemRoute() {
  const mod = await import('@/app/api/events/[eventId]/guest-memories/[photoId]/route');
  return { PATCH: mod.PATCH, DELETE: mod.DELETE };
}

const routeParams = { params: Promise.resolve({ eventId: 'evt-1' }) };
const routeParamsWithPhoto = { params: Promise.resolve({ eventId: 'evt-1', photoId: 'photo-1' }) };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(gmAuth());
});

describe('GET /api/events/[eventId]/guest-memories', () => {
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

  it('lists all photos including unapproved ones', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: 'evt-1' }, error: null }],
      guest_photos: [{ data: [{ id: 'p1', approved: false }, { id: 'p2', approved: true }], error: null }],
    });
    const GET = await loadListRoute();
    const res = await GET(new Request('http://test.local'), routeParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, guestMemories: [{ id: 'p1', approved: false }, { id: 'p2', approved: true }] });
  });
});

describe('GET/PATCH /api/events/[eventId]/guest-memories/settings', () => {
  it('reads manualApprovalEnabled from guest_photo_moderation', async () => {
    mockDb.from = createFromMock({ events: [{ data: { id: 'evt-1', guest_photo_moderation: true }, error: null }] });
    const { GET } = await loadSettingsRoute();
    const res = await GET(new Request('http://test.local'), routeParams);
    expect(await res.json()).toEqual({ success: true, manualApprovalEnabled: true });
  });

  it('rejects member-role write', async () => {
    mockRequireAdmin.mockResolvedValue(gmAuth('member'));
    const { PATCH } = await loadSettingsRoute();
    const res = await PATCH(
      new Request('http://test.local', { method: 'PATCH', body: JSON.stringify({ manualApprovalEnabled: true }) }),
      routeParams
    );
    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('writes guest_photo_moderation scoped by id + studio_id', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: 'evt-1' }, error: null }, { data: null, error: null }],
    });
    const { PATCH } = await loadSettingsRoute();
    const res = await PATCH(
      new Request('http://test.local', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manualApprovalEnabled: true }),
      }),
      routeParams
    );
    expect(res.status).toBe(200);
    const updateCall = mockDb.from.mock.results[1].value;
    expect(updateCall.update).toHaveBeenCalledWith({ guest_photo_moderation: true });
    expect(updateCall.eq.mock.calls).toEqual([
      ['id', 'evt-1'],
      ['studio_id', 'studio-a'],
    ]);
  });
});

describe('PATCH/DELETE /api/events/[eventId]/guest-memories/[photoId]', () => {
  it('rejects a cross-tenant or nonexistent event before resolving the photo', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });
    const { PATCH } = await loadItemRoute();
    const res = await PATCH(
      new Request('http://test.local', { method: 'PATCH', body: JSON.stringify({ approved: true }) }),
      routeParamsWithPhoto
    );
    expect(res.status).toBe(404);
  });

  it('rejects a photo belonging to a different event with the generic 404', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: 'evt-1' }, error: null }],
      guest_photos: [{ data: null, error: null }],
    });
    const { PATCH } = await loadItemRoute();
    const res = await PATCH(
      new Request('http://test.local', { method: 'PATCH', body: JSON.stringify({ approved: true }) }),
      routeParamsWithPhoto
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Guest memory not found' });
  });

  it('rejects member-role PATCH before any mutation', async () => {
    mockRequireAdmin.mockResolvedValue(gmAuth('member'));
    const { PATCH } = await loadItemRoute();
    const res = await PATCH(
      new Request('http://test.local', { method: 'PATCH', body: JSON.stringify({ approved: true }) }),
      routeParamsWithPhoto
    );
    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('approves a pending photo', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: 'evt-1' }, error: null }],
      guest_photos: [{ data: { id: 'photo-1', approved: false }, error: null }, { data: null, error: null }],
    });
    const { PATCH } = await loadItemRoute();
    const res = await PATCH(
      new Request('http://test.local', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved: true }),
      }),
      routeParamsWithPhoto
    );
    expect(res.status).toBe(200);
    const updateCall = mockDb.from.mock.results[2].value;
    expect(updateCall.update).toHaveBeenCalledWith({ approved: true });
  });

  it('deletes a photo scoped by id + event_id', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { id: 'evt-1' }, error: null }],
      guest_photos: [{ data: { id: 'photo-1' }, error: null }, { data: null, error: null }],
    });
    const { DELETE } = await loadItemRoute();
    const res = await DELETE(new Request('http://test.local', { method: 'DELETE' }), routeParamsWithPhoto);
    expect(res.status).toBe(200);
    const deleteCall = mockDb.from.mock.results[2].value;
    expect(deleteCall.delete).toHaveBeenCalled();
    expect(deleteCall.eq.mock.calls).toEqual([
      ['id', 'photo-1'],
      ['event_id', 'evt-1'],
    ]);
  });
});
