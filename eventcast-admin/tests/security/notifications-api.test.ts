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

async function loadListRoute() {
  const mod = await import('@/app/api/notifications/route');
  return { GET: mod.GET };
}

async function loadReadRoute() {
  const mod = await import('@/app/api/notifications/[notificationId]/read/route');
  return { PATCH: mod.PATCH };
}

const routeParams = { params: Promise.resolve({ notificationId: 'notif-1' }) };

const NOTIFICATION_ROW = {
  id: 'notif-1',
  event_id: null,
  severity: 'info',
  notification_type: 'test',
  title: 'Something happened',
  body: null,
  read_at: null,
  created_at: '2026-08-12T00:00:00Z',
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess());
});

describe('GET /api/notifications', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));
    const { GET } = await loadListRoute();
    const res = await GET(new Request('http://test.local/api/notifications'));
    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it("lists only the caller's own studio_id", async () => {
    mockDb.from = createFromMock({ notifications: [{ data: [NOTIFICATION_ROW], error: null }] });
    const { GET } = await loadListRoute();
    const res = await GET(new Request('http://test.local/api/notifications'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, notifications: [NOTIFICATION_ROW] });
    const call = mockDb.from.mock.results[0].value;
    expect(call.eq).toHaveBeenCalledWith('studio_id', 'studio-a');
  });
});

describe('PATCH /api/notifications/[notificationId]/read', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));
    const { PATCH } = await loadReadRoute();
    const res = await PATCH(new Request('http://test.local/api/notifications/notif-1/read', { method: 'PATCH' }), routeParams);
    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('returns 404 for a cross-tenant or nonexistent notification, scoped by id and studio_id in one statement', async () => {
    mockDb.from = createFromMock({ notifications: [{ data: null, error: null }] });
    const { PATCH } = await loadReadRoute();
    const res = await PATCH(new Request('http://test.local/api/notifications/notif-1/read', { method: 'PATCH' }), routeParams);
    expect(res.status).toBe(404);

    const call = mockDb.from.mock.results[0].value;
    expect(call.eq.mock.calls).toEqual([
      ['id', 'notif-1'],
      ['studio_id', 'studio-a'],
    ]);
  });

  it('marks an owned notification read', async () => {
    mockDb.from = createFromMock({ notifications: [{ data: { id: 'notif-1' }, error: null }] });
    const { PATCH } = await loadReadRoute();
    const res = await PATCH(new Request('http://test.local/api/notifications/notif-1/read', { method: 'PATCH' }), routeParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    const call = mockDb.from.mock.results[0].value;
    const payload = call.update.mock.calls[0][0];
    expect(payload).toHaveProperty('read_at');
  });
});
