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
  const mod = await import('@/app/api/youtube/toggle-live/route');
  return mod.POST;
}

function makeRequest(body: unknown): Request {
  return new Request('http://test.local/api/youtube/toggle-live', {
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

describe('POST /api/youtube/toggle-live — ownership', () => {
  it('rejects a cross-tenant or nonexistent eventId before any Google OAuth or YouTube fetch call', async () => {
    mockDb.from = createFromMock({
      events: [{ data: null, error: null }],
    });

    const POST = await loadRoute();
    const res = await POST(
      makeRequest({ eventId: 'someone-elses-event', title: 'My Wedding', isLive: true })
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    // global.fetch keeps its default fail-fast stub from setupFetch.ts here —
    // if the route reached the OAuth/YouTube calls, this test would throw.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('uses the verified youtube_broadcast_id, not a client-supplied broadcastId, and scopes the final update by verified id and studio', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: { id: 'evt-1', youtube_broadcast_id: 'server-broadcast-id' }, error: null },
        { data: null, error: null }, // final status sync update
      ],
    });

    const fetchMock = vi.fn(
      async (input: Parameters<typeof globalThis.fetch>[0], _init?: Parameters<typeof globalThis.fetch>[1]) => {
        const url = String(input);
        if (url.includes('oauth2.googleapis.com')) {
          return new Response(JSON.stringify({ access_token: 'tok123' }), { status: 200 });
        }
        if (url.includes('liveBroadcasts')) {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        throw new Error(`Unexpected fetch to ${url}`);
      }
    );
    vi.stubGlobal('fetch', fetchMock);

    const POST = await loadRoute();
    const res = await POST(
      makeRequest({
        eventId: 'evt-1',
        broadcastId: 'client-injected-broadcast-id',
        title: 'My Wedding',
        isLive: true,
      })
    );

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, youtubeCallInit] = fetchMock.mock.calls[1];
    const requestInit = youtubeCallInit as Parameters<typeof globalThis.fetch>[1];
    const parsedBody = JSON.parse(requestInit!.body as string) as { id: string };
    expect(parsedBody.id).toBe('server-broadcast-id');
    expect(parsedBody.id).not.toBe('client-injected-broadcast-id');

    const updateCall = mockDb.from.mock.results[1].value;
    expect(updateCall.eq.mock.calls).toEqual([
      ['id', 'evt-1'],
      ['studio_id', 'studio-a'],
    ]);
  });
});
