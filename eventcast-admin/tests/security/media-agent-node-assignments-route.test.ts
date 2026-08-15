import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  DECOY_MEDIA_NODE_ID,
  MEDIA_EVENT_ASSIGNMENTS_SELECT_COLUMNS,
  MEDIA_NODE_CREDENTIALS_SELECT_COLUMNS,
  MEDIA_NODE_SELECT_COLUMNS,
} from '@/lib/media-agent/nodeAssignmentsRepo';

// ── Deterministic, fake test-only fixtures. No production-like secrets. ────
const PEPPER = 'unit-test-pepper-fixture';
const TOKEN_SLOT_1 = 'unit-test-token-slot-1';
const TOKEN_SLOT_2 = 'unit-test-token-slot-2';
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
const OTHER_NODE_UUID = '22222222-2222-2222-2222-222222222222';
const REQUEST_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'; // exactly 32 lowercase hex
const TIMESTAMP = '2026-07-15T10:00:00.000Z';
const TOLERANCE_MS = 5 * 60 * 1000;
const VALID_HASH = 'a'.repeat(64);

// ── Local, hand-rolled query-builder mock ───────────────────────────────────
// Deliberately NOT the shared `tests/security/support/mocks.ts` helper: this
// suite asserts exact query shape (select columns, eq/is filters, insert
// payload, and call ordering across from()/rpc()), which needs an `.is()`
// method and per-call introspection the shared generic builder doesn't
// expose. Extending the shared file is outside this correction pass's
// authorized changes, so this stays local to this test file.
interface FakeResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

interface RecordedCall {
  table: string;
  selectArgs: unknown[][];
  eqArgs: unknown[][];
  isArgs: unknown[][];
  insertArgs: unknown[][];
}

function makeFakeDb(tables: Record<string, { select?: FakeResult[]; insert?: FakeResult[] }>) {
  const queues = new Map(
    Object.entries(tables).map(([k, v]) => [
      k,
      { select: [...(v.select ?? [])], insert: [...(v.insert ?? [])] },
    ])
  );
  const recordedCalls: RecordedCall[] = [];

  const from = vi.fn((table: string) => {
    const queue = queues.get(table);
    if (!queue) {
      throw new Error(`FakeDb: no config for table '${table}' in this test`);
    }

    const record: RecordedCall = { table, selectArgs: [], eqArgs: [], isArgs: [], insertArgs: [] };
    recordedCalls.push(record);

    const select = vi.fn((...args: unknown[]) => {
      record.selectArgs.push(args);
      const builder = {
        eq: vi.fn((...eqArgsInner: unknown[]) => {
          record.eqArgs.push(eqArgsInner);
          return builder;
        }),
        is: vi.fn((...isArgsInner: unknown[]) => {
          record.isArgs.push(isArgsInner);
          return builder;
        }),
        maybeSingle: vi.fn(async () => {
          const result = queue.select.shift();
          if (!result) throw new Error(`FakeDb: no more select() results queued for '${table}'`);
          return result;
        }),
        then: (onfulfilled: (v: FakeResult) => unknown, onrejected?: (r: unknown) => unknown) => {
          const result = queue.select.shift();
          if (!result) throw new Error(`FakeDb: no more select() results queued for '${table}'`);
          return Promise.resolve(result).then(onfulfilled, onrejected);
        },
      };
      return builder;
    });

    const insert = vi.fn((...args: unknown[]) => {
      record.insertArgs.push(args);
      const result = queue.insert.shift();
      if (!result) throw new Error(`FakeDb: no more insert() results queued for '${table}'`);
      return Promise.resolve(result);
    });

    return { select, insert };
  });

  return { from, recordedCalls };
}

