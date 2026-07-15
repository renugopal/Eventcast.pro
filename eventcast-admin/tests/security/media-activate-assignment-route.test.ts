import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const PROVISIONING_SECRET = 'unit-test-provisioning-secret';
const EVENT_ID = 'event-uuid-1';
const NODE_ID = 'node-uuid-1';
const NODE_HOSTNAME = 'ingest-asia-south1-01.eventcast.pro';

// ── Local, hand-rolled query-builder mock — same shapes as the unit test file ──
interface FakeResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

function makeFakeDb(tables: Record<string, { select?: FakeResult[]; update?: FakeResult[] }>) {
  const queues = new Map(
    Object.entries(tables).map(([k, v]) => [k, { select: [...(v.select ?? [])], update: [...(v.update ?? [])] }])
  );

  const from = vi.fn((table: string) => {
    const queue = queues.get(table);
    if (!queue) throw new Error(`FakeDb: no config for table '${table}' in this test`);

    return {
      select: (_columns: string) => {
        const builder = {
          eq: (..._args: unknown[]) => builder,
          neq: (..._args: unknown[]) => builder,
          order: (..._args: unknown[]) => builder,
          limit: async (_count: number) => {
            const result = queue.select.shift();
            if (!result) throw new Error(`FakeDb: no more select() results queued for '${table}'`);
            return result;
          },
          maybeSingle: async () => {
            const result = queue.select.shift();
            if (!result) throw new Error(`FakeDb: no more select() results queued for '${table}'`);
            return result;
          },
        };
        return builder;
      },
      update: (_values: Record<string, unknown>) => {
        const builder = {
          eq: (..._args: unknown[]) => builder,
          select: async (_columns: string) => {
            const result = queue.update.shift();
            if (!result) throw new Error(`FakeDb: no more update() results queued for '${table}'`);
            return result;
          },
        };
        return builder;
      },
    };
  });

  return { from };
}

function eventFoundResult(): FakeResult {
  return { data: { id: EVENT_ID }, error: null };
}

function nodeFoundResult(): FakeResult {
  return { data: [{ id: NODE_ID, ingest_hostname: NODE_HOSTNAME }], error: null };
}

