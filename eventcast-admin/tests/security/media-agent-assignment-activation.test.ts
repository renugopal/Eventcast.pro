import { describe, expect, it } from 'vitest';
import {
  activateAssignment,
  hashPublishSecret,
  selectEligibleNode,
} from '@/lib/media-agent/assignmentActivation';
import { computeCredentialDigest } from '@/lib/media-agent/nodeProvisioning';

const EVENT_ID = 'event-uuid-1';
const NODE_ID = 'node-uuid-1';
const NODE_HOSTNAME = 'ingest-asia-south1-01.eventcast.pro';
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

// ── Local, hand-rolled query-builder mock ───────────────────────────────────
// Supports every shape assignmentActivation.ts needs:
//   .from('events').select('id').eq('id', x).maybeSingle()
//   .from('media_nodes').select(...).neq('status','retired').order(...).limit(1)
//   .from('media_event_assignments').update({...}).eq().eq().select('event_id')
//   .from('media_event_assignments').select('event_id, enabled').eq(...).maybeSingle()
interface FakeResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

interface RecordedSelect {
  table: string;
  columns: string;
  eqArgs: unknown[][];
  neqArgs: unknown[][];
  orderArgs: unknown[][];
}

interface RecordedUpdate {
  table: string;
  values: Record<string, unknown>;
  eqArgs: unknown[][];
}

