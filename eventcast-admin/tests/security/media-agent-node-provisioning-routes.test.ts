import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const PROVISIONING_SECRET = 'unit-test-provisioning-secret';
const PEPPER = 'unit-test-pepper-fixture';
const NODE_NAME = 'gcp-asia-south1-01';
const NODE_UUID = '11111111-1111-1111-1111-111111111111';

// ── Local, hand-rolled query-builder mock ───────────────────────────────────
// Supports exactly the two shapes these routes need:
//   .from('media_nodes').insert(...).select(...).single()   (provision route)
//   .from('media_nodes').select(...).eq(...).maybeSingle()  (findMediaNodeByName)
//   .from('media_node_credentials').insert(...).select(...).single()
interface FakeResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

function makeFakeDb(tables: Record<string, { insert?: FakeResult[]; select?: FakeResult[] }>) {
  const queues = new Map(
    Object.entries(tables).map(([k, v]) => [k, { insert: [...(v.insert ?? [])], select: [...(v.select ?? [])] }])
  );
  const insertCalls: { table: string; values: Record<string, unknown> }[] = [];

  const from = vi.fn((table: string) => {
    const queue = queues.get(table);
    if (!queue) throw new Error(`FakeDb: no config for table '${table}' in this test`);

    return {
      insert: (values: Record<string, unknown>) => {
        insertCalls.push({ table, values });
        return {
          select: (_columns: string) => ({
            single: async () => {
              const result = queue.insert.shift();
              if (!result) throw new Error(`FakeDb: no more insert() results queued for '${table}'`);
              return result;
            },
          }),
        };
      },
      select: (_columns: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: async () => {
            const result = queue.select.shift();
            if (!result) throw new Error(`FakeDb: no more select() results queued for '${table}'`);
            return result;
          },
        }),
      }),
    };
  });

  return { from, insertCalls };
}

// Loose return-type contract for `.from(table)` — deliberately wider than
// any single test's concrete fake builder shape, so `mockDb.from` can be
// reassigned per-test to whatever `makeFakeDb(...).from` produces without a
// `never`-typed placeholder (from an un-annotated always-throwing function)
// rejecting every later assignment.
interface FakeTableApi {
  insert: (values: Record<string, unknown>) => unknown;
  select: (columns: string) => unknown;
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
  process.env.MEDIA_NODE_TOKEN_PEPPER = PEPPER;
});

