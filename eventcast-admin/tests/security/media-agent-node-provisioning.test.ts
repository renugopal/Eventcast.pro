import { describe, expect, it } from 'vitest';
import {
  computeCredentialDigest,
  generateRawCredentialToken,
  issueMediaNodeCredential,
  registerMediaNode,
  timingSafeEqual,
} from '@/lib/media-agent/nodeProvisioning';

const PEPPER = 'unit-test-pepper-fixture';
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

// ── Local, hand-rolled query-builder mock ───────────────────────────────────
// Deliberately local to this suite (not the shared route-level fake in
// media-agent-node-assignments-route.test.ts): this file only exercises
// `.insert(...).select(...).single()`, a narrower shape than that suite's
// select/eq/is builder.
interface FakeResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

function makeFakeDb(tables: Record<string, { insert?: FakeResult[] }>) {
  const queues = new Map(Object.entries(tables).map(([k, v]) => [k, { insert: [...(v.insert ?? [])] }]));
  const insertCalls: { table: string; values: Record<string, unknown> }[] = [];

  const from = (table: string) => {
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
    };
  };

  return { from, insertCalls };
}

describe('generateRawCredentialToken', () => {
  it('produces a 64-character lowercase hex string', () => {
    const token = generateRawCredentialToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces distinct values across calls', () => {
    const a = generateRawCredentialToken();
    const b = generateRawCredentialToken();
    expect(a).not.toBe(b);
  });
});

describe('timingSafeEqual', () => {
  it('returns true for identical strings', async () => {
    expect(await timingSafeEqual('same-value', 'same-value')).toBe(true);
  });

  it('returns false for different strings of the same length', async () => {
    expect(await timingSafeEqual('abcdefgh', 'abcdefgx')).toBe(false);
  });

  it('returns false for different strings of different lengths', async () => {
    expect(await timingSafeEqual('short', 'a-much-longer-value')).toBe(false);
  });

  it('returns true for two empty strings', async () => {
    expect(await timingSafeEqual('', '')).toBe(true);
  });

  it('returns false when only one side is empty', async () => {
    expect(await timingSafeEqual('', 'non-empty')).toBe(false);
  });
});

describe('computeCredentialDigest', () => {
  it('produces a digest matching the media_node_credentials.digest CHECK constraint shape', async () => {
    const digest = await computeCredentialDigest(PEPPER, 'some-raw-token');
    expect(digest).toMatch(DIGEST_PATTERN);
  });

  it('is deterministic for the same pepper and token', async () => {
    const d1 = await computeCredentialDigest(PEPPER, 'fixed-token');
    const d2 = await computeCredentialDigest(PEPPER, 'fixed-token');
    expect(d1).toBe(d2);
  });

  it('differs when the token differs', async () => {
    const d1 = await computeCredentialDigest(PEPPER, 'token-a');
    const d2 = await computeCredentialDigest(PEPPER, 'token-b');
    expect(d1).not.toBe(d2);
  });

  it('differs when the pepper differs', async () => {
    const d1 = await computeCredentialDigest('pepper-a', 'same-token');
    const d2 = await computeCredentialDigest('pepper-b', 'same-token');
    expect(d1).not.toBe(d2);
  });
});