function callFor(recordedCalls: RecordedCall[], table: string): RecordedCall {
  const matches = recordedCalls.filter((c) => c.table === table);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one call to '${table}', got ${matches.length}`);
  }
  return matches[0];
}

function callsFor(recordedCalls: RecordedCall[], table: string): RecordedCall[] {
  return recordedCalls.filter((c) => c.table === table);
}

// Loose return-type contract for `.from(table)` — deliberately wider than
// any single test's concrete fake builder shape, so `mockDb.from` can be
// reassigned per-test to whatever `makeFakeDb(...).from` produces without a
// `never`-typed placeholder (from an un-annotated always-throwing function)
// rejecting every later assignment.
interface FakeTableApi {
  select: (...args: unknown[]) => unknown;
  insert: (...args: unknown[]) => unknown;
}

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    rpc: vi.fn(async () => ({ data: true, error: null }) as { data: unknown; error: unknown }),
    from: vi.fn((table: string): FakeTableApi => {
      throw new Error(`mockDb.from not configured for table '${table}' in this test`);
    }),
  },
}));

vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadRoute() {
  const mod = await import('@/app/internal/media/nodes/[node_id]/assignments/route');
  return mod.GET;
}

interface RequestOverrides {
  authorization?: string | null;
  nodeIdHeader?: string | null;
  requestId?: string | null;
  idempotencyKey?: string | null;
  timestamp?: string | null;
  pathNodeId?: string;
}

function makeRequest(overrides: RequestOverrides = {}): {
  req: Request;
  params: Promise<{ node_id: string }>;
} {
  const headers = new Headers();
  const authorization = overrides.authorization !== undefined ? overrides.authorization : `Bearer ${TOKEN_SLOT_1}`;
  const nodeIdHeader = overrides.nodeIdHeader !== undefined ? overrides.nodeIdHeader : NODE_NAME;
  const requestId = overrides.requestId !== undefined ? overrides.requestId : REQUEST_ID;
  const idempotencyKey = overrides.idempotencyKey !== undefined ? overrides.idempotencyKey : REQUEST_ID;
  const timestamp = overrides.timestamp !== undefined ? overrides.timestamp : TIMESTAMP;

  if (authorization !== null) headers.set('authorization', authorization);
  if (nodeIdHeader !== null) headers.set('x-eventcast-node-id', nodeIdHeader);
  if (requestId !== null) headers.set('x-eventcast-request-id', requestId);
  if (idempotencyKey !== null) headers.set('x-eventcast-idempotency-key', idempotencyKey);
  if (timestamp !== null) headers.set('x-eventcast-timestamp', timestamp);

  const pathNodeId = overrides.pathNodeId !== undefined ? overrides.pathNodeId : NODE_NAME;

  return {
    req: new Request(`http://test.local/internal/media/nodes/${pathNodeId}/assignments`, { headers }),
    params: Promise.resolve({ node_id: pathNodeId }),
  };
}

function nodeSelectResult(configVersion: string | null = '7'): FakeResult {
  return { data: { id: NODE_UUID, config_version: configVersion }, error: null };
}

function credentialSelectResult(rows: { slot: number; digest: string }[]): FakeResult {
  return { data: rows, error: null };
}

