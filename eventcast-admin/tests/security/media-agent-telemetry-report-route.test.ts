import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Deterministic, fake test-only fixtures. No production-like secrets. ────
const PEPPER = 'unit-test-pepper-fixture';
const TOKEN_SLOT_1 = 'unit-test-token-slot-1';
const TOKEN_WRONG = 'unit-test-token-wrong';

async function computeDigest(pepper: string, token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const NODE_NAME = 'gcp-asia-south1-01';
const NODE_UUID = '11111111-1111-1111-1111-111111111111';
const EVENT_ID = '33333333-3333-3333-3333-333333333333';
const SESSION_ID = 'sess_aaaabbbbccccdddd';
const REQUEST_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const currentTimestamp = () => new Date().toISOString();

interface FakeResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

/**
 * An `update` queue entry: a normal result, or `'throw'` to make awaiting
 * the update builder reject. Unqueued updates resolve `{ error: null }` —
 * the credential-evidence UPDATE is an explicitly supported operation.
 */
type FakeUpdateResult = FakeResult | 'throw';

interface RecordedUpdate {
  table: string;
  values: unknown;
  eqArgs: unknown[][];
  isArgs: unknown[][];
  orArgs: unknown[][];
}

function makeFakeDb(
  tables: Record<string, { select?: FakeResult[]; insert?: FakeResult[]; update?: FakeUpdateResult[] }>
) {
  const queues = new Map(
    Object.entries(tables).map(([k, v]) => [
      k,
      { select: [...(v.select ?? [])], insert: [...(v.insert ?? [])], update: [...(v.update ?? [])] },
    ])
  );
  const touched: string[] = [];
  const updates: RecordedUpdate[] = [];

  const from = vi.fn((table: string) => {
    touched.push(table);
    const queue = queues.get(table);
    if (!queue) throw new Error(`FakeDb: no config for table '${table}'`);

    const builder = {
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        const result = queue.select.shift();
        if (!result) throw new Error(`FakeDb: no more select() results for '${table}'`);
        return result;
      }),
      then: (onfulfilled: (v: FakeResult) => unknown, onrejected?: (r: unknown) => unknown) => {
        const result = queue.select.shift();
        if (!result) throw new Error(`FakeDb: no more select() results for '${table}'`);
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
    };

    return {
      select: vi.fn(() => builder),
      insert: vi.fn(() => {
        const result = queue.insert.shift();
        if (!result) throw new Error(`FakeDb: no more insert() results for '${table}'`);
        return Promise.resolve(result);
      }),
      update: vi.fn((values: unknown) => {
        const recorded: RecordedUpdate = { table, values, eqArgs: [], isArgs: [], orArgs: [] };
        updates.push(recorded);
        const updateBuilder = {
          eq: vi.fn((...args: unknown[]) => {
            recorded.eqArgs.push(args);
            return updateBuilder;
          }),
          is: vi.fn((...args: unknown[]) => {
            recorded.isArgs.push(args);
            return updateBuilder;
          }),
          or: vi.fn((...args: unknown[]) => {
            recorded.orArgs.push(args);
            return updateBuilder;
          }),
          then: (onfulfilled: (v: FakeResult) => unknown, onrejected?: (r: unknown) => unknown) => {
            const result = queue.update.shift() ?? { error: null };
            if (result === 'throw') {
              return Promise.reject(new Error('FakeDb: simulated update exception')).then(onfulfilled, onrejected);
            }
            return Promise.resolve(result).then(onfulfilled, onrejected);
          },
        };
        return updateBuilder;
      }),
    };
  });

  return { from, touched, updates };
}

interface FakeTableApi {
  select: (...args: unknown[]) => unknown;
  insert: (...args: unknown[]) => unknown;
  update?: (...args: unknown[]) => unknown;
}

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    rpc: vi.fn(async () => ({ data: [], error: null }) as { data: unknown; error: unknown }),
    from: vi.fn((table: string): FakeTableApi => {
      throw new Error(`mockDb.from not configured for '${table}'`);
    }),
  },
}));

vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

function reportCalls(): unknown[][] {
  return (mockDb.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
    (c) => c[0] === 'apply_media_stream_telemetry_report'
  );
}

