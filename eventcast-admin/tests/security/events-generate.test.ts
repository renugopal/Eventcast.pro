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
      media_event_assignments: [{ error: null }],
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

    // Media Agent draft assignment (Slice 3): must use the same
    // server-verified event id, never the raw client editingId.
    const assignmentCall = findCallForTable('media_event_assignments')!.result;
    expect(assignmentCall.insert).toHaveBeenCalledWith({ event_id: 'server-verified-id' });
  });
});

/** Finds the first recorded `.from(table)` call/result pair, in call order. */
function findCallForTable(table: string): { args: unknown[]; result: MockQueryBuilder } | undefined {
  for (let i = 0; i < mockDb.from.mock.calls.length; i++) {
    if (mockDb.from.mock.calls[i][0] === table) {
      return { args: mockDb.from.mock.calls[i], result: mockDb.from.mock.results[i].value };
    }
  }
  return undefined;
}

describe('POST /api/events/generate — Media Agent draft assignment (Slice 3)', () => {
  it('uses the newly-created event id for the draft assignment on a new-event create', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: [], error: null }, // 1: global slug-collision check (no conflict)
        { data: [{ id: 'new-event-id' }], error: null }, // 2: insert new event
        { data: null, error: null }, // 3: mark-deployment-live update
      ],
      subscriptions: [{ data: null, error: null }],
      media_event_assignments: [{ error: null }],
    });
    mockRequireAdmin.mockResolvedValue(authSuccess({ isSuperAdmin: true }));
    // A prior test in this file leaves setupChannel's resolved value set;
    // vi.clearAllMocks() clears call history but not mock implementations.
    // Reset it explicitly so restreamerData is falsy and no extra
    // restreamer-success 'events' update call is made here.
    mockRestreamer.setupChannel.mockResolvedValue(null);

    const POST = await loadRoute();
    const res = await POST(makeRequest({ groom_name: 'Groom', bride_name: 'Bride' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const assignmentCall = findCallForTable('media_event_assignments')!.result;
    expect(assignmentCall.insert).toHaveBeenCalledWith({ event_id: 'new-event-id' });
  });

  it('does not block event creation when the draft assignment write fails, and never leaks the error into the response', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: [], error: null },
        { data: [{ id: 'new-event-id' }], error: null },
        { data: null, error: null },
      ],
      subscriptions: [{ data: null, error: null }],
      media_event_assignments: [
        { error: { message: 'connection reset to 10.0.0.5', code: 'XX000' } },
      ],
    });
    mockRequireAdmin.mockResolvedValue(authSuccess({ isSuperAdmin: true }));
    // A prior test in this file leaves setupChannel's resolved value set;
    // vi.clearAllMocks() clears call history but not mock implementations.
    // Reset it explicitly so restreamerData is falsy and no extra
    // restreamer-success 'events' update call is made here.
    mockRestreamer.setupChannel.mockResolvedValue(null);

    const POST = await loadRoute();
    const res = await POST(makeRequest({ groom_name: 'Groom', bride_name: 'Bride' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(JSON.stringify(body)).not.toContain('connection reset to 10.0.0.5');
  });

  it('never includes any assignment internals in the HTTP response', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: [], error: null },
        { data: [{ id: 'new-event-id' }], error: null },
        { data: null, error: null },
      ],
      subscriptions: [{ data: null, error: null }],
      media_event_assignments: [{ error: null }],
    });
    mockRequireAdmin.mockResolvedValue(authSuccess({ isSuperAdmin: true }));
    // A prior test in this file leaves setupChannel's resolved value set;
    // vi.clearAllMocks() clears call history but not mock implementations.
    // Reset it explicitly so restreamerData is falsy and no extra
    // restreamer-success 'events' update call is made here.
    mockRestreamer.setupChannel.mockResolvedValue(null);

    const POST = await loadRoute();
    const res = await POST(makeRequest({ groom_name: 'Groom', bride_name: 'Bride' }));
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(['id', 'restreamer', 'slug', 'success', 'url']);
    for (const forbidden of [
      'assignment',
      'ingest_id',
      'ingestId',
      'playback_id',
      'playbackId',
      'stream_secret_hash',
      'assigned_media_node_id',
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
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