function assignmentRow(overrides: Record<string, unknown> = {}) {
  return {
    event_id: 'event-1',
    ingest_id: 'ingest-1',
    playback_id: 'pb-1',
    stream_secret_hash: VALID_HASH,
    enabled: true,
    publish_window_start_at: '2026-01-01T00:00:00Z',
    publish_window_end_at: '2026-01-01T04:00:00Z',
    config_version: 3,
    updated_at: '2026-01-01T00:00:00Z',
    youtube_enabled: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockDb.rpc.mockResolvedValue({ data: true, error: null });
  process.env.MEDIA_NODE_TOKEN_PEPPER = PEPPER;
  delete process.env.YOUTUBE_DESTINATION_BASE_URL;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(TIMESTAMP));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /internal/media/nodes/{node_id}/assignments', () => {
  it('returns the canonical assignment payload for a valid slot-1 request', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const { from, recordedCalls } = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('7')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
      media_node_request_nonces: { insert: [{ error: null }] },
      media_event_assignments: { select: [{ data: [assignmentRow()], error: null }] },
    });
    mockDb.from = from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      config_version: '7',
      generated_at: TIMESTAMP,
      assignments: [
        {
          ingest_id: 'ingest-1',
          event_id: 'event-1',
          playback_id: 'pb-1',
          stream_secret_hash: VALID_HASH,
          enabled: true,
          publish_window_start_at: '2026-01-01T00:00:00Z',
          publish_window_end_at: '2026-01-01T04:00:00Z',
          config_version: '3',
          updated_at: '2026-01-01T00:00:00Z',
          youtube_enabled: false,
          youtube_destination_base_url: '',
          youtube_stream_key: '',
        },
      ],
    });

    // ── Exact query-shape assertions ──────────────────────────────────────
    const nodeCall = callFor(recordedCalls, 'media_nodes');
    expect(nodeCall.selectArgs[0]).toEqual([MEDIA_NODE_SELECT_COLUMNS]);
    expect(nodeCall.eqArgs[0]).toEqual(['name', NODE_NAME]);

    const credCall = callFor(recordedCalls, 'media_node_credentials');
    expect(credCall.selectArgs[0]).toEqual([MEDIA_NODE_CREDENTIALS_SELECT_COLUMNS]);
    expect(credCall.eqArgs[0]).toEqual(['media_node_id', NODE_UUID]);
    expect(credCall.isArgs[0]).toEqual(['revoked_at', null]);

    const assignmentsCall = callFor(recordedCalls, 'media_event_assignments');
    expect(assignmentsCall.selectArgs[0]).toEqual([MEDIA_EVENT_ASSIGNMENTS_SELECT_COLUMNS]);
    expect(assignmentsCall.eqArgs).toEqual([
      ['assigned_media_node_id', NODE_UUID],
      ['enabled', true],
    ]);

    const nonceCall = callFor(recordedCalls, 'media_node_request_nonces');
    expect(nonceCall.insertArgs[0][0]).toEqual({
      media_node_id: NODE_UUID,
      request_id: REQUEST_ID,
      accepted_at: TIMESTAMP,
      expires_at: new Date(new Date(TIMESTAMP).getTime() + TOLERANCE_MS).toISOString(),
    });

    expect(mockDb.rpc).toHaveBeenCalledWith(
      'check_rate_limit',
      expect.objectContaining({ p_ip_hash: NODE_UUID, p_endpoint: 'media/nodes/assignments' })
    );
  });

  it('accepts a valid slot-2 credential', async () => {
    const digest2 = await computeDigest(PEPPER, TOKEN_SLOT_2);
    mockDb.from = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 2, digest: digest2 }])] },
      media_node_request_nonces: { insert: [{ error: null }] },
      media_event_assignments: { select: [{ data: [], error: null }] },
    }).from;

    const GET = await loadRoute();
    const { req, params } = makeRequest({ authorization: `Bearer ${TOKEN_SLOT_2}` });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
  });

  it('returns an empty successful response when the node has no assignments', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    mockDb.from = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
      media_node_request_nonces: { insert: [{ error: null }] },
      media_event_assignments: { select: [{ data: [], error: null }] },
    }).from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.assignments).toEqual([]);
  });

  it('rejects a path / header node-id mismatch before any database access', async () => {
    const GET = await loadRoute();
    const { req, params } = makeRequest({ pathNodeId: 'a-different-node' });
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it.each([
    ['authorization', { authorization: null }],
    ['node id header', { nodeIdHeader: null }],
    ['request id', { requestId: null, idempotencyKey: null }],
    ['idempotency key', { idempotencyKey: null }],
    ['timestamp', { timestamp: null }],
  ])('rejects a missing %s header before any database access', async (_label, overrides) => {
    const GET = await loadRoute();
    const { req, params } = makeRequest(overrides as RequestOverrides);
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a malformed request id before any database access', async () => {
    const GET = await loadRoute();
    const { req, params } = makeRequest({ requestId: 'too-short', idempotencyKey: 'too-short' });
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a timestamp 1ms past the expiry boundary', async () => {
    const expired = new Date(new Date(TIMESTAMP).getTime() - TOLERANCE_MS - 1).toISOString();
    const GET = await loadRoute();
    const { req, params } = makeRequest({ timestamp: expired });
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a timestamp 1ms past the future-skew boundary', async () => {
    const future = new Date(new Date(TIMESTAMP).getTime() + TOLERANCE_MS + 1).toISOString();
    const GET = await loadRoute();
    const { req, params } = makeRequest({ timestamp: future });
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('accepts a timestamp exactly at the lower and upper tolerance boundary', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const lower = new Date(new Date(TIMESTAMP).getTime() - TOLERANCE_MS).toISOString();
    const upper = new Date(new Date(TIMESTAMP).getTime() + TOLERANCE_MS).toISOString();

    for (const ts of [lower, upper]) {
      mockDb.from = makeFakeDb({
        media_nodes: { select: [nodeSelectResult('1')] },
        media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
        media_node_request_nonces: { insert: [{ error: null }] },
        media_event_assignments: { select: [{ data: [], error: null }] },
      }).from;
      const GET = await loadRoute();
      const { req, params } = makeRequest({
        timestamp: ts,
        requestId: ts === lower ? REQUEST_ID : 'b'.repeat(32),
        idempotencyKey: ts === lower ? REQUEST_ID : 'b'.repeat(32),
      });
      const res = await GET(req, { params });
      expect(res.status).toBe(200);
    }
  });

  it('rejects the wrong token against real active digests', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const digest2 = await computeDigest(PEPPER, TOKEN_SLOT_2);
    mockDb.from = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: {
        select: [credentialSelectResult([{ slot: 1, digest: digest1 }, { slot: 2, digest: digest2 }])],
      },
    }).from;

    const GET = await loadRoute();
    const { req, params } = makeRequest({ authorization: `Bearer ${TOKEN_WRONG}` });
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects an unknown node without revealing non-existence, but still queries credentials using the fixed decoy UUID', async () => {
    const { from, recordedCalls } = makeFakeDb({
      media_nodes: { select: [{ data: null, error: null }] },
      media_node_credentials: { select: [credentialSelectResult([])] },
    });
    mockDb.from = from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });

    // The credential query still ran once, scoped to the fixed decoy UUID —
    // an unknown node must not skip this database round trip.
    const credCall = callFor(recordedCalls, 'media_node_credentials');
    expect(credCall.eqArgs[0]).toEqual(['media_node_id', DECOY_MEDIA_NODE_ID]);
    expect(credCall.isArgs[0]).toEqual(['revoked_at', null]);
  });

  it('runs exactly one credential query for both a known node and an unknown node', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);

    const known = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
      media_node_request_nonces: { insert: [{ error: null }] },
      media_event_assignments: { select: [{ data: [], error: null }] },
    });
    mockDb.from = known.from;
    const GET1 = await loadRoute();
    const r1 = makeRequest();
    await GET1(r1.req, { params: r1.params });
    expect(callsFor(known.recordedCalls, 'media_node_credentials')).toHaveLength(1);

    vi.resetModules();
    const unknown = makeFakeDb({
      media_nodes: { select: [{ data: null, error: null }] },
      media_node_credentials: { select: [credentialSelectResult([])] },
    });
    mockDb.from = unknown.from;
    const GET2 = await loadRoute();
    const r2 = makeRequest();
    await GET2(r2.req, { params: r2.params });
    expect(callsFor(unknown.recordedCalls, 'media_node_credentials')).toHaveLength(1);
  });

  it('rejects a revoked credential (excluded by the revoked_at IS NULL filter)', async () => {
    // A revoked digest is excluded at the query level, so the fake DB never
    // returns it — modeling that the real `.is('revoked_at', null)` filter
    // would have excluded this row.
    mockDb.from = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([])] },
    }).from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
  });

  it('rejects a replayed request id via nonce UNIQUE conflict', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    mockDb.from = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
      media_node_request_nonces: {
        insert: [{ error: { message: 'duplicate key value violates unique constraint', code: '23505' } }],
      },
    }).from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects on a credential lookup / database failure', async () => {
    mockDb.from = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [{ data: null, error: { message: 'connection reset' } }] },
    }).from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain('connection reset');
  });

  it('rejects on an assignment lookup / database failure without leaking the error, and the nonce stays consumed', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const { from, recordedCalls } = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
      media_node_request_nonces: { insert: [{ error: null }] },
      media_event_assignments: { select: [{ data: null, error: { message: 'relation missing' } }] },
    });
    mockDb.from = from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'unauthorized' });
    expect(JSON.stringify(body)).not.toContain('relation missing');
    // Nonce claim already happened (and succeeded) before assignment loading
    // failed — replay protection must not be undone by a downstream error.
    expect(callFor(recordedCalls, 'media_node_request_nonces').insertArgs).toHaveLength(1);
  });

  it('fails closed with a generic 401 when MEDIA_NODE_TOKEN_PEPPER is missing', async () => {
    delete process.env.MEDIA_NODE_TOKEN_PEPPER;
    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('never leaks a digest, token, pepper, or internal error into any response', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    mockDb.from = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
      media_node_request_nonces: { insert: [{ error: null }] },
      media_event_assignments: { select: [{ data: [], error: null }] },
    }).from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });
    const serialized = JSON.stringify(await res.json());

    expect(serialized).not.toContain(PEPPER);
    expect(serialized).not.toContain(digest1);
    expect(serialized).not.toContain(TOKEN_SLOT_1);
  });

  it("never returns another node's assignments — the assignment query is scoped to the authenticated node's own UUID", async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const { from, recordedCalls } = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
      media_node_request_nonces: { insert: [{ error: null }] },
      media_event_assignments: { select: [{ data: [], error: null }] },
    });
    mockDb.from = from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    await GET(req, { params });

    const assignmentsCall = callFor(recordedCalls, 'media_event_assignments');
    expect(assignmentsCall.eqArgs).toContainEqual(['assigned_media_node_id', NODE_UUID]);
    expect(assignmentsCall.eqArgs).not.toContainEqual(['assigned_media_node_id', OTHER_NODE_UUID]);
  });

  it('disabled assignments cannot be returned — the query filters enabled = true', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const { from, recordedCalls } = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
      media_node_request_nonces: { insert: [{ error: null }] },
      media_event_assignments: { select: [{ data: [], error: null }] },
    });
    mockDb.from = from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    await GET(req, { params });

    const assignmentsCall = callFor(recordedCalls, 'media_event_assignments');
    expect(assignmentsCall.eqArgs).toContainEqual(['enabled', true]);
  });

  it('all authentication failures return identical status and body', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);

    const cases: Array<() => Promise<Response>> = [
      async () => {
        const GET = await loadRoute();
        const { req, params } = makeRequest({ authorization: null });
        return GET(req, { params });
      },
      async () => {
        const GET = await loadRoute();
        const { req, params } = makeRequest({ pathNodeId: 'wrong-path-node' });
        return GET(req, { params });
      },
      async () => {
        mockDb.from = makeFakeDb({
          media_nodes: { select: [{ data: null, error: null }] },
          media_node_credentials: { select: [credentialSelectResult([])] },
        }).from;
        const GET = await loadRoute();
        const { req, params } = makeRequest();
        return GET(req, { params });
      },
      async () => {
        mockDb.from = makeFakeDb({
          media_nodes: { select: [nodeSelectResult('1')] },
          media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
        }).from;
        const GET = await loadRoute();
        const { req, params } = makeRequest({ authorization: `Bearer ${TOKEN_WRONG}` });
        return GET(req, { params });
      },
    ];

    const results = await Promise.all(cases.map((c) => c()));
    for (const res of results) {
      expect(res.status).toBe(401);
    }
    const bodies = await Promise.all(results.map((r) => r.json()));
    for (const body of bodies) {
      expect(body).toEqual({ error: 'unauthorized' });
    }
  });
});

