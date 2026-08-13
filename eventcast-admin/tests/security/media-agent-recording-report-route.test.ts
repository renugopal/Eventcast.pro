import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nodeHasEventActivation } from '@/lib/media-agent/nodeAssignmentsRepo';

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
const FOREIGN_NODE_UUID = '22222222-2222-2222-2222-222222222222';
const EVENT_ID = '33333333-3333-3333-3333-333333333333';
const REQUEST_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
// Generated per request rather than pinned: the route validates the
// timestamp against real `now` within a 5-minute tolerance, so a fixed
// literal would make these tests fail purely with the passage of time.
const currentTimestamp = () => new Date().toISOString();
const GENERATION = 'gen-aaa';

interface FakeResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

/**
 * Per-table queued results. `activations` drives the event↔node
 * authorization lookup, and its data is a ROW SET (the lookup is an
 * existence check over an append-only table, not a single-row read); an
 * empty array means "this node has no activation history for this event".
 */
function makeFakeDb(tables: Record<string, { select?: FakeResult[]; insert?: FakeResult[] }>) {
  const queues = new Map(
    Object.entries(tables).map(([k, v]) => [k, { select: [...(v.select ?? [])], insert: [...(v.insert ?? [])] }])
  );
  const touched: string[] = [];
  // Exposed so a test can assert HOW a table was queried, not just what came
  // back — the fake cannot emulate PostgREST's own multi-row error, so the
  // query shape is what pins the append-only existence-check contract.
  const builders: Record<string, ReturnType<typeof vi.fn>>[] = [];

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

    builders.push(builder as unknown as Record<string, ReturnType<typeof vi.fn>>);

    return {
      select: vi.fn(() => builder),
      insert: vi.fn(() => {
        const result = queue.insert.shift();
        if (!result) throw new Error(`FakeDb: no more insert() results for '${table}'`);
        return Promise.resolve(result);
      }),
    };
  });

  return { from, touched, builders };
}

interface FakeTableApi {
  select: (...args: unknown[]) => unknown;
  insert: (...args: unknown[]) => unknown;
}

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    rpc: vi.fn(async () => ({ data: null, error: null }) as { data: unknown; error: unknown }),
    from: vi.fn((table: string): FakeTableApi => {
      throw new Error(`mockDb.from not configured for '${table}'`);
    }),
  },
}));

vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

/**
 * The rate-limit check legitimately goes through the same rpc() surface, so
 * 'the transition never ran' must be asserted on the specific function name
 * rather than on rpc() being untouched.
 */
function transitionCalls(): unknown[][] {
  return (mockDb.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
    (c) => c[0] === 'apply_event_recording_transition'
  );
}

async function loadRoute() {
  const mod = await import('@/app/internal/media/nodes/[node_id]/recordings/[event_id]/route');
  return mod.POST;
}

interface Overrides {
  authorization?: string | null;
  nodeIdHeader?: string | null;
  requestId?: string | null;
  timestamp?: string | null;
  pathNodeId?: string;
  body?: unknown;
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

  const body =
    overrides.body !== undefined
      ? overrides.body
      : {
          state: 'b2_finalized',
          finalization_generation: GENERATION,
          b2_object_key: `events/${EVENT_ID}/vod/${GENERATION}.m3u8`,
          b2_bucket: 'eventcast-vod-prod',
          gap_count: 0,
          gap_status: 'none',
          strong_integrity_verified: false,
          covered_playback_ids: ['pb-1'],
        };

