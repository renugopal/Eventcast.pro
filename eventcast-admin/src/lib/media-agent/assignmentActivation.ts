/**
 * Slice 4 (+ Slice 6 capacity hardening): atomic, concurrency-safe
 * activation of a draft `media_event_assignments` row for SRS + Media Agent
 * use. Operator-only — see
 * `src/app/internal/media/assignments/[event_id]/activate/route.ts` for the
 * auth boundary. This module has no auth concerns of its own.
 *
 * Generates `ingest_id`/`playback_id`/a raw publish secret, hashes the
 * secret with **plain SHA-256 — no pepper** (matching the Go Media Agent's
 * `store.HashToken` exactly; this is deliberately NOT
 * `computeCredentialDigest` from `nodeProvisioning.ts`, which is peppered
 * HMAC-SHA256 for a different purpose — node auth, not stream auth), then
 * calls the `activate_media_event_assignment` SQL function (migration 0024)
 * to select an eligible node under capacity and activate the row, all
 * inside one Postgres transaction.
 *
 * Node selection + capacity enforcement moved into that SQL function
 * because it needs `SELECT ... FOR UPDATE` row locking to be genuinely
 * concurrency-safe against two different events racing to activate onto the
 * same node — see the migration's own comment for why this cannot be done
 * safely from two separate application-code round trips. This module still
 * owns: id/secret generation, the ingest_id/playback_id collision-retry
 * loop (a `23505` from the function's UPDATE surfaces exactly as it did from
 * the old direct UPDATE), and post-hoc diagnostic classification when the
 * function reports its row didn't match (already active vs. no draft at
 * all) — that classification SELECT is never used to gate the write, only
 * to explain a write that already happened not to match.
 *
 * The raw secret exists only in a local variable for the duration of a
 * single activation attempt; only its hash is ever passed to the RPC call;
 * it is returned to the caller exactly once, only on the branch where this
 * call was the one that flipped `enabled` from false to true.
 */

import { eventExists, type DbResult, type MaybeSingleBuilder } from './eventExistence';

const MAX_ID_COLLISION_ATTEMPTS = 3;

/**
 * How long an activated assignment's publish window stays open, starting
 * from the moment of activation. Deliberately independent of the event's
 * own scheduled date/time: activation is a distinct, operator-triggered
 * action decoupled from event scheduling in this slice. A future slice
 * could tie this to `events.event_date`/`timer_target_time` if needed.
 */
const PUBLISH_WINDOW_HOURS = 24;

/** Generates a fresh, high-entropy random hex identifier (32 random bytes, lowercase hex). */
function generateRandomHexId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Plain `hex(SHA-256(token))` — no pepper. Must match the Go Media Agent's
 * `store.HashToken` byte-for-byte, or every `on_publish` call will reject a
 * genuinely valid secret. Not the same algorithm as `computeCredentialDigest`
 * (`nodeProvisioning.ts`), which is peppered HMAC-SHA256 for node auth.
 */
export async function hashPublishSecret(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface DiagnosticDb {
  from: (table: string) => {
    select: (columns: string) => MaybeSingleBuilder<{ event_id: string; enabled: boolean }>;
  };
}

interface ActivationRpcRow {
  outcome: string;
  node_id: string | null;
  ingest_hostname: string | null;
}

interface ActivationRpcDb {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<DbResult<ActivationRpcRow[] | ActivationRpcRow>>;
}

/**
 * Classifies a `no_row_matched` outcome from `activate_media_event_assignment`
 * (migration 0024): the function's guarded UPDATE found no eligible,
 * under-capacity node's write matched `(event_id, enabled = false)`. This
 * SELECT runs strictly *after* that already-decided outcome — never to gate
 * a write, only to explain one that didn't happen.
 */
async function classifyNoRowMatched(db: unknown, eventId: string): Promise<ActivationResult> {
  const queryableDb = db as DiagnosticDb;
  const { data, error } = await queryableDb
    .from('media_event_assignments')
    .select('event_id, enabled')
    .eq('event_id', eventId)
    .maybeSingle();

  if (error) return { outcome: 'error' };
  if (!data) return { outcome: 'no_draft_assignment' };
  if (data.enabled) return { outcome: 'already_activated' };
  // Row exists and is still disabled, yet the guarded UPDATE didn't match it
  // — an unexpected inconsistency, not a defined success/idempotent case.
  return { outcome: 'error' };
}

function computePublishWindow(now: Date = new Date()): { startAt: string; endAt: string } {
  return {
    startAt: now.toISOString(),
    endAt: new Date(now.getTime() + PUBLISH_WINDOW_HOURS * 60 * 60 * 1000).toISOString(),
  };
}

export type ActivationResult =
  | { outcome: 'activated'; ingestHostname: string; ingestId: string; token: string }
  | { outcome: 'already_activated' }
  | { outcome: 'event_not_found' }
  | { outcome: 'no_draft_assignment' }
  | { outcome: 'no_eligible_node' }
  | { outcome: 'node_at_capacity' }
  | { outcome: 'error' };

/**
 * Activates the draft assignment for `eventId`, or reports why it couldn't.
 * See the module docblock for the atomicity/concurrency-safety argument.
 * Never inserts a row — only ever causes the SQL function to `UPDATE` an
 * existing draft.
 */
export async function activateAssignment(db: unknown, eventId: string): Promise<ActivationResult> {
  if (!(await eventExists(db, eventId))) {
    return { outcome: 'event_not_found' };
  }

  const rpcDb = db as ActivationRpcDb;

  for (let attempt = 0; attempt < MAX_ID_COLLISION_ATTEMPTS; attempt++) {
    const ingestId = generateRandomHexId();
    const playbackId = generateRandomHexId();
    const token = generateRandomHexId();
    const streamSecretHash = await hashPublishSecret(token);
    const { startAt, endAt } = computePublishWindow();

    const { data, error } = await rpcDb.rpc('activate_media_event_assignment', {
      p_event_id: eventId,
      p_ingest_id: ingestId,
      p_playback_id: playbackId,
      p_stream_secret_hash: streamSecretHash,
      p_publish_window_start_at: startAt,
      p_publish_window_end_at: endAt,
    });

    if (error) {
      // ingest_id/playback_id is never caller-controlled beyond this
      // attempt's freshly generated values, so a 23505 here can only be an
      // id collision inside the function's UPDATE — regenerate and retry.
      if (error.code === '23505') continue;
      return { outcome: 'error' };
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { outcome: 'error' };

    switch (row.outcome) {
      case 'activated':
        if (!row.ingest_hostname) return { outcome: 'error' };
        return { outcome: 'activated', ingestHostname: row.ingest_hostname, ingestId, token };
      case 'no_eligible_node':
        return { outcome: 'no_eligible_node' };
      case 'node_at_capacity':
        return { outcome: 'node_at_capacity' };
      case 'no_row_matched':
        return classifyNoRowMatched(db, eventId);
      default:
        return { outcome: 'error' };
    }
  }

  return { outcome: 'error' };
}
