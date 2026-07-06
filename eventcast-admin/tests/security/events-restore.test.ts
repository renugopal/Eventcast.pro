import { beforeEach, describe, expect, it, vi } from 'vitest';
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

async function loadRoute() {
  const mod = await import('@/app/api/events/restore/route');
  return mod.POST;
}

function makeRequest(body: unknown): Request {
  return new Request('http://test.local/api/events/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess());
});

describe('POST /api/events/restore — ownership', () => {
  it('rejects a cross-tenant or nonexistent event before any update', async () => {
    mockDb.from = createFromMock({
      events: [{ data: null, error: null }],
    });

    const POST = await loadRoute();
    const res = await POST(makeRequest({ id: 'someone-elses-event' }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
    expect(mockDb.from).toHaveBeenCalledWith('events');
  });

  it('scopes a same-studio restore by both verified event id and studio id', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: { id: 'evt-1' }, error: null },
        { data: null, error: null }, // restore update
      ],
    });

    const POST = await loadRoute();
    const res = await POST(makeRequest({ id: 'evt-1' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Event restored successfully' });

    const updateCall = mockDb.from.mock.results[1].value;
    expect(updateCall.update).toHaveBeenCalledWith({ archived_at: null });
    expect(updateCall.eq.mock.calls).toEqual([
      ['id', 'evt-1'],
      ['studio_id', 'studio-a'],
    ]);
  });
});