async function loadRoute() {
  const mod = await import('@/app/internal/media/nodes/[node_id]/telemetry/route');
  return mod.POST;
}

interface Overrides {
  authorization?: string | null;
  nodeIdHeader?: string | null;
  requestId?: string | null;
  timestamp?: string | null;
  pathNodeId?: string;
  body?: unknown;
  rawBody?: string;
}

function makeRequest(overrides: Overrides = {}) {
  const headers = new Headers();
  const authorization = overrides.authorization !== undefined ? overrides.authorization : `Bearer ${TOKEN_SLOT_1}`;
  const nodeIdHeader = overrides.nodeIdHeader !== undefined ? overrides.nodeIdHeader : NODE_NAME;
  const requestId = overrides.requestId !== undefined ? overrides.requestId : REQUEST_ID;
  const timestamp = overrides.timestamp !== undefined ? overrides.timestamp : currentTimestamp();

  if (authorization !== null) headers.set('authorization', authorization);
  if (nodeIdHeader !== null) headers.set('x-eventcast-node-id', nodeIdHeader);
  if (requestId !== null) {
    headers.set('x-eventcast-request-id', requestId);
    headers.set('x-eventcast-idempotency-key', requestId);
  }
  if (timestamp !== null) headers.set('x-eventcast-timestamp', timestamp);
  headers.set('content-type', 'application/json');

  const defaultBody = {
    node: { disk_free_bytes: 123456, active_stream_count: 1 },
    streams: [{ event_id: EVENT_ID, sampled_at: currentTimestamp(), connected: true }],
    ended_sessions: [
      {
        event_id: EVENT_ID,
        session_id: SESSION_ID,
        started_at: currentTimestamp(),
        disconnected_at: currentTimestamp(),
        end_reason: 'unpublish',
        segment_count: 12,
        duration_seconds: 48,
      },
    ],
  };

  const rawBody = overrides.rawBody !== undefined ? overrides.rawBody : JSON.stringify(overrides.body !== undefined ? overrides.body : defaultBody);

  return {
    req: new Request(`https://admin.test/internal/media/nodes/${NODE_NAME}/telemetry`, {
      method: 'POST',
      headers,
      body: rawBody,
    }),
    params: Promise.resolve({ node_id: overrides.pathNodeId ?? NODE_NAME }),
  };
}

/** Standard happy-path table wiring: known node, valid credential, nonce claimed. */
async function wireDb() {
  const digest = await computeDigest(PEPPER, TOKEN_SLOT_1);
  const fake = makeFakeDb({
    media_nodes: { select: [{ data: { id: NODE_UUID, config_version: '7' }, error: null }] },
    media_node_credentials: { select: [{ data: [{ slot: 1, digest }], error: null }] },
    media_node_request_nonces: { insert: [{ error: null }] },
  });
  mockDb.from = fake.from as unknown as typeof mockDb.from;
  return fake;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.MEDIA_NODE_TOKEN_PEPPER = PEPPER;
  mockDb.rpc = vi.fn(async (fn: string) => {
    if (fn === 'check_rate_limit') return { data: true, error: null };
    if (fn === 'apply_media_stream_telemetry_report') return { data: [SESSION_ID], error: null };
    return { data: null, error: null };
  }) as unknown as typeof mockDb.rpc;
});

afterEach(() => {
  delete process.env.MEDIA_NODE_TOKEN_PEPPER;
});

