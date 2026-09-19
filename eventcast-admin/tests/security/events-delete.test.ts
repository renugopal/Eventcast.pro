import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFromMock, authSuccess, type MockQueryBuilder, type AuthSuccess } from './support/mocks';
import type { StudioMemberRole } from '@/lib/auth';

type DeleteAuthSuccess = AuthSuccess & { studioMemberRole: StudioMemberRole };
function deleteAuth(studioMemberRole: StudioMemberRole = 'owner'): DeleteAuthSuccess {
  return { ...authSuccess(), studioMemberRole };
}

const { mockDb, mockRequireAdmin, defaultFrom } = vi.hoisted(() => {
  const defaultFrom = vi.fn((table: string): MockQueryBuilder => {
    throw new Error(`mockDb.from not configured for table '${table}' in this test`);
  });
  return {
    mockDb: { from: defaultFrom },
    mockRequireAdmin: vi.fn(async () => ({} as DeleteAuthSuccess)),
    defaultFrom,
  };
});

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, requireAdmin: mockRequireAdmin };
});
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadRoute() {
  const mod = await import('@/app/api/events/delete/route');
  return mod.POST;
}

function makeRequest(body: unknown): Request {
  return new Request('http://test.local/api/events/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  // Every test starts with the same known, fail-loud `mockDb.from` — tests
  // that need real data explicitly reassign it, so no test can accidentally
  // inherit a mock configuration left over from a previous test.
  mockDb.from = defaultFrom;
  defaultFrom.mockClear();
  mockRequireAdmin.mockResolvedValue(deleteAuth());
});

describe('POST /api/events/delete — authorization', () => {
  it('rejects a member-role studio user before any mutation', async () => {
    mockRequireAdmin.mockResolvedValue(deleteAuth('member'));

    const POST = await loadRoute();
    const res = await POST(makeRequest({ id: 'evt-1', permanent: false }));

    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows an owner to archive', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: { id: 'evt-1' }, error: null },
        { data: null, error: null }, // archive update
      ],
    });

    const POST = await loadRoute();
    const res = await POST(makeRequest({ id: 'evt-1', permanent: false }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Event archived successfully' });
  });

  it('allows an admin to archive', async () => {
    mockRequireAdmin.mockResolvedValue(deleteAuth('admin'));
    mockDb.from = createFromMock({
      events: [
        { data: { id: 'evt-1' }, error: null },
        { data: null, error: null },
      ],
    });

    const POST = await loadRoute();
    const res = await POST(makeRequest({ id: 'evt-1', permanent: false }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Event archived successfully' });
  });
});

describe('POST /api/events/delete — permanent delete removed', () => {
  it('rejects permanent:true with 400 and performs no database or external call', async () => {
    const POST = await loadRoute();
    const res = await POST(makeRequest({ id: 'evt-1', permanent: true }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/permanent-delete/i);
    expect(mockDb.from).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('POST /api/events/delete — ownership', () => {
  it('rejects a cross-tenant or nonexistent event before soft delete', async () => {
    mockDb.from = createFromMock({
      events: [{ data: null, error: null }],
    });

    const POST = await loadRoute();
    const res = await POST(makeRequest({ id: 'someone-elses-event', permanent: false }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
    expect(mockDb.from).toHaveBeenCalledWith('events');
    // The suite-wide fail-fast global.fetch would throw on any outbound call;
    // asserting zero calls proves no external cleanup was attempted at all.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('scopes a same-studio soft delete by both verified event id and studio id', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: { id: 'evt-1' }, error: null },
        { data: null, error: null }, // soft-delete update
      ],
    });

    const POST = await loadRoute();
    const res = await POST(makeRequest({ id: 'evt-1', permanent: false }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Event archived successfully' });

    const updateCall = mockDb.from.mock.results[1].value;
    expect(updateCall.eq.mock.calls).toEqual([
      ['id', 'evt-1'],
      ['studio_id', 'studio-a'],
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