// Loose return-type contract for `.from(table)` — deliberately wider than
// any single test's concrete fake builder shape, so `mockDb.from` can be
// reassigned per-test to whatever `makeFakeDb(...).from` produces without a
// `never`-typed placeholder (from an un-annotated always-throwing function)
// rejecting every later assignment.
interface FakeTableApi {
  select: (columns: string) => unknown;
  update: (values: Record<string, unknown>) => unknown;
}

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    from: vi.fn((table: string): FakeTableApi => {
      throw new Error(`mockDb.from not configured for table '${table}' in this test`);
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
  return new Request(`http://test.local/internal/media/assignments/${EVENT_ID}/activate`, {
    method: 'POST',
    headers,
  });
}

async function loadRoute() {
  const mod = await import('@/app/internal/media/assignments/[event_id]/activate/route');
  return mod.POST;
}

function params() {
  return Promise.resolve({ event_id: EVENT_ID });
}

describe('POST /internal/media/assignments/{event_id}/activate', () => {
  it('activates on the first call and returns the raw secret exactly once, with 201', async () => {
    mockDb.from = makeFakeDb({
      events: { select: [eventFoundResult()] },
      media_nodes: { select: [nodeFoundResult()] },
      media_event_assignments: { update: [{ data: [{ event_id: EVENT_ID }], error: null }] },
    }).from;

    const POST = await loadRoute();
    const res = await POST(authedRequest(), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.eventId).toBe(EVENT_ID);
    expect(typeof body.token).toBe('string');
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.ingestUrl).toMatch(
      new RegExp(`^rtmp://${NODE_HOSTNAME.replace(/\./g, '\\.')}/live/[0-9a-f]{64}$`)
    );
  });

  it('never exposes node credentials, digests, nonces, service-role, or YouTube-key-shaped fields in the response', async () => {
    mockDb.from = makeFakeDb({
      events: { select: [eventFoundResult()] },
      media_nodes: { select: [nodeFoundResult()] },
      media_event_assignments: { update: [{ data: [{ event_id: EVENT_ID }], error: null }] },
    }).from;

    const POST = await loadRoute();
    const res = await POST(authedRequest(), { params: params() });
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(['eventId', 'ingestUrl', 'token']);
    for (const forbidden of [
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

  it('returns 409 already_activated on a retry, with no secret anywhere in the body', async () => {
    mockDb.from = makeFakeDb({
      events: { select: [eventFoundResult()] },
      media_nodes: { select: [nodeFoundResult()] },
      media_event_assignments: {
        update: [{ data: [], error: null }],
        select: [{ data: { event_id: EVENT_ID, enabled: true }, error: null }],
      },
    }).from;

    const POST = await loadRoute();
    const res = await POST(authedRequest(), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual({ error: 'already_activated' });
    expect(JSON.stringify(body)).not.toMatch(/[0-9a-f]{64}/);
  });

  it('returns 404 event_not_found for an unknown event', async () => {
    mockDb.from = makeFakeDb({
      events: { select: [{ data: null, error: null }] },
    }).from;

    const POST = await loadRoute();
    const res = await POST(authedRequest(), { params: params() });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'event_not_found' });
  });

  it('returns 404 no_draft_assignment when no assignment row exists', async () => {
    mockDb.from = makeFakeDb({
      events: { select: [eventFoundResult()] },
      media_nodes: { select: [nodeFoundResult()] },
      media_event_assignments: {
        update: [{ data: [], error: null }],
        select: [{ data: null, error: null }],
      },
    }).from;

    const POST = await loadRoute();
    const res = await POST(authedRequest(), { params: params() });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no_draft_assignment' });
  });

  it('returns 503 no_eligible_node when there are zero eligible nodes', async () => {
    mockDb.from = makeFakeDb({
      events: { select: [eventFoundResult()] },
      media_nodes: { select: [{ data: [], error: null }] },
    }).from;

    const POST = await loadRoute();
    const res = await POST(authedRequest(), { params: params() });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'no_eligible_node' });
  });

  it('returns 500 internal_error on a generic database failure, without leaking the message', async () => {
    mockDb.from = makeFakeDb({
      events: { select: [eventFoundResult()] },
      media_nodes: { select: [nodeFoundResult()] },
      media_event_assignments: {
        update: [{ data: null, error: { message: 'connection reset to 10.0.0.5' } }],
      },
    }).from;

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
      const req = new Request(`http://test.local/internal/media/assignments/${EVENT_ID}/activate`, {
        method: 'POST',
        headers,
      });

      const POST = await loadRoute();
      const res = await POST(req, { params: params() });

      expect(res.status).toBe(401);
      expect(mockDb.from).not.toHaveBeenCalled();
    });

    it('succeeds with the correct secret', async () => {
      mockDb.from = makeFakeDb({
        events: { select: [eventFoundResult()] },
        media_nodes: { select: [nodeFoundResult()] },
        media_event_assignments: { update: [{ data: [{ event_id: EVENT_ID }], error: null }] },
      }).from;

      const POST = await loadRoute();
      const res = await POST(authedRequest(), { params: params() });

      expect(res.status).not.toBe(401);
    });
  });
});

describe('Middleware — assignment-activation studio-JWT bypass', () => {
  async function loadMiddleware() {
    const mod = await import('@/middleware');
    return mod.middleware;
  }

  it('bypasses studio-JWT auth for the exact activation path', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local/internal/media/assignments/${EVENT_ID}/activate`);
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('bypasses with an optional trailing slash', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local/internal/media/assignments/${EVENT_ID}/activate/`);
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it.each([
    `/internal/media/assignments/${EVENT_ID}/activate/extra`,
    `/internal/media/assignments/${EVENT_ID}/deactivate`,
    '/internal/media/assignments/activate',
    `/internal/media/assignments/${EVENT_ID}activate`,
    '/internal/media/assignments//activate',
  ])('does NOT bypass near-miss / sibling / malformed path %s — falls through to normal studio-JWT auth', async (p) => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local${p}`);
    const res = await middleware(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized — no session token provided');
  });

  it('does not bypass the sibling node-provisioning or assignments-pull paths (unaffected by this change)', async () => {
    const middleware = await loadMiddleware();
    const req1 = new NextRequest('http://test.local/internal/media/nodes/provision');
    const req2 = new NextRequest('http://test.local/internal/media/nodes/some-node/assignments');
    expect((await middleware(req1)).status).toBe(200);
    expect((await middleware(req2)).status).toBe(200);
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
    const req = new Request(`http://test.local/internal/media/assignments/${EVENT_ID}/activate`, {
      method: 'POST',
      headers,
    });

    const POST = await loadRoute();
    const res = await POST(req, { params: params() });

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });
});
