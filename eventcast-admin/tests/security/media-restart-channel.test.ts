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
  const mod = await import('@/app/api/media/restart-channel/route');
  return mod.POST;
}

function makeRequest(body: unknown): Request {
  return new Request('http://test.local/api/media/restart-channel', {
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

describe('POST /api/media/restart-channel — ownership', () => {
  it('rejects a cross-tenant or nonexistent slug before any Restreamer call', async () => {
    mockDb.from = createFromMock({
      events: [{ data: null, error: null }],
    });

    const POST = await loadRoute();
    const res = await POST(makeRequest({ slug: 'someone-elses-slug' }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockRestreamerClient).not.toHaveBeenCalled();
    expect(mockRestreamer.restartChannel).not.toHaveBeenCalled();
    expect(mockRestreamer.setupChannel).not.toHaveBeenCalled();
  });

  it('uses the verified database slug for Restreamer calls, never the client-supplied slug', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { slug: 'server-real-slug', youtube_stream_key: 'server-key' }, error: null }],
    });
    mockRestreamer.restartChannel.mockResolvedValue(true);

    const POST = await loadRoute();
    const res = await POST(makeRequest({ slug: 'client-guessed-slug' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mockRestreamer.restartChannel).toHaveBeenCalledWith('server-real-slug');
    expect(mockRestreamer.restartChannel).not.toHaveBeenCalledWith('client-guessed-slug');
  });

  it('does not require a YouTube stream key when the first restart succeeds', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { slug: 'evt-slug', youtube_stream_key: null }, error: null }],
    });
    mockRestreamer.restartChannel.mockResolvedValue(true);

    const POST = await loadRoute();
    const res = await POST(makeRequest({ slug: 'evt-slug' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mockRestreamer.restartChannel).toHaveBeenCalledTimes(1);
    expect(mockRestreamer.setupChannel).not.toHaveBeenCalled();
  });

  it('returns a clear error and never calls setupChannel when the first restart fails and no YouTube key exists', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { slug: 'evt-slug', youtube_stream_key: null }, error: null }],
    });
    mockRestreamer.restartChannel.mockResolvedValue(false);

    const POST = await loadRoute();
    const res = await POST(makeRequest({ slug: 'evt-slug' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'No YouTube stream key found for this event' });
    expect(mockRestreamer.restartChannel).toHaveBeenCalledTimes(1);
    expect(mockRestreamer.setupChannel).not.toHaveBeenCalled();
  });
});
