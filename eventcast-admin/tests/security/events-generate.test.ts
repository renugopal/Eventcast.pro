import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFromMock,
  authSuccess,
  type MockQueryBuilder,
  type MockRestreamerInstance,
} from './support/mocks';

const { mockDb, mockRestreamer, mockRestreamerClient, mockRequireAdmin } = vi.hoisted(() => {
  const restreamerInstance: MockRestreamerInstance = {
    setupChannel: vi.fn(),
    restartChannel: vi.fn(),
    toggleOutput: vi.fn(),
    deleteChannel: vi.fn(),
    deleteChannelFiles: vi.fn(),
  };
  return {
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
    },
    mockRestreamer: restreamerInstance,
    mockRestreamerClient: vi.fn(function () { return restreamerInstance; }),
    mockRequireAdmin: vi.fn(async () => authSuccess()),
  };
});

vi.mock('@/lib/auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/restreamer', () => ({ RestreamerClient: mockRestreamerClient }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockDb) }));

async function loadRoute() {
  const mod = await import('@/app/api/events/generate/route');
  return mod.POST;
}

function makeRequest(body: unknown): Request {
  return new Request('http://test.local/api/events/generate', {
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

describe('POST /api/events/generate — edit mode ownership', () => {
  it('rejects a cross-tenant or nonexistent editingId before any wallet read, photographer write, event mutation, or Restreamer call', async () => {
    mockDb.from = createFromMock({
      events: [{ data: null, error: null }], // ownership check misses
    });

    const POST = await loadRoute();
    const res = await POST(
      makeRequest({
        isEditing: true,
        editingId: 'someone-elses-event',
        groom_name: 'Groom',
        bride_name: 'Bride',
      })
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });

    expect(mockDb.from).toHaveBeenCalledTimes(1);
    expect(mockDb.from).toHaveBeenCalledWith('events');
    expect(mockRestreamerClient).not.toHaveBeenCalled();
  });

  it('uses the ownership-verified event id for a same-studio edit, never the raw client editingId, and never rewrites studio_id', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: { id: 'server-verified-id' }, error: null }, // 1: ownership check
        { data: [], error: null }, // 2: global slug-collision check (no conflict)
        { data: null, error: null }, // 3: the edit update itself
        { data: null, error: null }, // 4: restreamer-success url update
        { data: null, error: null }, // 5: mark-deployment-live update
      ],
      subscriptions: [{ data: null, error: null }],
    });
    mockRestreamer.setupChannel.mockResolvedValue({
      hlsUrl: 'https://hls.example/x',
      playerUrl: 'https://player.example/x',
    });

    const POST = await loadRoute();
    const res = await POST(
      makeRequest({
        isEditing: true,
        editingId: 'client-sent-editing-id', // deliberately different from the verified id
        groom_name: 'Groom',
        bride_name: 'Bride',
      })
    );

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    const updateCall = mockDb.from.mock.results[3].value;
    expect(updateCall.update).toHaveBeenCalledTimes(1);
    const updatePayload = updateCall.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload).not.toHaveProperty('studio_id');
    expect(updateCall.eq).toHaveBeenCalledWith('id', 'server-verified-id');
    expect(updateCall.eq).not.toHaveBeenCalledWith('id', 'client-sent-editing-id');
  });
});

describe('POST /api/events/generate — global slug-collision guard', () => {
  it('rejects a slug already used by another studio with 409, before any wallet debit or other write', async () => {
    mockDb.from = createFromMock({
      // create mode: only the slug-collision check is expected — a conflict
      // found here must short-circuit before anything else is queried.
      events: [{ data: [{ id: 'other-studios-event' }], error: null }],
    });

    const POST = await loadRoute();
    const res = await POST(
      makeRequest({
        groom_name: 'Groom',
        bride_name: 'Bride',
      })
    );

    expect(res.status).toBe(409);
    expect((await res.json()).success).toBe(false);
    expect(mockDb.from).toHaveBeenCalledTimes(1);
    expect(mockDb.from).toHaveBeenCalledWith('events');
  });
});