describe('GET /internal/media/nodes/{node_id}/assignments — strict node rate limiting', () => {
  it('calls the rate-limit RPC after credential verification and before the nonce insert, in that order', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const { from } = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
      media_node_request_nonces: { insert: [{ error: null }] },
      media_event_assignments: { select: [{ data: [], error: null }] },
    });
    mockDb.from = from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const credentialCallOrder = mockDb.from.mock.calls.findIndex((c) => c[0] === 'media_node_credentials');
    const rpcCallOrder = mockDb.rpc.mock.invocationCallOrder[0];
    const credentialInvocationOrder = mockDb.from.mock.invocationCallOrder[credentialCallOrder];
    const nonceCallIndex = mockDb.from.mock.calls.findIndex((c) => c[0] === 'media_node_request_nonces');
    const nonceInvocationOrder = mockDb.from.mock.invocationCallOrder[nonceCallIndex];

    expect(rpcCallOrder).toBeGreaterThan(credentialInvocationOrder);
    expect(rpcCallOrder).toBeLessThan(nonceInvocationOrder);
  });

  it('returns 429 and inserts no nonce when the rate limit RPC reports limited', async () => {
    mockDb.rpc.mockResolvedValue({ data: false, error: null });
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const { from, recordedCalls } = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
    });
    mockDb.from = from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });

    expect(res.status).toBe(429);
    expect(callsFor(recordedCalls, 'media_node_request_nonces')).toHaveLength(0);
  });

  it('fails closed (generic 401) and inserts no nonce when the rate limit RPC errors', async () => {
    mockDb.rpc.mockResolvedValue({ data: null, error: { message: 'rpc failure' } });
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const { from, recordedCalls } = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
    });
    mockDb.from = from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'unauthorized' });
    expect(JSON.stringify(body)).not.toContain('rpc failure');
    expect(callsFor(recordedCalls, 'media_node_request_nonces')).toHaveLength(0);
  });

  it('fails closed and inserts no nonce when the rate limit RPC throws', async () => {
    mockDb.rpc.mockRejectedValue(new Error('network down'));
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const { from, recordedCalls } = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
    });
    mockDb.from = from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    expect(callsFor(recordedCalls, 'media_node_request_nonces')).toHaveLength(0);
  });

  it('does not call the rate-limit RPC at all when credential verification fails', async () => {
    mockDb.from = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([])] },
    }).from;

    const GET = await loadRoute();
    const { req, params } = makeRequest({ authorization: `Bearer ${TOKEN_WRONG}` });
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });
});

