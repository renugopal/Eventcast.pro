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
  const mod = await import('@/app/api/media/toggle-youtube/route');
  return mod.POST;
}

function makeRequest(body: unknown): Request {
  return new Request('http://test.local/api/media/toggle-youtube', {
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

describe('POST /api/media/toggle-youtube — ownership', () => {
  it('rejects a cross-tenant or nonexistent eventId before reading a stream key or calling Restreamer', async () => {
    mockDb.from = createFromMock({
      events: [{ data: null, error: null }],
    });

    const POST = await loadRoute();
    const res = await POST(makeRequest({ enabled: true, eventId: 'someone-elses-event' }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockRestreamerClient).not.toHaveBeenCalled();
    expect(mockRestreamer.toggleOutput).not.toHaveBeenCalled();
  });

  it('uses the verified event slug and stored youtube_stream_key, not any client-supplied values', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { slug: 'server-real-slug', youtube_stream_key: 'server-real-key' }, error: null }],
    });
    mockRestreamer.toggleOutput.mockResolvedValue(true);

    const POST = await loadRoute();
    const res = await POST(makeRequest({ enabled: true, eventId: 'evt-1' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    expect(mockRestreamer.toggleOutput).toHaveBeenCalledTimes(1);
    const [slugArg, outputId, enabledArg, outputConfig] = mockRestreamer.toggleOutput.mock.calls[0];
    expect(slugArg).toBe('server-real-slug');
    expect(outputId).toBe('youtube');
    expect(enabledArg).toBe(true);
    expect((outputConfig as { address: string }).address).toContain('server-real-key');
  });
});