describe('POST /internal/media/nodes/{node_id}/telemetry', () => {
  it('accepts a report from an authenticated node and echoes the accepted session ids', async () => {
    await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest();

    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { accepted_session_ids: string[] };
    expect(json.accepted_session_ids).toEqual([SESSION_ID]);
    expect(reportCalls()).toHaveLength(1);
  });

  it('always passes the AUTHENTICATED node id, never anything from the body, as p_reporting_media_node_id', async () => {
    await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest();

    await POST(req, { params });

    const args = reportCalls()[0][1] as Record<string, unknown>;
    expect(args.p_reporting_media_node_id).toBe(NODE_UUID);
  });

  it('passes optional node metrics as null when absent, never a fabricated 0', async () => {
    await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest({ body: { node: {}, streams: [], ended_sessions: [] } });

    await POST(req, { params });

    const args = reportCalls()[0][1] as Record<string, unknown>;
    expect(args.p_disk_free_bytes).toBeNull();
    expect(args.p_r2_queue_bytes).toBeNull();
    expect(args.p_software_version).toBeNull();
    expect(args.p_config_version).toBeNull();
    expect(args.p_active_stream_count).toBeNull();
  });

  it('rejects an unauthenticated request before any database access', async () => {
    const fake = await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest({ authorization: null });

    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    expect(fake.touched).toHaveLength(0);
    expect(reportCalls()).toHaveLength(0);
  });

  it('rejects a wrong credential and never reaches the RPC', async () => {
    await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest({ authorization: `Bearer ${TOKEN_WRONG}` });

    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    expect(reportCalls()).toHaveLength(0);
  });

  it('rejects a path/header node-id mismatch', async () => {
    await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest({ pathNodeId: 'some-other-node' });

    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    expect(reportCalls()).toHaveLength(0);
  });

  it('rejects a replayed request id', async () => {
    const digest = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const fake = makeFakeDb({
      media_nodes: { select: [{ data: { id: NODE_UUID, config_version: '7' }, error: null }] },
      media_node_credentials: { select: [{ data: [{ slot: 1, digest }], error: null }] },
      // Unique-violation on the nonce is the replay signal.
      media_node_request_nonces: { insert: [{ error: { message: 'duplicate', code: '23505' } }] },
    });
    mockDb.from = fake.from as unknown as typeof mockDb.from;

    const POST = await loadRoute();
    const { req, params } = makeRequest();

    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    expect(reportCalls()).toHaveLength(0);
  });

  it('rejects a rate-limited node', async () => {
    await wireDb();
    mockDb.rpc = vi.fn(async (fn: string) => {
      if (fn === 'check_rate_limit') return { data: false, error: null };
      return { data: null, error: null };
    }) as unknown as typeof mockDb.rpc;

    const POST = await loadRoute();
    const { req, params } = makeRequest();

    const res = await POST(req, { params });
    expect(res.status).toBe(429);
    expect(reportCalls()).toHaveLength(0);
  });

  it('rejects a malformed body (wrong shape) without calling the RPC', async () => {
    await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest({ body: { streams: 'not-an-array' } });

    const res = await POST(req, { params });
    expect(res.status).toBe(400);
    expect(reportCalls()).toHaveLength(0);
  });

  it('rejects unparseable JSON without calling the RPC', async () => {
    await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest({ rawBody: '{not json' });

    const res = await POST(req, { params });
    expect(res.status).toBe(400);
    expect(reportCalls()).toHaveLength(0);
  });

  it('rejects a request body exceeding the byte limit without calling the RPC', async () => {
    await wireDb();
    const POST = await loadRoute();
    // Comfortably over the route's 256 KiB bound.
    const oversized = JSON.stringify({
      node: {},
      streams: [],
      ended_sessions: [],
      padding: 'x'.repeat(300 * 1024),
    });
    const { req, params } = makeRequest({ rawBody: oversized });

    const res = await POST(req, { params });
    expect(res.status).toBe(400);
    expect(reportCalls()).toHaveLength(0);
  });

  it('surfaces an RPC error as a distinct rejected-report response, not a raw 500', async () => {
    await wireDb();
    mockDb.rpc = vi.fn(async (fn: string) => {
      if (fn === 'check_rate_limit') return { data: true, error: null };
      if (fn === 'apply_media_stream_telemetry_report') {
        return { data: null, error: { message: 'unknown reporting media node' } };
      }
      return { data: null, error: null };
    }) as unknown as typeof mockDb.rpc;

    const POST = await loadRoute();
    const { req, params } = makeRequest();

    const res = await POST(req, { params });
    expect(res.status).toBe(409);
  });

  it('an empty streams/ended_sessions report (idle node heartbeat only) still reaches the RPC', async () => {
    await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest({
      body: { node: { active_stream_count: 0 }, streams: [], ended_sessions: [] },
    });

    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    expect(reportCalls()).toHaveLength(1);
    const args = reportCalls()[0][1] as Record<string, unknown>;
    expect(args.p_active_stream_count).toBe(0);
    expect(args.p_streams).toEqual([]);
    expect(args.p_ended_sessions).toEqual([]);
  });
});