describe('GET /internal/media/nodes/{node_id}/assignments — assignment payload validation', () => {
  it('returns generic 503 for an invalid (non-64-hex) stream_secret_hash, with no partial set', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    mockDb.from = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
      media_node_request_nonces: { insert: [{ error: null }] },
      media_event_assignments: {
        select: [
          {
            data: [
              assignmentRow({ ingest_id: 'good-1', stream_secret_hash: VALID_HASH }),
              assignmentRow({ ingest_id: 'bad-1', stream_secret_hash: 'NOT-VALID-HEX' }),
            ],
            error: null,
          },
        ],
      },
    }).from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ error: 'service_unavailable' });
    expect(JSON.stringify(body)).not.toContain('good-1');
    expect(JSON.stringify(body)).not.toContain('bad-1');
  });

  it('returns generic 503 for an uppercase-hex stream_secret_hash (must be strict lowercase)', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    mockDb.from = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
      media_node_request_nonces: { insert: [{ error: null }] },
      media_event_assignments: {
        select: [{ data: [assignmentRow({ stream_secret_hash: 'A'.repeat(64) })], error: null }],
      },
    }).from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'service_unavailable' });
  });

  it('returns generic 503 for any youtube_enabled=true assignment (no approved secret-store resolver exists yet)', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    process.env.YOUTUBE_DESTINATION_BASE_URL = 'rtmp://youtube.example/live2';
    mockDb.from = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
      media_node_request_nonces: { insert: [{ error: null }] },
      media_event_assignments: {
        select: [{ data: [assignmentRow({ youtube_enabled: true })], error: null }],
      },
    }).from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ error: 'service_unavailable' });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('youtube_secret_reference');
    expect(serialized).not.toContain('rtmp://youtube.example/live2');
  });

  it('never silently coerces youtube_enabled to false or serves a partial set', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    mockDb.from = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('1')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
      media_node_request_nonces: { insert: [{ error: null }] },
      media_event_assignments: {
        select: [
          {
            data: [
              assignmentRow({ ingest_id: 'normal-assignment', youtube_enabled: false }),
              assignmentRow({ ingest_id: 'youtube-assignment', youtube_enabled: true }),
            ],
            error: null,
          },
        ],
      },
    }).from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });
    const body = await res.json();

    // The whole request fails closed — the valid, non-YouTube assignment is
    // never served partially alongside the rejection of the other row.
    expect(res.status).toBe(503);
    expect(JSON.stringify(body)).not.toContain('normal-assignment');
    expect(JSON.stringify(body)).not.toContain('youtube-assignment');
  });

  it('still returns the canonical wire contract for normal non-YouTube assignments', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    mockDb.from = makeFakeDb({
      media_nodes: { select: [nodeSelectResult('9')] },
      media_node_credentials: { select: [credentialSelectResult([{ slot: 1, digest: digest1 }])] },
      media_node_request_nonces: { insert: [{ error: null }] },
      media_event_assignments: { select: [{ data: [assignmentRow()], error: null }] },
    }).from;

    const GET = await loadRoute();
    const { req, params } = makeRequest();
    const res = await GET(req, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['assignments', 'config_version', 'generated_at']);
    expect(Object.keys(body.assignments[0]).sort()).toEqual(
      [
        'config_version',
        'enabled',
        'event_id',
        'ingest_id',
        'playback_id',
        'publish_window_end_at',
        'publish_window_start_at',
        'stream_secret_hash',
        'updated_at',
        'youtube_destination_base_url',
        'youtube_enabled',
        'youtube_stream_key',
      ].sort()
    );
  });
});

