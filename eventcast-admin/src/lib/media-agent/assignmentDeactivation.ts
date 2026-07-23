/**
 * Idempotent, concurrency-safe deactivation of an activated
 * `media_event_assignments` row for `eventId` — the release-side
 * counterpart to `assignmentActivation.ts`'s `activateAssignment`. See
 * `src/app/internal/media/assignments/[event_id]/deactivate/route.ts` for
 * the auth boundary. This module has no auth concerns of its own.
 *
 * Calls the `deactivate_media_event_assignment` SQL function (migration
 * 0026), which performs a single guarded `UPDATE ... SET enabled = false
 * WHERE event_id = $1 AND enabled = true` inside one Postgres transaction.
 * Node-capacity release is the automatic, live-computed side effect of
 * `enabled` flipping to `false` — this module never reads or writes
 * `media_nodes.active_stream_count`, exactly mirroring how activation never
 * does either.
 *
 * Deliberately does not clear `ingest_id`/`playback_id`/
 * `assigned_media_node_id`/`stream_secret_hash`/publish-window fields, and
 * does not touch `publish_window_end_at` — historical assignment
 * information is preserved, not erased, on deactivation.
 *
 * No `FOR UPDATE` node-locking loop is needed here (unlike activation):
 * deactivation performs no cross-row capacity computation, so the guarded
 * `UPDATE`'s own row-level locking is sufficient — a second concurrent
 * caller simply blocks on the same row until the first transaction ends,
 * then re-evaluates its `WHERE enabled = true` against the now-committed
 * state, exactly the same idempotency mechanism activation's own guarded
 * `UPDATE` already relies on for `already_activated`.
 */

import { eventExists, type DbResult, type MaybeSingleBuilder } from './eventExistence';

interface DiagnosticDb {
  from: (table: string) => {
    select: (columns: string) => MaybeSingleBuilder<{ event_id: string; enabled: boolean }>;
  };
}

interface DeactivationRpcRow {
  outcome: string;
}

interface DeactivationRpcDb {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<DbResult<DeactivationRpcRow[] | DeactivationRpcRow>>;
}

export type DeactivationResult =
  | { outcome: 'deactivated' }
  | { outcome: 'already_inactive' }
  | { outcome: 'event_not_found' }
  | { outcome: 'no_assignment' }
  | { outcome: 'error' };

/**
 * Classifies a `no_row_matched` outcome from
 * `deactivate_media_event_assignment` (migration 0026): the function's
 * guarded UPDATE found no row matching `(event_id, enabled = true)`. This
 * SELECT runs strictly *after* that already-decided outcome — never to gate
 * a write, only to explain one that didn't happen. Mirrors
 * `assignmentActivation.ts`'s `classifyNoRowMatched` exactly.
 */
async function classifyNoRowMatched(db: unknown, eventId: string): Promise<DeactivationResult> {
  const queryableDb = db as DiagnosticDb;
  const { data, error } = await queryableDb
    .from('media_event_assignments')
    .select('event_id, enabled')
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) return { outcome: 'error' };
  if (!data) return { outcome: 'no_assignment' };
  if (!data.enabled) return { outcome: 'already_inactive' };
  // Row exists and is still enabled, yet the guarded UPDATE didn't match it
  // — an unexpected inconsistency, not a defined success/idempotent case.
  return { outcome: 'error' };
}

/**
 * Deactivates the assignment for `eventId`, or reports why it couldn't (or
 * didn't need to). Never deletes a row, never clears historical fields —
 * only ever flips `enabled` from `true` to `false`. Safe to call
 * repeatedly: a second call for an already-inactive assignment returns
 * `already_inactive` with no further mutation.
 */
export async function deactivateAssignment(db: unknown, eventId: string): Promise<DeactivationResult> {
  if (!(await eventExists(db, eventId))) {
    return { outcome: 'event_not_found' };
  }

  const rpcDb = db as DeactivationRpcDb;
  const { data, error } = await rpcDb.rpc('deactivate_media_event_assignment', {
    p_event_id: eventId,
  });

  if (error) return { outcome: 'error' };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { outcome: 'error' };

  switch (row.outcome) {
    case 'deactivated':
      return { outcome: 'deactivated' };
    case 'no_row_matched':
      return classifyNoRowMatched(db, eventId);
    default:
      return { outcome: 'error' };
  }
}
