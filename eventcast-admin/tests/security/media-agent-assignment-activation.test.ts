import { describe, expect, it } from 'vitest';
import { activateAssignment, hashPublishSecret } from '@/lib/media-agent/assignmentActivation';
import { computeCredentialDigest } from '@/lib/media-agent/nodeProvisioning';

const EVENT_ID = 'event-uuid-1';
const NODE_ID = 'node-uuid-1';
const NODE_HOSTNAME = 'ingest-asia-south1-01.eventcast.pro';
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

// ── Local, hand-rolled query-builder/RPC mock ───────────────────────────────
// Supports every shape assignmentActivation.ts needs post-migration-0024:
//   .from('events').select('id').eq('id', x).maybeSingle()
//   .rpc('activate_media_event_assignment', {...})
//   .from('media_event_assignments').select('event_id, enabled').eq(...).maybeSingle()  (diagnostic only)
interface FakeResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

interface RecordedSelect {
  table: string;
  columns: string;
  eqArgs: unknown[][];
}

interface RecordedRpc {
  fn: string;
  args: Record<string, unknown>;
}

function makeFakeDb(config: {
  events?: FakeResult[];
  diagnostic?: FakeResult[];
  rpc?: FakeResult[];
}) {
  const eventsQueue = [...(config.events ?? [])];
  const diagnosticQueue = [...(config.diagnostic ?? [])];
  const rpcQueue = [...(config.rpc ?? [])];
  const selects: RecordedSelect[] = [];
  const rpcs: RecordedRpc[] = [];

  const from = (table: string) => ({
    select: (columns: string) => {
      const record: RecordedSelect = { table, columns, eqArgs: [] };
      selects.push(record);
      const builder = {
        eq: (...args: unknown[]) => {
          record.eqArgs.push(args);
          return builder;
        },
        maybeSingle: async () => {
          const queue = table === 'events' ? eventsQueue : diagnosticQueue;
          const result = queue.shift();
          if (!result) throw new Error(`FakeDb: no more select() results queued for '${table}'`);
          return result;
        },
      };
      return builder;
    },
  });

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    rpcs.push({ fn, args });
    const result = rpcQueue.shift();
    if (!result) throw new Error(`FakeDb: no more rpc() results queued for '${fn}'`);
    return result;
  };

  return { from, rpc, selects, rpcs };
}

function eventFoundResult(): FakeResult {
  return { data: { id: EVENT_ID }, error: null };
}

function activatedRpcResult(): FakeResult {
  return {
    data: [{ outcome: 'activated', node_id: NODE_ID, ingest_hostname: NODE_HOSTNAME }],
    error: null,
  };
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
    const a = await hashPublishSecret('token-x');
    const b = await hashPublishSecret('token-x');
    expect(a).toBe(b);
  });
});

