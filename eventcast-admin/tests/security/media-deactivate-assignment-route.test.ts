import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const PROVISIONING_SECRET = 'unit-test-provisioning-secret';
const EVENT_ID = 'event-uuid-1';

// ── Local, hand-rolled query-builder/RPC mock — same shapes as the unit test file ──
interface FakeResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

function makeFakeDb(config: { events?: FakeResult[]; diagnostic?: FakeResult[]; rpc?: FakeResult[] }) {
  const eventsQueue = [...(config.events ?? [])];
  const diagnosticQueue = [...(config.diagnostic ?? [])];
  const rpcQueue = [...(config.rpc ?? [])];

  const from = vi.fn((table: string) => ({
    select: (_columns: string) => ({
      eq: (..._args: unknown[]) => ({
        maybeSingle: async () => {
          const queue = table === 'events' ? eventsQueue : diagnosticQueue;
          const result = queue.shift();
          if (!result) throw new Error(`FakeDb: no more select() results queued for '${table}'`);
          return result;
        },
      }),
    }),
  }));

  const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => {
    const result = rpcQueue.shift();
    if (!result) throw new Error(`FakeDb: no more rpc() results queued`);
    return result;
  });

  return { from, rpc };
}

function eventFoundResult(): FakeResult {
  return { data: { id: EVENT_ID }, error: null };
}

function deactivatedRpcResult(): FakeResult {
  return { data: [{ outcome: 'deactivated' }], error: null };
}

interface FakeTableApi {
  select: (columns: string) => unknown;
}

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    from: vi.fn((table: string): FakeTableApi => {
      throw new Error(`mockDb.from not configured for table '${table}' in this test`);
    }),
    rpc: vi.fn(async (_fn: string, _args: Record<string, unknown>): Promise<unknown> => {
      throw new Error('mockDb.rpc not configured in this test');
    }),
  },
}));

vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.MEDIA_NODE_PROVISIONING_SECRET = PROVISIONING_SECRET;
});

function authedRequest(secret: string | null = PROVISIONING_SECRET): Request {
  const headers = new Headers();
  if (secret !== null) headers.set('authorization', `Bearer ${secret}`);
  return new Request(`http://test.local/internal/media/assignments/${EVENT_ID}/deactivate`, {
    method: 'POST',
    headers,
  });
}

async function loadRoute() {
  const mod = await import('@/app/internal/media/assignments/[event_id]/deactivate/route');
  return mod.POST;
}

function params() {
  return Promise.resolve({ event_id: EVENT_ID });
}

function useFakeDb(config: { events?: FakeResult[]; diagnostic?: FakeResult[]; rpc?: FakeResult[] }) {
  const fake = makeFakeDb(config);
  mockDb.from = fake.from;
  mockDb.rpc = fake.rpc;
  return fake;
}