describe('Media Agent assignments route — filesystem location contract', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');

  it('exists at the /internal route contract path (not /api)', () => {
    const expectedPath = path.join(
      repoRoot,
      'src',
      'app',
      'internal',
      'media',
      'nodes',
      '[node_id]',
      'assignments',
      'route.ts'
    );
    expect(existsSync(expectedPath)).toBe(true);
  });

  it('does not exist at the old, obsolete /api route path', () => {
    const obsoletePath = path.join(
      repoRoot,
      'src',
      'app',
      'api',
      'internal',
      'media',
      'nodes',
      '[node_id]',
      'assignments',
      'route.ts'
    );
    expect(existsSync(obsoletePath)).toBe(false);
  });
});

describe('Middleware — Media Agent assignments studio-JWT bypass', () => {
  async function loadMiddleware() {
    const mod = await import('@/middleware');
    return mod.middleware;
  }

  it('bypasses studio-JWT auth for the exact valid assignments path', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local/internal/media/nodes/${NODE_NAME}/assignments`);
    const res = await middleware(req);

    // A bypass returns NextResponse.next() (a plain pass-through, status
    // 200) without ever reaching the "no session token" branch below.
    expect(res.status).toBe(200);
  });

  it('bypasses with an optional trailing slash', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local/internal/media/nodes/${NODE_NAME}/assignments/`);
    const res = await middleware(req);

    expect(res.status).toBe(200);
  });

  it.each([
    `/internal/media/nodes/${NODE_NAME}/assignments/extra`,
    `/internal/media/nodes/${NODE_NAME}/other-action`,
    '/internal/media/other-resource',
    '/internal/media/nodes/bad%20node/assignments',
    '/internal/media/nodes//assignments',
    `/internal/media/nodes/${NODE_NAME}assignments`,
  ])('does NOT bypass near-miss / sibling / malformed path %s — falls through to normal studio-JWT auth', async (p) => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local${p}`);
    const res = await middleware(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized — no session token provided');
  });

  it('does not bypass an unrelated /api path (still requires studio JWT)', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest('http://test.local/api/media/assignment-status');
    const res = await middleware(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized — no session token provided');
  });
});
