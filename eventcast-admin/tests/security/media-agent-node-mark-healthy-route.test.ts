import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const PROVISIONING_SECRET = 'unit-test-provisioning-secret';
const NODE_NAME = 'gcp-asia-south1-01';
const NODE_UUID = '11111111-1111-1111-1111-111111111111';

// ── Local, hand-rolled query-builder mock ───────────────────────────────────
// Supports the three shapes markNodeHealthy needs:
//   .from('media_nodes').select('id, status, maintenance_mode').eq('name', x).maybeSingle()
//   .from('media_node_credentials').select('id').eq('media_node_id', x).is('revoked_at', null)
//   .from('media_nodes').update({status:'healthy'}).eq('id', x).neq('status','retired').select('id')
interface FakeResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

function makeFakeDb(config: {
  nodeLookup?: FakeResult[];
  credentialLookup?: FakeResult[];
  update?: FakeResult[];
}) {
  const nodeLookupQueue = [...(config.nodeLookup ?? [])];
  const credentialLookupQueue = [...(config.credentialLookup ?? [])];
  const updateQueue = [...(config.update ?? [])];
  const updateCalls: { eqArgs: unknown[][]; neqArgs: unknown[][] }[] = [];

  const from = vi.fn((table: string) => ({
    select: (_columns: string) => {
      if (table === 'media_nodes') {
        return {
          eq: (_col: string, _val: unknown) => ({
            maybeSingle: async () => {
              const result = nodeLookupQueue.shift();
              if (!result) throw new Error('FakeDb: no more media_nodes select() results queued');
              return result;
            },
          }),
        };
      }
      if (table === 'media_node_credentials') {
        return {
          eq: (_col: string, _val: unknown) => ({
            is: async (_col2: string, _val2: null) => {
              const result = credentialLookupQueue.shift();
              if (!result) throw new Error('FakeDb: no more media_node_credentials select() results queued');
              return result;
            },
          }),
        };
      }
      throw new Error(`FakeDb: no select() config for table '${table}'`);
    },
    update: (_values: Record<string, unknown>) => {
      const record = { eqArgs: [] as unknown[][], neqArgs: [] as unknown[][] };
      updateCalls.push(record);
      const builder = {
        eq: (...args: unknown[]) => {
          record.eqArgs.push(args);
          return builder;
        },
        neq: (...args: unknown[]) => {
          record.neqArgs.push(args);
          return builder;
        },
        select: async (_columns: string) => {
          const result = updateQueue.shift();
          if (!result) throw new Error('FakeDb: no more update() results queued');
          return result;
        },
      };
      return builder;
    },
  }));

  return { from, updateCalls };
}

function nodeRow(overrides: Partial<{ id: string; status: string; maintenance_mode: boolean }> = {}) {
  return {
    data: { id: NODE_UUID, status: 'provisioning', maintenance_mode: false, ...overrides },
    error: null,
  };
}

function oneActiveCredential(): FakeResult {
  return { data: [{ id: 'cred-1' }], error: null };
}

function transitionedResult(): FakeResult {
  return { data: [{ id: NODE_UUID }], error: null };
}

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

function authedRequest(url: string, secret: string | null = PROVISIONING_SECRET): Request {
  const headers = new Headers();
  if (secret !== null) headers.set('authorization', `Bearer ${secret}`);
  return new Request(url, { method: 'POST', headers });
}