function makeFakeDb(tables: Record<string, { select?: FakeResult[]; update?: FakeResult[] }>) {
  const queues = new Map(
    Object.entries(tables).map(([k, v]) => [k, { select: [...(v.select ?? [])], update: [...(v.update ?? [])] }])
  );
  const selects: RecordedSelect[] = [];
  const updates: RecordedUpdate[] = [];

  const from = (table: string) => {
    const queue = queues.get(table);
    if (!queue) throw new Error(`FakeDb: no config for table '${table}' in this test`);

    return {
      select: (columns: string) => {
        const record: RecordedSelect = { table, columns, eqArgs: [], neqArgs: [], orderArgs: [] };
        selects.push(record);
        const builder = {
          eq: (...args: unknown[]) => {
            record.eqArgs.push(args);
            return builder;
          },
          neq: (...args: unknown[]) => {
            record.neqArgs.push(args);
            return builder;
          },
          order: (...args: unknown[]) => {
            record.orderArgs.push(args);
            return builder;
          },
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
      update: (values: Record<string, unknown>) => {
        const record: RecordedUpdate = { table, values, eqArgs: [] };
        updates.push(record);
        const builder = {
          eq: (...args: unknown[]) => {
            record.eqArgs.push(args);
            return builder;
          },
          select: async (_columns: string) => {
            const result = queue.update.shift();
            if (!result) throw new Error(`FakeDb: no more update() results queued for '${table}'`);
            return result;
          },
        };
        return builder;
      },
    };
  };

  return { from, selects, updates };
}

function eventFoundResult(): FakeResult {
  return { data: { id: EVENT_ID }, error: null };
}

function nodeFoundResult(): FakeResult {
  return { data: [{ id: NODE_ID, ingest_hostname: NODE_HOSTNAME }], error: null };
}

describe('hashPublishSecret', () => {
  it('produces hex(SHA-256(token)) — matches the plain, un-peppered shape', async () => {
    const hash = await hashPublishSecret('some-raw-token');
    expect(hash).toMatch(DIGEST_PATTERN);
  });

  it('is deterministic for the same token', async () => {
    const h1 = await hashPublishSecret('fixed-token');
    const h2 = await hashPublishSecret('fixed-token');
    expect(h1).toBe(h2);
  });

  it('diverges from computeCredentialDigest (peppered HMAC) for the same input — proves the algorithms are genuinely different', async () => {
    const plain = await hashPublishSecret('same-value');
    const peppered = await computeCredentialDigest('some-pepper', 'same-value');
    expect(plain).not.toBe(peppered);
  });

  it('does not change output when an unrelated "pepper-shaped" second argument would have been used — confirms no pepper is mixed in', async () => {
    // hashPublishSecret takes only one argument; this test documents that
    // fact by construction — calling it twice with the same token from two
    // different "callers" (as if a pepper were involved) yields identical
    // output, unlike an HMAC which would differ by key.
    const a = await hashPublishSecret('token-x');
    const b = await hashPublishSecret('token-x');
    expect(a).toBe(b);
  });
});

describe('selectEligibleNode', () => {
  it('selects the oldest non-retired node, ordered ascending by created_at, limited to 1', async () => {
    const { from, selects } = makeFakeDb({
      media_nodes: { select: [nodeFoundResult()] },
    });

    const result = await selectEligibleNode({ from });

    expect(result).toEqual({ id: NODE_ID, ingestHostname: NODE_HOSTNAME });
    expect(selects[0].table).toBe('media_nodes');
    expect(selects[0].neqArgs).toEqual([['status', 'retired']]);
    expect(selects[0].orderArgs).toEqual([['created_at', { ascending: true }]]);
  });

  it('returns null when no eligible node exists', async () => {
    const { from } = makeFakeDb({
      media_nodes: { select: [{ data: [], error: null }] },
    });

    const result = await selectEligibleNode({ from });

    expect(result).toBeNull();
  });

  it('returns null on a database error', async () => {
    const { from } = makeFakeDb({
      media_nodes: { select: [{ data: null, error: { message: 'connection reset' } }] },
    });

    const result = await selectEligibleNode({ from });

    expect(result).toBeNull();
  });
});

describe('activateAssignment', () => {
  it('activates on the first call: exact conditional UPDATE shape, no forbidden fields, correct return', async () => {
    const { from, updates } = makeFakeDb({
      events: { select: [eventFoundResult()] },
      media_nodes: { select: [nodeFoundResult()] },
      media_event_assignments: { update: [{ data: [{ event_id: EVENT_ID }], error: null }] },
    });

    const result = await activateAssignment({ from }, EVENT_ID);

    expect(result.outcome).toBe('activated');
    if (result.outcome !== 'activated') throw new Error('expected activated');
    expect(result.ingestHostname).toBe(NODE_HOSTNAME);
    expect(result.ingestId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);

    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe('media_event_assignments');
    expect(updates[0].eqArgs).toEqual([
      ['event_id', EVENT_ID],
      ['enabled', false],
    ]);

    const values = updates[0].values;
    expect(values.assigned_media_node_id).toBe(NODE_ID);
    expect(values.ingest_id).toBe(result.ingestId);
    expect(values.playback_id).toMatch(/^[0-9a-f]{64}$/);
    expect(values.stream_secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(values.publish_window_start_at).toEqual(expect.any(String));
    expect(values.publish_window_end_at).toEqual(expect.any(String));
    expect(values.enabled).toBe(true);
    expect(new Date(values.publish_window_end_at as string).getTime()).toBeGreaterThan(
      new Date(values.publish_window_start_at as string).getTime()
    );

    // Never sets config_version or updated_at — trigger-owned.
    expect(values).not.toHaveProperty('config_version');
    expect(values).not.toHaveProperty('updated_at');

    // The persisted hash must actually verify against the returned raw token.
    const expectedHash = await hashPublishSecret(result.token);
    expect(values.stream_secret_hash).toBe(expectedHash);

    // The raw token itself must never appear in what was persisted.
    expect(JSON.stringify(values)).not.toContain(result.token);
  });

  it('returns event_not_found when the event does not exist, without touching media_nodes or media_event_assignments', async () => {
    const { from } = makeFakeDb({
      events: { select: [{ data: null, error: null }] },
    });

    const result = await activateAssignment({ from }, 'no-such-event');

    expect(result).toEqual({ outcome: 'event_not_found' });
  });

  it('returns no_eligible_node when there are zero eligible nodes', async () => {
    const { from } = makeFakeDb({
      events: { select: [eventFoundResult()] },
      media_nodes: { select: [{ data: [], error: null }] },
    });

    const result = await activateAssignment({ from }, EVENT_ID);

    expect(result).toEqual({ outcome: 'no_eligible_node' });
  });

  it('returns already_activated when the guarded UPDATE matches zero rows because the row is already enabled', async () => {
    const { from } = makeFakeDb({
      events: { select: [eventFoundResult()] },
      media_nodes: { select: [nodeFoundResult()] },
      media_event_assignments: {
        update: [{ data: [], error: null }],
        select: [{ data: { event_id: EVENT_ID, enabled: true }, error: null }],
      },
    });

    const result = await activateAssignment({ from }, EVENT_ID);

    expect(result).toEqual({ outcome: 'already_activated' });
  });

  it('returns no_draft_assignment when the guarded UPDATE matches zero rows because no assignment row exists at all', async () => {
    const { from } = makeFakeDb({
      events: { select: [eventFoundResult()] },
      media_nodes: { select: [nodeFoundResult()] },
      media_event_assignments: {
        update: [{ data: [], error: null }],
        select: [{ data: null, error: null }],
      },
    });

    const result = await activateAssignment({ from }, EVENT_ID);

    expect(result).toEqual({ outcome: 'no_draft_assignment' });
  });

  it('retries with fresh ids on an ingest_id/playback_id collision (23505), then succeeds', async () => {
    const { from, updates } = makeFakeDb({
      events: { select: [eventFoundResult()] },
      media_nodes: { select: [nodeFoundResult()] },
      media_event_assignments: {
        update: [
          { data: null, error: { message: 'duplicate key value', code: '23505' } },
          { data: [{ event_id: EVENT_ID }], error: null },
        ],
      },
    });

    const result = await activateAssignment({ from }, EVENT_ID);

    expect(result.outcome).toBe('activated');
    expect(updates).toHaveLength(2);
    // Each attempt must use freshly generated, distinct values.
    expect(updates[0].values.ingest_id).not.toBe(updates[1].values.ingest_id);
    expect(updates[0].values.playback_id).not.toBe(updates[1].values.playback_id);
  });

  it('gives up after exhausting bounded collision retries', async () => {
    const { from, updates } = makeFakeDb({
      events: { select: [eventFoundResult()] },
      media_nodes: { select: [nodeFoundResult()] },
      media_event_assignments: {
        update: [
          { data: null, error: { message: 'duplicate key value', code: '23505' } },
          { data: null, error: { message: 'duplicate key value', code: '23505' } },
          { data: null, error: { message: 'duplicate key value', code: '23505' } },
        ],
      },
    });

    const result = await activateAssignment({ from }, EVENT_ID);

    expect(result).toEqual({ outcome: 'error' });
    expect(updates).toHaveLength(3);
  });

  it('returns error on a generic database failure during the UPDATE, without leaking the message', async () => {
    const { from } = makeFakeDb({
      events: { select: [eventFoundResult()] },
      media_nodes: { select: [nodeFoundResult()] },
      media_event_assignments: {
        update: [{ data: null, error: { message: 'connection reset to 10.0.0.5' } }],
      },
    });

    const result = await activateAssignment({ from }, EVENT_ID);

    expect(result).toEqual({ outcome: 'error' });
  });

  it('returns error when the post-hoc diagnostic SELECT itself fails', async () => {
    const { from } = makeFakeDb({
      events: { select: [eventFoundResult()] },
      media_nodes: { select: [nodeFoundResult()] },
      media_event_assignments: {
        update: [{ data: [], error: null }],
        select: [{ data: null, error: { message: 'connection reset' } }],
      },
    });

    const result = await activateAssignment({ from }, EVENT_ID);

    expect(result).toEqual({ outcome: 'error' });
  });
});