describe('POST /internal/media/assignments/{event_id}/deactivate', () => {
  it('deactivates on the first call and returns 200 with no secret in the body', async () => {
    useFakeDb({ events: [eventFoundResult()], rpc: [deactivatedRpcResult()] });

    const POST = await loadRoute();
    const res = await POST(authedRequest(), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ eventId: EVENT_ID, outcome: 'deactivated' });
  });

  it('returns 200 already_inactive on a retry — idempotent, not an error, not 409', async () => {
    useFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: [{ outcome: 'no_row_matched' }], error: null }],
      diagnostic: [{ data: { event_id: EVENT_ID, enabled: false }, error: null }],
    });

    const POST = await loadRoute();
    const res = await POST(authedRequest(), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ eventId: EVENT_ID, outcome: 'already_inactive' });
  });

  it('a second, repeated HTTP call after a successful deactivation also returns 200 already_inactive — simulates a repeated "End Live" click', async () => {
    useFakeDb({
      events: [eventFoundResult(), eventFoundResult()],
      rpc: [deactivatedRpcResult(), { data: [{ outcome: 'no_row_matched' }], error: null }],
      diagnostic: [{ data: { event_id: EVENT_ID, enabled: false }, error: null }],
    });

    const POST = await loadRoute();
    const first = await POST(authedRequest(), { params: params() });
    const second = await POST(authedRequest(), { params: params() });

    expect(first.status).toBe(200);
    expect((await first.json()).outcome).toBe('deactivated');
    expect(second.status).toBe(200);
    expect((await second.json()).outcome).toBe('already_inactive');
  });

  it('never exposes ingest/playback/secret/node/credential fields in the response body', async () => {
    useFakeDb({ events: [eventFoundResult()], rpc: [deactivatedRpcResult()] });

    const POST = await loadRoute();
    const res = await POST(authedRequest(), { params: params() });
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(['eventId', 'outcome']);
    for (const forbidden of [
      'token',
      'ingestUrl',
      'nodeId',
      'assignedMediaNodeId',
      'digest',
      'nonce',
      'requestId',
      'serviceRole',
      'youtubeStreamKey',
      'youtubeSecretReference',
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it('returns 404 event_not_found for an unknown event', async () => {
    useFakeDb({ events: [{ data: null, error: null }] });

    const POST = await loadRoute();
    const res = await POST(authedRequest(), { params: params() });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'event_not_found' });
  });

  it('returns 404 no_assignment when no assignment row exists for the event', async () => {
    useFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: [{ outcome: 'no_row_matched' }], error: null }],
      diagnostic: [{ data: null, error: null }],
    });

    const POST = await loadRoute();
    const res = await POST(authedRequest(), { params: params() });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_assignment' });
  });

  it('returns 500 internal_error on a generic RPC failure, without leaking the message', async () => {
    useFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: null, error: { message: 'connection reset to 10.0.0.5' } }],
    });

    const POST = await loadRoute();
    const res = await POST(authedRequest(), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(body)).not.toContain('connection reset to 10.0.0.5');
  });

  describe('operator-secret gating (fail-closed, timing-safe)', () => {
    it('fails closed (401) when MEDIA_NODE_PROVISIONING_SECRET is unset, without touching the database', async () => {
      delete process.env.MEDIA_NODE_PROVISIONING_SECRET;
      const POST = await loadRoute();
      const res = await POST(authedRequest(), { params: params() });

      expect(res.status).toBe(401);
      expect(mockDb.from).not.toHaveBeenCalled();
      expect(mockDb.rpc).not.toHaveBeenCalled();
    });

    it('fails closed (401) when no Authorization header is present', async () => {
      const POST = await loadRoute();
      const res = await POST(authedRequest(null), { params: params() });

      expect(res.status).toBe(401);
      expect(mockDb.from).not.toHaveBeenCalled();
    });

    it('fails closed (401) for an incorrect secret of the same length as the real one', async () => {
      const sameLengthWrong =
        PROVISIONING_SECRET.slice(0, -1) + (PROVISIONING_SECRET.at(-1) === 'x' ? 'y' : 'x');
      expect(sameLengthWrong.length).toBe(PROVISIONING_SECRET.length);

      const POST = await loadRoute();
      const res = await POST(authedRequest(sameLengthWrong), { params: params() });

      expect(res.status).toBe(401);
      expect(mockDb.from).not.toHaveBeenCalled();
    });

    it('fails closed (401) for an incorrect secret of a different length than the real one', async () => {
      const differentLengthWrong = PROVISIONING_SECRET + '-extra';
      expect(differentLengthWrong.length).not.toBe(PROVISIONING_SECRET.length);

      const POST = await loadRoute();
      const res = await POST(authedRequest(differentLengthWrong), { params: params() });

      expect(res.status).toBe(401);
      expect(mockDb.from).not.toHaveBeenCalled();
    });

    it('fails closed (401) on a malformed Authorization header (wrong scheme)', async () => {
      const headers = new Headers({ authorization: `Basic ${PROVISIONING_SECRET}` });
      const req = new Request(`http://test.local/internal/media/assignments/${EVENT_ID}/deactivate`, {
        method: 'POST',
        headers,
      });

      const POST = await loadRoute();
      const res = await POST(req, { params: params() });

      expect(res.status).toBe(401);
      expect(mockDb.from).not.toHaveBeenCalled();
    });

    it('succeeds with the correct secret', async () => {
      useFakeDb({ events: [eventFoundResult()], rpc: [deactivatedRpcResult()] });

      const POST = await loadRoute();
      const res = await POST(authedRequest(), { params: params() });

      expect(res.status).not.toBe(401);
    });
  });
});

describe('Middleware — assignment-deactivation studio-JWT bypass', () => {
  async function loadMiddleware() {
    const mod = await import('@/middleware');
    return mod.middleware;
  }

  it('bypasses studio-JWT auth for the exact deactivation path', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local/internal/media/assignments/${EVENT_ID}/deactivate`);
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('bypasses with an optional trailing slash', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local/internal/media/assignments/${EVENT_ID}/deactivate/`);
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it.each([
    `/internal/media/assignments/${EVENT_ID}/deactivate/extra`,
    '/internal/media/assignments/deactivate',
    `/internal/media/assignments/${EVENT_ID}deactivate`,
    '/internal/media/assignments//deactivate',
  ])('does NOT bypass near-miss / malformed path %s — falls through to normal studio-JWT auth', async (p) => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local${p}`);
    const res = await middleware(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized — no session token provided');
  });

  it('does not bypass the sibling assignment-status path (unaffected by this change)', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local/internal/media/assignments/${EVENT_ID}/status`);
    expect((await middleware(req)).status).toBe(200);
  });

  it('the sibling activation path still bypasses too — unaffected by adding the deactivation pattern', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local/internal/media/assignments/${EVENT_ID}/activate`);
    expect((await middleware(req)).status).toBe(200);
  });
});

describe('No studio-JWT authorization path exists for this route', () => {
  it('a request with no Authorization header at all reaches the route (bypassed by middleware) and gets the route\'s own generic 401, not the studio-JWT "no session token" message', async () => {
    const POST = await loadRoute();
    const res = await POST(authedRequest(null), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'unauthorized' });
    expect(body.error).not.toBe('Unauthorized — no session token provided');
  });

  it('a request carrying a plausible-looking studio session cookie instead of the operator secret is still rejected — this route never inspects session cookies', async () => {
    const headers = new Headers({ cookie: 'sb-access-token=some-studio-jwt-looking-value' });
    const req = new Request(`http://test.local/internal/media/assignments/${EVENT_ID}/deactivate`, {
      method: 'POST',
      headers,
    });

    const POST = await loadRoute();
    const res = await POST(req, { params: params() });

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });
});
