import { describe, expect, it } from 'vitest';
import { deactivateAssignment } from '@/lib/media-agent/assignmentDeactivation';

const EVENT_ID = 'event-uuid-1';

// ── Local, hand-rolled query-builder/RPC mock ───────────────────────────────
// Supports every shape assignmentDeactivation.ts needs post-migration-0026:
//   .from('events').select('id').eq('id', x).maybeSingle()
//   .rpc('deactivate_media_event_assignment', {...})
//   .from('media_event_assignments').select('event_id, enabled').eq(...).maybeSingle()  (diagnostic only)
interface FakeResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

interface RecordedRpc {
  fn: string;
  args: Record<string, unknown>;
}

function makeFakeDb(config: { events?: FakeResult[]; diagnostic?: FakeResult[]; rpc?: FakeResult[] }) {
  const eventsQueue = [...(config.events ?? [])];
  const diagnosticQueue = [...(config.diagnostic ?? [])];
  const rpcQueue = [...(config.rpc ?? [])];
  const rpcs: RecordedRpc[] = [];

  const from = (table: string) => ({
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
  });

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    rpcs.push({ fn, args });
    const result = rpcQueue.shift();
    if (!result) throw new Error(`FakeDb: no more rpc() results queued for '${fn}'`);
    return result;
  };

  return { from, rpc, rpcs };
}

function eventFoundResult(): FakeResult {
  return { data: { id: EVENT_ID }, error: null };
}

function deactivatedRpcResult(): FakeResult {
  return { data: [{ outcome: 'deactivated' }], error: null };
}

describe('deactivateAssignment', () => {
  it('deactivates on the first call: calls the RPC with exactly p_event_id, no other args', async () => {
    const { from, rpc, rpcs } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [deactivatedRpcResult()],
    });

    const result = await deactivateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'deactivated' });
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0].fn).toBe('deactivate_media_event_assignment');
    expect(rpcs[0].args).toEqual({ p_event_id: EVENT_ID });
  });

  it('returns event_not_found when the event does not exist, without calling the RPC at all', async () => {
    const { from, rpc, rpcs } = makeFakeDb({
      events: [{ data: null, error: null }],
    });

    const result = await deactivateAssignment({ from, rpc }, 'no-such-event');

    expect(result).toEqual({ outcome: 'event_not_found' });
    expect(rpcs).toHaveLength(0);
  });

  it('returns already_inactive when the RPC reports no_row_matched and the diagnostic SELECT finds an already-disabled row — idempotent, no error', async () => {
    const { from, rpc } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: [{ outcome: 'no_row_matched' }], error: null }],
      diagnostic: [{ data: { event_id: EVENT_ID, enabled: false }, error: null }],
    });

    const result = await deactivateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'already_inactive' });
  });

  it('a second, repeated call after a successful deactivation also returns already_inactive — proves idempotency across two full invocations', async () => {
    const { from, rpc } = makeFakeDb({
      events: [eventFoundResult(), eventFoundResult()],
      rpc: [deactivatedRpcResult(), { data: [{ outcome: 'no_row_matched' }], error: null }],
      diagnostic: [{ data: { event_id: EVENT_ID, enabled: false }, error: null }],
    });

    const first = await deactivateAssignment({ from, rpc }, EVENT_ID);
    const second = await deactivateAssignment({ from, rpc }, EVENT_ID);

    expect(first).toEqual({ outcome: 'deactivated' });
    expect(second).toEqual({ outcome: 'already_inactive' });
  });

  it('returns no_assignment when the RPC reports no_row_matched and the diagnostic SELECT finds no row at all', async () => {
    const { from, rpc } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: [{ outcome: 'no_row_matched' }], error: null }],
      diagnostic: [{ data: null, error: null }],
    });

    const result = await deactivateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'no_assignment' });
  });

  it('returns error when the no_row_matched diagnostic SELECT itself fails', async () => {
    const { from, rpc } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: [{ outcome: 'no_row_matched' }], error: null }],
      diagnostic: [{ data: null, error: { message: 'connection reset' } }],
    });

    const result = await deactivateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'error' });
  });

  it('returns error on a generic RPC failure, without leaking the message', async () => {
    const { from, rpc } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: null, error: { message: 'connection reset to 10.0.0.5' } }],
    });

    const result = await deactivateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'error' });
  });

  it('returns error when the RPC returns no row at all', async () => {
    const { from, rpc } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: [], error: null }],
    });

    const result = await deactivateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'error' });
  });

  it('returns error for an unrecognized RPC outcome value', async () => {
    const { from, rpc } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [{ data: [{ outcome: 'something_unexpected' }], error: null }],
    });

    const result = await deactivateAssignment({ from, rpc }, EVENT_ID);

    expect(result).toEqual({ outcome: 'error' });
  });

  it('the RPC call carries no ingest/playback/secret fields — deactivation never regenerates or touches credential material', async () => {
    const { from, rpc, rpcs } = makeFakeDb({
      events: [eventFoundResult()],
      rpc: [deactivatedRpcResult()],
    });

    await deactivateAssignment({ from, rpc }, EVENT_ID);

    const args = rpcs[0].args;
    expect(Object.keys(args)).toEqual(['p_event_id']);
    expect(args).not.toHaveProperty('p_ingest_id');
    expect(args).not.toHaveProperty('p_playback_id');
    expect(args).not.toHaveProperty('p_stream_secret_hash');
    expect(args).not.toHaveProperty('p_publish_window_end_at');
  });
});