describe('registerMediaNode', () => {
  it('inserts exactly the expected row shape and returns the registered node', async () => {
    const { from, insertCalls } = makeFakeDb({
      media_nodes: { insert: [{ data: { id: 'node-uuid-1', name: 'gcp-asia-south1-01' }, error: null }] },
    });

    const result = await registerMediaNode({ from }, {
      name: 'gcp-asia-south1-01',
      region: 'asia-south1',
      ingestHostname: 'ingest-asia-south1-01.eventcast.pro',
    });

    expect(result).toEqual({ outcome: 'registered', id: 'node-uuid-1', name: 'gcp-asia-south1-01' });
    expect(insertCalls).toEqual([
      {
        table: 'media_nodes',
        values: {
          name: 'gcp-asia-south1-01',
          region: 'asia-south1',
          ingest_hostname: 'ingest-asia-south1-01.eventcast.pro',
        },
      },
    ]);
  });

  it('includes hard_stream_limit only when explicitly provided', async () => {
    const { from, insertCalls } = makeFakeDb({
      media_nodes: { insert: [{ data: { id: 'node-uuid-2', name: 'node-2' }, error: null }] },
    });

    await registerMediaNode({ from }, {
      name: 'node-2',
      region: 'us-east1',
      ingestHostname: 'ingest-node-2.eventcast.pro',
      hardStreamLimit: 5,
    });

    expect(insertCalls[0].values).toMatchObject({ hard_stream_limit: 5 });
  });

  it('returns conflict on a unique_violation (23505)', async () => {
    const { from } = makeFakeDb({
      media_nodes: {
        insert: [{ data: null, error: { message: 'duplicate key value', code: '23505' } }],
      },
    });

    const result = await registerMediaNode({ from }, {
      name: 'dup-node',
      region: 'us-east1',
      ingestHostname: 'ingest-dup.eventcast.pro',
    });

    expect(result).toEqual({ outcome: 'conflict' });
  });

  it('returns error on any other database error, without leaking the message', async () => {
    const { from } = makeFakeDb({
      media_nodes: { insert: [{ data: null, error: { message: 'connection reset' } }] },
    });

    const result = await registerMediaNode({ from }, {
      name: 'node-3',
      region: 'us-east1',
      ingestHostname: 'ingest-node-3.eventcast.pro',
    });

    expect(result).toEqual({ outcome: 'error' });
  });

  it.each([
    ['empty region', { name: 'n', region: '  ', ingestHostname: 'h' }],
    ['empty ingest hostname', { name: 'n', region: 'r', ingestHostname: ' ' }],
    ['invalid name charset', { name: 'bad name!', region: 'r', ingestHostname: 'h' }],
    ['name too long', { name: 'a'.repeat(129), region: 'r', ingestHostname: 'h' }],
    ['non-positive hardStreamLimit', { name: 'n', region: 'r', ingestHostname: 'h', hardStreamLimit: 0 }],
    ['non-integer hardStreamLimit', { name: 'n', region: 'r', ingestHostname: 'h', hardStreamLimit: 1.5 }],
  ])('rejects invalid input (%s) before touching the database', async (_label, input) => {
    const result = await registerMediaNode({} as unknown, input as never);
    expect(result).toEqual({ outcome: 'invalid' });
  });
});

describe('issueMediaNodeCredential', () => {
  it('issues a credential, persists only the digest, and returns the raw token once', async () => {
    const { from, insertCalls } = makeFakeDb({
      media_node_credentials: { insert: [{ data: { id: 'cred-uuid-1' }, error: null }] },
    });

    const result = await issueMediaNodeCredential({ from }, PEPPER, 'node-uuid-1', 1);

    expect(result.outcome).toBe('issued');
    if (result.outcome !== 'issued') throw new Error('expected issued');
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0].table).toBe('media_node_credentials');
    const inserted = insertCalls[0].values as { media_node_id: string; slot: number; digest: string };
    expect(inserted.media_node_id).toBe('node-uuid-1');
    expect(inserted.slot).toBe(1);
    expect(inserted.digest).toMatch(DIGEST_PATTERN);

    // The persisted digest must actually verify against the returned raw token.
    const expectedDigest = await computeCredentialDigest(PEPPER, result.token);
    expect(inserted.digest).toBe(expectedDigest);

    // The raw token itself must never appear in what was persisted.
    expect(JSON.stringify(insertCalls[0].values)).not.toContain(result.token);
  });

  it('rejects a slot other than 1 or 2 before touching the database', async () => {
    const result = await issueMediaNodeCredential({} as unknown, PEPPER, 'node-uuid-1', 3);
    expect(result).toEqual({ outcome: 'invalid' });
  });

  it('returns conflict on a unique_violation (23505) — slot already has an active credential', async () => {
    const { from } = makeFakeDb({
      media_node_credentials: {
        insert: [{ data: null, error: { message: 'duplicate key value', code: '23505' } }],
      },
    });

    const result = await issueMediaNodeCredential({ from }, PEPPER, 'node-uuid-1', 1);
    expect(result).toEqual({ outcome: 'conflict' });
  });

  it('returns error on any other database error, without leaking the message', async () => {
    const { from } = makeFakeDb({
      media_node_credentials: { insert: [{ data: null, error: { message: 'connection reset' } }] },
    });

    const result = await issueMediaNodeCredential({ from }, PEPPER, 'node-uuid-1', 2);
    expect(result).toEqual({ outcome: 'error' });
  });

  it('produces a different token (and digest) on every call, even for the same node/slot', async () => {
    const first = makeFakeDb({
      media_node_credentials: { insert: [{ data: { id: 'c1' }, error: null }] },
    });
    const second = makeFakeDb({
      media_node_credentials: { insert: [{ data: { id: 'c2' }, error: null }] },
    });

    const r1 = await issueMediaNodeCredential({ from: first.from }, PEPPER, 'node-uuid-1', 1);
    const r2 = await issueMediaNodeCredential({ from: second.from }, PEPPER, 'node-uuid-1', 1);

    if (r1.outcome !== 'issued' || r2.outcome !== 'issued') throw new Error('expected issued');
    expect(r1.token).not.toBe(r2.token);
  });
});