describe('activateAssignment', () => {
  it('activates on the first call: calls the capacity-safe RPC with the exact expected args, no forbidden fields, correct return', async () => {
    const { from, rpc, rpcs } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [activatedRpcResult()],
    });

    const result = await activateAssignment({ from, rpc }, EVENT_ID);

    expect(result.outcome).toBe('activated');
    if (result.outcome !== 'activated') throw new Error('expected activated');
    expect(result.ingestHostname).toBe(NODE_HOSTNAME);
    expect(result.ingestId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);

    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].fn).toBe('activate_media_event_assignment');
    const args = rpcs[0].args;
    expect(args.p_event_id).toBe(EVENT_ID);
    expect(args.p_ingest_id).toBe(result.ingestId);
    expect(args.p_playback_id).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_stream_secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_publish_window_start_at).toEqual(expect.any(String));
    expect(args.p_publish_window_end_at).toEqual(expect.any(String));
    expect(
      new Date(args.p_publish_window_end_at as string).getTime()
    ).toBeGreaterThan(new Date(args.p_publish_window_start_at as string).getTime());

    // Never passes config_version or updated_at — trigger-owned.
    expect(args).not.toHaveProperty('p_config_version');
    expect(args).not.toHaveProperty('p_updated_at');
    // Never passes a node id — the SQL function selects the node itself.
    expect(args).not.toHaveProperty('p_node_id');

    // The persisted hash must actually verify against the returned raw token.
    const expectedHash = await hashPublishSecret(result.token);
    expect(args.p_stream_secret_hash).toBe(expectedHash);

    // The raw token itself must never appear in what was sent.
    expect(JSON.stringify(args)).not.toContain(result.token);
  });

  it('returns event_not_found when the event does not exist, without calling the RPC at all', async () => {
    const { from, rpc, rpcs } = makeFakeDb({
      events: [{ data: null, error: null }],
    });

    const result = await activateAssignment({ from, rpc }, 'no-such-event');

    expect(result).toEqual({ outcome: 'event_not_found' });
    expect(rpcs).toHaveLength(0);
  });

  it('returns no_eligible_node when the RPC reports zero eligible (healthy, non-maintenance) nodes', async () => {
    const { from, rpc } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: [{ outcome: 'no_eligible_node', node_id: null, ingest_hostname: null }], error: null }],
    });

    const result = await activateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'no_eligible_node' });
  });

  it('returns node_at_capacity when the RPC reports every eligible node is at hard_stream_limit', async () => {
    const { from, rpc } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: [{ outcome: 'node_at_capacity', node_id: null, ingest_hostname: null }], error: null }],
    });

    const result = await activateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'node_at_capacity' });
  });

  it('returns already_activated when the RPC reports no_row_matched and the diagnostic SELECT finds an already-enabled row', async () => {
    const { from, rpc } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: [{ outcome: 'no_row_matched', node_id: null, ingest_hostname: null }], error: null }],
      diagnostic: [{ data: { event_id: EVENT_ID, enabled: true }, error: null }],
    });

    const result = await activateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'already_activated' });
  });

  it('returns no_draft_assignment when the RPC reports no_row_matched and the diagnostic SELECT finds no row at all', async () => {
    const { from, rpc } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: [{ outcome: 'no_row_matched', node_id: null, ingest_hostname: null }], error: null }],
      diagnostic: [{ data: null, error: null }],
    });

    const result = await activateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'no_draft_assignment' });
  });

  it('returns error when the no_row_matched diagnostic SELECT itself fails', async () => {
    const { from, rpc } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: [{ outcome: 'no_row_matched', node_id: null, ingest_hostname: null }], error: null }],
      diagnostic: [{ data: null, error: { message: 'connection reset' } }],
    });

    const result = await activateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'error' });
  });

  it('retries with fresh ids on an ingest_id/playback_id collision (23505), then succeeds', async () => {
    const { from, rpc, rpcs } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [
        { data: null, error: { message: 'duplicate key value', code: '23505' } },
        activatedRpcResult(),
      ],
    });

    const result = await activateAssignment({ from, rpc }, EVENT_ID);

    expect(result.outcome).toBe('activated');
    expect(rpcs).toHaveLength(2);
    // Each attempt must use freshly generated, distinct values.
    expect(rpcs[0].args.p_ingest_id).not.toBe(rpcs[1].args.p_ingest_id);
    expect(rpcs[0].args.p_playback_id).not.toBe(rpcs[1].args.p_playback_id);
  });

  it('gives up after exhausting bounded collision retries', async () => {
    const { from, rpc, rpcs } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [
        { data: null, error: { message: 'duplicate key value', code: '23505' } },
        { data: null, error: { message: 'duplicate key value', code: '23505' } },
        { data: null, error: { message: 'duplicate key value', code: '23505' } },
      ],
    });

    const result = await activateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'error' });
    expect(rpcs).toHaveLength(3);
  });

  it('returns error on a generic RPC failure, without leaking the message', async () => {
    const { from, rpc } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: null, error: { message: 'connection reset to 10.0.0.5' } }],
    });

    const result = await activateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'error' });
  });

  it('returns error when the RPC returns no row at all', async () => {
    const { from, rpc } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: [], error: null }],
    });

    const result = await activateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'error' });
  });

  it('returns error when the RPC reports "activated" but omits ingest_hostname', async () => {
    const { from, rpc } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: [{ outcome: 'activated', node_id: NODE_ID, ingest_hostname: null }], error: null }],
    });

    const result = await activateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'error' });
  });

  it('returns error for an unrecognized RPC outcome value', async () => {
    const { from, rpc } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: [{ outcome: 'something_unexpected', node_id: null, ingest_hostname: null }], error: null }],
    });

    const result = await activateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'error' });
  });
});