  return {
    req: new Request(`https://admin.test/internal/media/nodes/${NODE_NAME}/recordings/${EVENT_ID}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ node_id: overrides.pathNodeId ?? NODE_NAME, event_id: EVENT_ID }),
  };
}

/** Standard happy-path table wiring: known node, valid credential, rate-limit ok, nonce claimed. */
async function wireDb(options: { activation?: FakeResult } = {}) {
  const digest = await computeDigest(PEPPER, TOKEN_SLOT_1);
  const fake = makeFakeDb({
    media_nodes: { select: [{ data: { id: NODE_UUID, config_version: '7' }, error: null }] },
    media_node_credentials: { select: [{ data: [{ slot: 1, digest }], error: null }] },
    media_node_rate_limits: { select: [{ data: null, error: null }], insert: [{ error: null }] },
    media_node_request_nonces: { insert: [{ error: null }] },
    media_event_assignment_activations: {
      select: [options.activation ?? { data: [{ id: 'activation-1' }], error: null }],
    },
  });
  mockDb.from = fake.from as unknown as typeof mockDb.from;
  return fake;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.MEDIA_NODE_TOKEN_PEPPER = PEPPER;
  mockDb.rpc = vi.fn(async () => ({
    data: {
      recording_state: 'b2_finalized',
      finalization_generation: GENERATION,
      integrity_verified_at: null,
    },
    error: null,
  })) as unknown as typeof mockDb.rpc;
});

afterEach(() => {
  delete process.env.MEDIA_NODE_TOKEN_PEPPER;
});

describe('POST /internal/media/nodes/{node_id}/recordings/{event_id}', () => {
  it('accepts a report from the node that produced the recording', async () => {
    await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest();

    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    expect(mockDb.rpc).toHaveBeenCalledWith('apply_event_recording_transition', expect.anything());
  });

  it('rejects an unauthenticated request before any database access', async () => {
    const fake = await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest({ authorization: null });

    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    expect(fake.touched).toHaveLength(0);
    expect(transitionCalls()).toHaveLength(0);
  });

  it('rejects a wrong credential and never reaches the transition RPC', async () => {
    await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest({ authorization: `Bearer ${TOKEN_WRONG}` });

    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    expect(transitionCalls()).toHaveLength(0);
  });

  it('rejects a path/header node-id mismatch', async () => {
    await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest({ pathNodeId: 'some-other-node' });

    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    expect(transitionCalls()).toHaveLength(0);
  });

  it('rejects a replayed request id', async () => {
    const digest = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const fake = makeFakeDb({
      media_nodes: { select: [{ data: { id: NODE_UUID, config_version: '7' }, error: null }] },
      media_node_credentials: { select: [{ data: [{ slot: 1, digest }], error: null }] },
      media_node_rate_limits: { select: [{ data: null, error: null }], insert: [{ error: null }] },
      // Unique-violation on the nonce is the replay signal.
      media_node_request_nonces: { insert: [{ error: { message: 'duplicate', code: '23505' } }] },
      media_event_assignment_activations: { select: [{ data: [{ id: 'activation-1' }], error: null }] },
    });
    mockDb.from = fake.from as unknown as typeof mockDb.from;

    const POST = await loadRoute();
    const { req, params } = makeRequest();

    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    expect(transitionCalls()).toHaveLength(0);
  });

  // The core authorization property: a valid node credential proves WHICH
  // node is calling, not that it may speak for this event.
  it('rejects a foreign node that has no activation history for the event', async () => {
    await wireDb({ activation: { data: [], error: null } });
    const POST = await loadRoute();
    const { req, params } = makeRequest();

    const res = await POST(req, { params });
    expect(res.status).toBe(401);
    expect(transitionCalls()).toHaveLength(0);
  });

  it('rejects an event with no activation history at all', async () => {
    await wireDb({ activation: { data: [], error: null } });
    const POST = await loadRoute();
    const { req, params } = makeRequest();

    expect((await POST(req, { params })).status).toBe(401);
    expect(transitionCalls()).toHaveLength(0);
  });

  it('fails closed when the activation lookup itself errors', async () => {
    await wireDb({ activation: { data: null, error: { message: 'db down' } } });
    const POST = await loadRoute();
    const { req, params } = makeRequest();

    expect((await POST(req, { params })).status).toBe(401);
    expect(transitionCalls()).toHaveLength(0);
  });

  // A node id in the payload must be inert: the provenance gate is driven
  // solely by the authenticated identity resolved server-side.
  it('ignores any node id supplied in the request body', async () => {
    await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest({
      body: {
        state: 'b2_finalized',
        finalization_generation: GENERATION,
        b2_object_key: 'k',
        b2_bucket: 'b',
        gap_count: 0,
        gap_status: 'none',
        covered_playback_ids: ['pb-1'],
        // Attempted spoof of a different producing node.
        p_reporting_media_node_id: FOREIGN_NODE_UUID,
        reporting_media_node_id: FOREIGN_NODE_UUID,
        media_node_id: FOREIGN_NODE_UUID,
      },
    });

    const res = await POST(req, { params });
    expect(res.status).toBe(200);

    const args = transitionCalls()[0][1] as Record<string, unknown>;
    expect(args.p_reporting_media_node_id).toBe(NODE_UUID);
    expect(args.p_reporting_media_node_id).not.toBe(FOREIGN_NODE_UUID);
  });

  it('rejects a malformed body and an unknown state without calling the RPC', async () => {
    await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest({ body: { state: 'totally_made_up' } });

    expect((await POST(req, { params })).status).toBe(400);
    expect(transitionCalls()).toHaveLength(0);
  });

  it('rejects an out-of-range gap_count without calling the RPC', async () => {
    await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest({
      body: { state: 'b2_finalized', finalization_generation: GENERATION, gap_count: -1, gap_status: 'none' },
    });

    expect((await POST(req, { params })).status).toBe(400);
    expect(transitionCalls()).toHaveLength(0);
  });

  it('surfaces a rejected transition as a conflict rather than silently succeeding', async () => {
    await wireDb();
    // Only the transition is rejected; the rate-limit check must still
    // succeed, or the request would fail earlier for an unrelated reason.
    mockDb.rpc = vi.fn(async (fn: string) => {
      if (fn === 'apply_event_recording_transition') {
        return { data: null, error: { message: 'gap_count must be supplied explicitly' } };
      }
      return { data: true, error: null };
    }) as unknown as typeof mockDb.rpc;

    const POST = await loadRoute();
    const { req, params } = makeRequest();

    expect((await POST(req, { params })).status).toBe(409);
  });

  // Retention may only freeze once the recording genuinely holds verified
  // integrity, which this package deliberately never reaches.
  it('does not freeze retention for an archived-but-unverified recording', async () => {
    await wireDb();
    const POST = await loadRoute();
    const { req, params } = makeRequest();

    await POST(req, { params });

    const calls = (mockDb.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls).toContain('apply_event_recording_transition');
    expect(calls).not.toContain('freeze_event_retention');
  });

  // Regression: `media_event_assignment_activations` is append-only with one
  // row per activation, so the legitimate producing node accumulates several
  // rows for one event after a deactivate/reactivate cycle. Treating that as
  // a single-row read made the lookup error out and permanently 401 exactly
  // the reactivated events the table exists to handle.
  it('accepts the authenticated node when it has several historical activation rows', async () => {
    await wireDb({
      activation: { data: [{ id: 'activation-1' }, { id: 'activation-2' }], error: null },
    });
    const POST = await loadRoute();
    const { req, params } = makeRequest();

    const res = await POST(req, { params });
    expect(res.status).toBe(200);
    expect(transitionCalls()).toHaveLength(1);
  });

  it('freezes retention only once integrity is verified', async () => {
    await wireDb();
    mockDb.rpc = vi.fn(async (fn: string) => {
      if (fn === 'apply_event_recording_transition') {
        return {
          data: {
            recording_state: 'b2_finalized',
            finalization_generation: GENERATION,
            integrity_verified_at: '2026-08-13T00:00:00Z',
          },
          error: null,
        };
      }
      return { data: null, error: null };
    }) as unknown as typeof mockDb.rpc;

    const POST = await loadRoute();
    const { req, params } = makeRequest();
    await POST(req, { params });

    const calls = (mockDb.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(calls).toContain('freeze_event_retention');
  });
});

/**
 * The authorization primitive the route above depends on. Exercised directly
 * so the append-only multi-row property is pinned at the helper itself, not
 * only through the HTTP surface.
 */
describe('nodeHasEventActivation', () => {
  function withActivations(result: FakeResult) {
    const fake = makeFakeDb({ media_event_assignment_activations: { select: [result] } });
    return { db: { from: fake.from }, fake };
  }

  it('denies when the node has no activation row for the event', async () => {
    const { db } = withActivations({ data: [], error: null });
    expect(await nodeHasEventActivation(db, EVENT_ID, NODE_UUID)).toBe('not_authorized');
  });

  it('authorizes on a single activation row', async () => {
    const { db } = withActivations({ data: [{ id: 'activation-1' }], error: null });
    expect(await nodeHasEventActivation(db, EVENT_ID, NODE_UUID)).toBe('authorized');
  });

  // The reactivation case: repeated same-node activations are valid, intended
  // evidence and must authorize, never error.
  it('authorizes when the same node has multiple activation rows for one event', async () => {
    const { db } = withActivations({
      data: [{ id: 'activation-1' }, { id: 'activation-2' }, { id: 'activation-3' }],
      error: null,
    });
    expect(await nodeHasEventActivation(db, EVENT_ID, NODE_UUID)).toBe('authorized');
  });

  // Guards the actual defect: `.maybeSingle()` makes PostgREST raise on >1
  // row, so the lookup must be a bounded existence check instead. The fake
  // cannot reproduce that server-side error, so the query shape is asserted.
  it('queries as a bounded existence check, never as a single-row read', async () => {
    const { db, fake } = withActivations({ data: [{ id: 'activation-1' }], error: null });
    await nodeHasEventActivation(db, EVENT_ID, NODE_UUID);

    const builder = fake.builders[0];
    expect(builder.limit).toHaveBeenCalledWith(1);
    expect(builder.maybeSingle).not.toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith('event_id', EVENT_ID);
    expect(builder.eq).toHaveBeenCalledWith('media_node_id', NODE_UUID);
  });

  it('fails closed on a query error rather than authorizing', async () => {
    const { db } = withActivations({ data: null, error: { message: 'db down' } });
    expect(await nodeHasEventActivation(db, EVENT_ID, NODE_UUID)).toBe('error');
  });

  it('fails closed on an unexpected non-row-set response shape', async () => {
    const { db } = withActivations({ data: { id: 'not-an-array' }, error: null });
    expect(await nodeHasEventActivation(db, EVENT_ID, NODE_UUID)).toBe('not_authorized');
  });
});