// ── Server-only slot-verification evidence (migration 0041) ────────────────
describe('POST /internal/media/nodes/{node_id}/telemetry — credential slot evidence', () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString();

  async function wireEvidenceDb(
    credRows: { slot: number; digest: string; last_verified_at?: string | null }[],
    options: { update?: FakeUpdateResult[]; nonceError?: FakeResult['error'] } = {}
  ) {
    const fake = makeFakeDb({
      media_nodes: { select: [{ data: { id: NODE_UUID, config_version: '7' }, error: null }] },
      media_node_credentials: { select: [{ data: credRows, error: null }], update: options.update },
      media_node_request_nonces: { insert: [{ error: options.nonceError ?? null }] },
    });
    mockDb.from = fake.from as unknown as typeof mockDb.from;
    return fake;
  }

  it('null evidence timestamp → one conditional evidence UPDATE scoped to the node, slot, and active rows', async () => {
    const digest = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const fake = await wireEvidenceDb([{ slot: 1, digest, last_verified_at: null }]);
    const POST = await loadRoute();
    const { req, params } = makeRequest();

    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    expect(fake.updates).toHaveLength(1);
    const update = fake.updates[0];
    expect(update.table).toBe('media_node_credentials');
    expect(Object.keys(update.values as Record<string, unknown>)).toEqual(['last_verified_at']);
    expect(update.eqArgs).toEqual([
      ['media_node_id', NODE_UUID],
      ['slot', 1],
    ]);
    expect(update.isArgs).toEqual([['revoked_at', null]]);
    expect(update.orArgs[0][0]).toMatch(/^last_verified_at\.is\.null,last_verified_at\.lte\."[^"]+"$/);
  });

  it('stale (>5 min) evidence timestamp → evidence UPDATE', async () => {
    const digest = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const fake = await wireEvidenceDb([{ slot: 1, digest, last_verified_at: minutesAgo(6) }]);
    const POST = await loadRoute();
    const { req, params } = makeRequest();

    expect((await POST(req, { params })).status).toBe(200);
    expect(fake.updates).toHaveLength(1);
  });

  it('recent (<5 min) evidence timestamp → no evidence UPDATE request at all', async () => {
    const digest = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const fake = await wireEvidenceDb([{ slot: 1, digest, last_verified_at: minutesAgo(1) }]);
    const POST = await loadRoute();
    const { req, params } = makeRequest();

    expect((await POST(req, { params })).status).toBe(200);
    expect(fake.updates).toHaveLength(0);
  });

  it('dual match (both slots hold the same digest) → authenticates normally, records no slot evidence', async () => {
    const digest = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const fake = await wireEvidenceDb([
      { slot: 1, digest, last_verified_at: null },
      { slot: 2, digest, last_verified_at: null },
    ]);
    const POST = await loadRoute();
    const { req, params } = makeRequest();

    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    expect(reportCalls()).toHaveLength(1);
    expect(fake.updates).toHaveLength(0);
  });

  it.each([
    ['missing authorization', { authorization: null }],
    ['wrong token', { authorization: `Bearer ${TOKEN_WRONG}` }],
    ['malformed request id', { requestId: 'too-short' }],
    ['path/header node-id mismatch', { pathNodeId: 'some-other-node' }],
  ])('%s → 401, no evidence write', async (_label, overrides) => {
    const digest = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const fake = await wireEvidenceDb([{ slot: 1, digest, last_verified_at: null }]);
    const POST = await loadRoute();
    const { req, params } = makeRequest(overrides as Overrides);

    expect((await POST(req, { params })).status).toBe(401);
    expect(fake.updates).toHaveLength(0);
  });

  it('unknown node → 401, no evidence write', async () => {
    const fake = makeFakeDb({
      media_nodes: { select: [{ data: null, error: null }] },
      media_node_credentials: { select: [{ data: [], error: null }] },
    });
    mockDb.from = fake.from as unknown as typeof mockDb.from;
    const POST = await loadRoute();
    const { req, params } = makeRequest();

    expect((await POST(req, { params })).status).toBe(401);
    expect(fake.updates).toHaveLength(0);
  });

  it('rate-limited node → 429, no evidence write', async () => {
    const digest = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const fake = await wireEvidenceDb([{ slot: 1, digest, last_verified_at: null }]);
    mockDb.rpc = vi.fn(async (fn: string) => {
      if (fn === 'check_rate_limit') return { data: false, error: null };
      return { data: null, error: null };
    }) as unknown as typeof mockDb.rpc;
    const POST = await loadRoute();
    const { req, params } = makeRequest();

    expect((await POST(req, { params })).status).toBe(429);
    expect(fake.updates).toHaveLength(0);
  });

  it('replayed request id (nonce conflict) → 401, no evidence write', async () => {
    const digest = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const fake = await wireEvidenceDb([{ slot: 1, digest, last_verified_at: null }], {
      nonceError: { message: 'duplicate', code: '23505' },
    });
    const POST = await loadRoute();
    const { req, params } = makeRequest();

    expect((await POST(req, { params })).status).toBe(401);
    expect(fake.updates).toHaveLength(0);
  });

  it.each([
    ['returns an error', { error: { message: 'evidence write failed' } } as FakeUpdateResult],
    ['throws', 'throw' as FakeUpdateResult],
  ])('evidence UPDATE that %s → response unchanged, secret-free warning only', async (_label, updateResult) => {
    const digest = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Baseline: the same request with a successful evidence write.
      const okFake = await wireEvidenceDb([{ slot: 1, digest, last_verified_at: null }]);
      const POST = await loadRoute();
      const ok = makeRequest();
      const okRes = await POST(ok.req, { params: ok.params });
      const okStatus = okRes.status;
      const okBody = await okRes.json();
      expect(okFake.updates).toHaveLength(1);
      expect(okStatus).toBe(200);
      expect(warnSpy).not.toHaveBeenCalled();
      const reportCallsBefore = reportCalls().length;

      // Failing evidence write: the response must be exactly identical.
      vi.resetModules();
      const fake = await wireEvidenceDb([{ slot: 1, digest, last_verified_at: null }], { update: [updateResult] });
      const POST2 = await loadRoute();
      const { req, params } = makeRequest();

      const res = await POST2(req, { params });
      expect(fake.updates).toHaveLength(1);
      expect(res.status).toBe(okStatus);
      expect(await res.json()).toEqual(okBody);
      expect(reportCalls()).toHaveLength(reportCallsBefore + 1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith('media-agent credential evidence write failed', { mediaNodeId: NODE_UUID });
      const logged = JSON.stringify(warnSpy.mock.calls);
      expect(logged).not.toContain(digest);
      expect(logged).not.toContain(TOKEN_SLOT_1);
      expect(logged).not.toMatch(/slot/i);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('downstream validation failure after auth + nonce claim → evidence still recorded, 400 unchanged', async () => {
    const digest = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const fake = await wireEvidenceDb([{ slot: 1, digest, last_verified_at: null }]);
    const POST = await loadRoute();
    const { req, params } = makeRequest({ body: { streams: 'not-an-array' } });

    const res = await POST(req, { params });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_report' });
    expect(reportCalls()).toHaveLength(0);
    expect(fake.updates).toHaveLength(1);
  });

  it('never exposes slot metadata or credential timestamps in the response', async () => {
    const digest = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const staleTs = minutesAgo(6);
    await wireEvidenceDb([{ slot: 1, digest, last_verified_at: staleTs }]);
    const POST = await loadRoute();
    const { req, params } = makeRequest();

    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    const serialized = JSON.stringify(await res.json());
    const headerDump = JSON.stringify([...res.headers.entries()]);
    for (const text of [serialized, headerDump]) {
      expect(text).not.toMatch(/slot/i);
      expect(text).not.toContain('last_verified_at');
      expect(text).not.toContain('uniquelyMatchedSlot');
      expect(text).not.toContain(staleTs);
    }
  });
});