function authedRequest(url: string, body: unknown, secret: string | null = PROVISIONING_SECRET): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (secret !== null) headers.set('authorization', `Bearer ${secret}`);
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('POST /internal/media/nodes/provision', () => {
  async function loadRoute() {
    const mod = await import('@/app/internal/media/nodes/provision/route');
    return mod.POST;
  }

  it('registers a node and returns 201', async () => {
    mockDb.from = makeFakeDb({
      media_nodes: { insert: [{ data: { id: NODE_UUID, name: NODE_NAME }, error: null }] },
    }).from;

    const POST = await loadRoute();
    const req = authedRequest('http://test.local/internal/media/nodes/provision', {
      name: NODE_NAME,
      region: 'asia-south1',
      ingestHostname: 'ingest-asia-south1-01.eventcast.pro',
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ id: NODE_UUID, name: NODE_NAME });
  });

  it('fails closed (401) when MEDIA_NODE_PROVISIONING_SECRET is unset, without touching the database', async () => {
    delete process.env.MEDIA_NODE_PROVISIONING_SECRET;
    const POST = await loadRoute();
    const req = authedRequest('http://test.local/internal/media/nodes/provision', { name: NODE_NAME, region: 'r', ingestHostname: 'h' });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('fails closed (401) when the presented secret is wrong, without touching the database', async () => {
    const POST = await loadRoute();
    const req = authedRequest(
      'http://test.local/internal/media/nodes/provision',
      { name: NODE_NAME, region: 'r', ingestHostname: 'h' },
      'wrong-secret'
    );
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('fails closed (401) when no Authorization header is present', async () => {
    const POST = await loadRoute();
    const req = authedRequest(
      'http://test.local/internal/media/nodes/provision',
      { name: NODE_NAME, region: 'r', ingestHostname: 'h' },
      null
    );
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed body', async () => {
    const POST = await loadRoute();
    const req = authedRequest('http://test.local/internal/media/nodes/provision', { name: 123 });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('returns 409 when the node already exists (unique_violation passthrough)', async () => {
    mockDb.from = makeFakeDb({
      media_nodes: { insert: [{ data: null, error: { message: 'duplicate', code: '23505' } }] },
    }).from;

    const POST = await loadRoute();
    const req = authedRequest('http://test.local/internal/media/nodes/provision', {
      name: NODE_NAME,
      region: 'asia-south1',
      ingestHostname: 'ingest-asia-south1-01.eventcast.pro',
    });
    const res = await POST(req);

    expect(res.status).toBe(409);
  });

  it('never leaks the provisioning secret or an internal error message into the response', async () => {
    mockDb.from = makeFakeDb({
      media_nodes: { insert: [{ data: null, error: { message: 'connection reset to 10.0.0.5' } }] },
    }).from;

    const POST = await loadRoute();
    const req = authedRequest('http://test.local/internal/media/nodes/provision', {
      name: NODE_NAME,
      region: 'asia-south1',
      ingestHostname: 'ingest-asia-south1-01.eventcast.pro',
    });
    const res = await POST(req);
    const serialized = JSON.stringify(await res.json());

    expect(res.status).toBe(500);
    expect(serialized).not.toContain(PROVISIONING_SECRET);
    expect(serialized).not.toContain('connection reset to 10.0.0.5');
  });
});

describe('POST /internal/media/nodes/{node_id}/credentials', () => {
  async function loadRoute() {
    const mod = await import('@/app/internal/media/nodes/[node_id]/credentials/route');
    return mod.POST;
  }

  function requestFor(nodeId: string, body: unknown, secret: string | null = PROVISIONING_SECRET) {
    return {
      req: authedRequest(`http://test.local/internal/media/nodes/${nodeId}/credentials`, body, secret),
      params: Promise.resolve({ node_id: nodeId }),
    };
  }

  it('issues a credential and returns the raw token exactly once, with 201', async () => {
    mockDb.from = makeFakeDb({
      media_nodes: { select: [{ data: { id: NODE_UUID, config_version: '1' }, error: null }] },
      media_node_credentials: { insert: [{ data: { id: 'cred-1' }, error: null }] },
    }).from;

    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME, { slot: 1 });
    const res = await POST(req, { params });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.nodeId).toBe(NODE_UUID);
    expect(body.slot).toBe(1);
    expect(typeof body.token).toBe('string');
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails closed (401) when MEDIA_NODE_PROVISIONING_SECRET is unset, without touching the database', async () => {
    delete process.env.MEDIA_NODE_PROVISIONING_SECRET;
    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME, { slot: 1 });
    const res = await POST(req, { params });

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('fails closed (401) when the presented secret is wrong', async () => {
    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME, { slot: 1 }, 'wrong-secret');
    const res = await POST(req, { params });

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('fails closed (401) when MEDIA_NODE_TOKEN_PEPPER is unset, without touching the database', async () => {
    delete process.env.MEDIA_NODE_TOKEN_PEPPER;
    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME, { slot: 1 });
    const res = await POST(req, { params });

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid slot', async () => {
    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME, { slot: 3 });
    const res = await POST(req, { params });

    expect(res.status).toBe(400);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown node', async () => {
    mockDb.from = makeFakeDb({
      media_nodes: { select: [{ data: null, error: null }] },
    }).from;

    const POST = await loadRoute();
    const { req, params } = requestFor('no-such-node', { slot: 1 });
    const res = await POST(req, { params });

    expect(res.status).toBe(404);
  });

  it('returns 409 when the slot already has an active credential', async () => {
    mockDb.from = makeFakeDb({
      media_nodes: { select: [{ data: { id: NODE_UUID, config_version: '1' }, error: null }] },
      media_node_credentials: { insert: [{ data: null, error: { message: 'duplicate', code: '23505' } }] },
    }).from;

    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME, { slot: 1 });
    const res = await POST(req, { params });

    expect(res.status).toBe(409);
  });

  it('never leaks the pepper, provisioning secret, or an internal error message into the response', async () => {
    mockDb.from = makeFakeDb({
      media_nodes: { select: [{ data: { id: NODE_UUID, config_version: '1' }, error: null }] },
      media_node_credentials: { insert: [{ data: null, error: { message: 'connection reset to 10.0.0.5' } }] },
    }).from;

    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME, { slot: 1 });
    const res = await POST(req, { params });
    const serialized = JSON.stringify(await res.json());

    expect(res.status).toBe(500);
    expect(serialized).not.toContain(PEPPER);
    expect(serialized).not.toContain(PROVISIONING_SECRET);
    expect(serialized).not.toContain('connection reset to 10.0.0.5');
  });
});

// A same-length wrong secret and a different-length wrong secret, derived
// from the real fixture rather than hardcoded, so these stay valid if
// PROVISIONING_SECRET's value ever changes.
const SAME_LENGTH_WRONG_SECRET =
  PROVISIONING_SECRET.slice(0, -1) + (PROVISIONING_SECRET.at(-1) === 'x' ? 'y' : 'x');
const DIFFERENT_LENGTH_WRONG_SECRET = PROVISIONING_SECRET + '-extra';

describe('POST /internal/media/nodes/provision — timing-safe secret comparison', () => {
  async function loadRoute() {
    const mod = await import('@/app/internal/media/nodes/provision/route');
    return mod.POST;
  }

  const validBody = { name: NODE_NAME, region: 'r', ingestHostname: 'h' };

  it('succeeds with the correct secret', async () => {
    mockDb.from = makeFakeDb({
      media_nodes: { insert: [{ data: { id: NODE_UUID, name: NODE_NAME }, error: null }] },
    }).from;

    const POST = await loadRoute();
    const res = await POST(authedRequest('http://test.local/internal/media/nodes/provision', validBody));

    expect(res.status).not.toBe(401);
  });

  it('fails with an incorrect secret of the same length as the real one', async () => {
    expect(SAME_LENGTH_WRONG_SECRET.length).toBe(PROVISIONING_SECRET.length);
    expect(SAME_LENGTH_WRONG_SECRET).not.toBe(PROVISIONING_SECRET);

    const POST = await loadRoute();
    const res = await POST(
      authedRequest('http://test.local/internal/media/nodes/provision', validBody, SAME_LENGTH_WRONG_SECRET)
    );

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('fails with an incorrect secret of a different length than the real one', async () => {
    expect(DIFFERENT_LENGTH_WRONG_SECRET.length).not.toBe(PROVISIONING_SECRET.length);

    const POST = await loadRoute();
    const res = await POST(
      authedRequest('http://test.local/internal/media/nodes/provision', validBody, DIFFERENT_LENGTH_WRONG_SECRET)
    );

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('fails closed when no secret is presented at all', async () => {
    const POST = await loadRoute();
    const res = await POST(authedRequest('http://test.local/internal/media/nodes/provision', validBody, null));

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('fails on a malformed Authorization header (wrong scheme)', async () => {
    const POST = await loadRoute();
    const headers = new Headers({
      'content-type': 'application/json',
      authorization: `Basic ${PROVISIONING_SECRET}`,
    });
    const req = new Request('http://test.local/internal/media/nodes/provision', {
      method: 'POST',
      headers,
      body: JSON.stringify(validBody),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });
});

describe('POST /internal/media/nodes/{node_id}/credentials — timing-safe secret comparison', () => {
  async function loadRoute() {
    const mod = await import('@/app/internal/media/nodes/[node_id]/credentials/route');
    return mod.POST;
  }

  const validBody = { slot: 1 };
  const params = Promise.resolve({ node_id: NODE_NAME });

  it('succeeds with the correct secret', async () => {
    mockDb.from = makeFakeDb({
      media_nodes: { select: [{ data: { id: NODE_UUID, config_version: '1' }, error: null }] },
      media_node_credentials: { insert: [{ data: { id: 'cred-1' }, error: null }] },
    }).from;

    const POST = await loadRoute();
    const req = authedRequest(`http://test.local/internal/media/nodes/${NODE_NAME}/credentials`, validBody);
    const res = await POST(req, { params });

    expect(res.status).not.toBe(401);
  });

  it('fails with an incorrect secret of the same length as the real one', async () => {
    const POST = await loadRoute();
    const req = authedRequest(
      `http://test.local/internal/media/nodes/${NODE_NAME}/credentials`,
      validBody,
      SAME_LENGTH_WRONG_SECRET
    );
    const res = await POST(req, { params });

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('fails with an incorrect secret of a different length than the real one', async () => {
    const POST = await loadRoute();
    const req = authedRequest(
      `http://test.local/internal/media/nodes/${NODE_NAME}/credentials`,
      validBody,
      DIFFERENT_LENGTH_WRONG_SECRET
    );
    const res = await POST(req, { params });

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('fails closed when no secret is presented at all', async () => {
    const POST = await loadRoute();
    const req = authedRequest(`http://test.local/internal/media/nodes/${NODE_NAME}/credentials`, validBody, null);
    const res = await POST(req, { params });

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('fails on a malformed Authorization header (wrong scheme)', async () => {
    const POST = await loadRoute();
    const headers = new Headers({
      'content-type': 'application/json',
      authorization: `Basic ${PROVISIONING_SECRET}`,
    });
    const req = new Request(`http://test.local/internal/media/nodes/${NODE_NAME}/credentials`, {
      method: 'POST',
      headers,
      body: JSON.stringify(validBody),
    });

    const res = await POST(req, { params });

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });
});

describe('Middleware — Media Agent provisioning routes studio-JWT bypass', () => {
  async function loadMiddleware() {
    const mod = await import('@/middleware');
    return mod.middleware;
  }

  it('bypasses studio-JWT auth for the exact provision path', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest('http://test.local/internal/media/nodes/provision');
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('bypasses studio-JWT auth for the exact credentials path', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local/internal/media/nodes/${NODE_NAME}/credentials`);
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it.each([
    '/internal/media/nodes/provision/extra',
    '/internal/media/nodes/provision-other',
    `/internal/media/nodes/${NODE_NAME}/credentials/extra`,
    `/internal/media/nodes/${NODE_NAME}credentials`,
    '/internal/media/nodes//credentials',
  ])('does NOT bypass near-miss / malformed path %s — falls through to normal studio-JWT auth', async (p) => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local${p}`);
    const res = await middleware(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized — no session token provided');
  });

  it('does not bypass the sibling assignments path (unaffected by this change)', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local/internal/media/nodes/${NODE_NAME}/assignments`);
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });
});