describe('POST /internal/media/nodes/{node_id}/mark-healthy', () => {
  async function loadRoute() {
    const mod = await import('@/app/internal/media/nodes/[node_id]/mark-healthy/route');
    return mod.POST;
  }

  function requestFor(nodeId: string, secret: string | null = PROVISIONING_SECRET) {
    return {
      req: authedRequest(`http://test.local/internal/media/nodes/${nodeId}/mark-healthy`, secret),
      params: Promise.resolve({ node_id: nodeId }),
    };
  }

  it('transitions a provisioning node with an active credential to healthy, returns 200', async () => {
    mockDb.from = makeFakeDb({
      nodeLookup: [nodeRow({ status: 'provisioning' })],
      credentialLookup: [oneActiveCredential()],
      update: [transitionedResult()],
    }).from;

    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME);
    const res = await POST(req, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ node: NODE_NAME, status: 'healthy' });
  });

  it('is idempotent: an already-healthy node returns 200 without attempting an UPDATE', async () => {
    const db = makeFakeDb({
      nodeLookup: [nodeRow({ status: 'healthy' })],
    });
    mockDb.from = db.from;

    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME);
    const res = await POST(req, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ node: NODE_NAME, status: 'healthy' });
    expect(db.updateCalls).toHaveLength(0);
  });

  it('returns 404 for an unknown node', async () => {
    mockDb.from = makeFakeDb({ nodeLookup: [{ data: null, error: null }] }).from;

    const POST = await loadRoute();
    const { req, params } = requestFor('no-such-node');
    const res = await POST(req, { params });

    expect(res.status).toBe(404);
  });

  it('returns 409 for a retired node — a one-way door, never reversed', async () => {
    mockDb.from = makeFakeDb({ nodeLookup: [nodeRow({ status: 'retired' })] }).from;

    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME);
    const res = await POST(req, { params });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('node_retired');
  });

  it('returns 409 when the node is in maintenance_mode', async () => {
    mockDb.from = makeFakeDb({ nodeLookup: [nodeRow({ maintenance_mode: true })] }).from;

    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME);
    const res = await POST(req, { params });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('node_in_maintenance');
  });

  it('returns 409 when the node has zero active (non-revoked) credentials', async () => {
    mockDb.from = makeFakeDb({
      nodeLookup: [nodeRow()],
      credentialLookup: [{ data: [], error: null }],
    }).from;

    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME);
    const res = await POST(req, { params });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('no_active_credential');
  });

  it('returns 409 node_retired when a concurrent retirement lands between the read and the guarded UPDATE', async () => {
    mockDb.from = makeFakeDb({
      nodeLookup: [nodeRow({ status: 'provisioning' })],
      credentialLookup: [oneActiveCredential()],
      update: [{ data: [], error: null }],
    }).from;

    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME);
    const res = await POST(req, { params });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('node_retired');
  });

  it('fails closed (401) when MEDIA_NODE_PROVISIONING_SECRET is unset, without touching the database', async () => {
    delete process.env.MEDIA_NODE_PROVISIONING_SECRET;
    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME);
    const res = await POST(req, { params });

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('fails closed (401) when the presented secret is wrong', async () => {
    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME, 'wrong-secret');
    const res = await POST(req, { params });

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('fails closed (401) when no Authorization header is present', async () => {
    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME, null);
    const res = await POST(req, { params });

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('never leaks the provisioning secret or an internal error message into the response', async () => {
    mockDb.from = makeFakeDb({
      nodeLookup: [{ data: null, error: { message: 'connection reset to 10.0.0.5' } }],
    }).from;

    const POST = await loadRoute();
    const { req, params } = requestFor(NODE_NAME);
    const res = await POST(req, { params });
    const serialized = JSON.stringify(await res.json());

    expect(res.status).toBe(500);
    expect(serialized).not.toContain(PROVISIONING_SECRET);
    expect(serialized).not.toContain('connection reset to 10.0.0.5');
  });
});

describe('Middleware — mark-healthy studio-JWT bypass', () => {
  async function loadMiddleware() {
    const mod = await import('@/middleware');
    return mod.middleware;
  }

  it('bypasses studio-JWT auth for the exact mark-healthy path', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local/internal/media/nodes/${NODE_NAME}/mark-healthy`);
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('bypasses with an optional trailing slash', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local/internal/media/nodes/${NODE_NAME}/mark-healthy/`);
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it.each([
    `/internal/media/nodes/${NODE_NAME}/mark-healthy/extra`,
    `/internal/media/nodes/${NODE_NAME}mark-healthy`,
  ])('does NOT bypass near-miss path %s — falls through to normal studio-JWT auth', async (p) => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local${p}`);
    const res = await middleware(req);

    expect(res.status).toBe(401);
  });

  it('does not bypass the sibling credentials path (unaffected by this change)', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local/internal/media/nodes/${NODE_NAME}/credentials`);
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });
});
