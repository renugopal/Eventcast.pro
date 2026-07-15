/**
 * Slice 4: atomic activation of a draft `media_event_assignments` row for
 * SRS + Media Agent use. Operator-only — see
 * `src/app/internal/media/assignments/[event_id]/activate/route.ts` for the
 * auth boundary. This module has no auth concerns of its own.
 *
 * Selects a node, generates `ingest_id`/`playback_id`/a raw publish secret,
 * hashes the secret with **plain SHA-256 — no pepper** (matching the Go
 * Media Agent's `store.HashToken` exactly; this is deliberately NOT
 * `computeCredentialDigest` from `nodeProvisioning.ts`, which is peppered
 * HMAC-SHA256 for a different purpose — node auth, not stream auth), and
 * activates the existing draft row in a single, conditionally-filtered
 * `UPDATE ... WHERE event_id = $1 AND enabled = false`.
 *
 * That single statement is the entire atomicity/idempotency/one-time-
 * disclosure mechanism: Postgres's row-locking + READ COMMITTED re-check
 * semantics guarantee at most one caller ever observes the "matched, 1 row
 * updated" outcome for a given event, no matter how many concurrent or
 * retried calls arrive. This module never performs a `SELECT` to decide
 * whether to `UPDATE` — the only pre-write `SELECT`s here are (a) confirming
 * the target `events` row exists at all (unrelated to the assignment's
 * enabled/disabled state, so it cannot reintroduce the race) and (b) node
 * selection (also unrelated to the assignment's state). A `SELECT` against
 * `media_event_assignments` itself is only ever used *after* an `UPDATE`
 * that matched zero rows, purely to classify *why* (no draft row at all vs.
 * already active) for a clearer error — never to gate the write.
 *
 * The raw secret exists only in a local variable for the duration of a
 * single activation attempt; only its hash is ever passed to `.update()`;
 * it is returned to the caller exactly once, only on the branch where this
 * call was the one that flipped `enabled` from false to true.
 */

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

interface DbResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

interface MaybeSingleBuilder<T> {
  eq: (column: string, value: unknown) => MaybeSingleBuilder<T>;
  maybeSingle: () => PromiseLike<DbResult<T>>;
}

interface EventsExistsDb {
  from: (table: string) => {
    select: (columns: string) => MaybeSingleBuilder<{ id: string }>;
  };
}

interface NodeSelectBuilder {
  neq: (column: string, value: unknown) => NodeSelectBuilder;
  order: (column: string, opts: { ascending: boolean }) => NodeSelectBuilder;
  limit: (count: number) => PromiseLike<DbResult<{ id: string; ingest_hostname: string }[]>>;
}

interface NodesDb {
  from: (table: string) => {
    select: (columns: string) => NodeSelectBuilder;
  };
}

interface UpdateEqBuilder {
  eq: (column: string, value: unknown) => UpdateEqBuilder;
  select: (columns: string) => PromiseLike<DbResult<{ event_id: string }[]>>;
}

interface AssignmentsWriteDb {
  from: (table: string) => {
    update: (values: Record<string, unknown>) => UpdateEqBuilder;
    select: (columns: string) => MaybeSingleBuilder<{ event_id: string; enabled: boolean }>;
  };
}

/**
 * Confirms the target event row exists. Unrelated to the assignment's
 * enabled/disabled state — does not gate the activation write, and cannot
 * reintroduce the race the conditional `UPDATE` protects against.
 */
async function eventExists(db: unknown, eventId: string): Promise<boolean> {
  const queryableDb = db as EventsExistsDb;
  const { data, error } = await queryableDb.from('events').select('id').eq('id', eventId).maybeSingle();
  return !error && data !== null;
}

export interface EligibleNode {
  id: string;
  ingestHostname: string;
}

/**
 * Deterministic single-node-deployment selection: the oldest non-retired
 * node. Explicitly a simplification — not a scheduler. A future
 * multi-node deployment needs real selection logic here, not just a wider
 * filter.
 */
export async function selectEligibleNode(db: unknown): Promise<EligibleNode | null> {
  const queryableDb = db as NodesDb;
  const { data, error } = await queryableDb
    .from('media_nodes')
    .select('id, ingest_hostname')
    .neq('status', 'retired')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return { id: data[0].id, ingestHostname: data[0].ingest_hostname };
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
  | { outcome: 'error' };

/**
 * Activates the draft assignment for `eventId`, or reports why it couldn't.
 * See the module docblock for the atomicity/idempotency argument. Never
 * inserts a row — only ever `UPDATE`s an existing draft.
 */
export async function activateAssignment(db: unknown, eventId: string): Promise<ActivationResult> {
  if (!(await eventExists(db, eventId))) {
    return { outcome: 'event_not_found' };
  }

  const node = await selectEligibleNode(db);
  if (!node) {
    return { outcome: 'no_eligible_node' };
  }

  const writeDb = db as AssignmentsWriteDb;

  for (let attempt = 0; attempt < MAX_ID_COLLISION_ATTEMPTS; attempt++) {
    const ingestId = generateRandomHexId();
    const playbackId = generateRandomHexId();
    const token = generateRandomHexId();
    const streamSecretHash = await hashPublishSecret(token);
    const { startAt, endAt } = computePublishWindow();

    const { data, error } = await writeDb
      .from('media_event_assignments')
      .update({
        assigned_media_node_id: node.id,
        ingest_id: ingestId,
        playback_id: playbackId,
        stream_secret_hash: streamSecretHash,
        publish_window_start_at: startAt,
        publish_window_end_at: endAt,
        enabled: true,
      })
      .eq('event_id', eventId)
      .eq('enabled', false)
      .select('event_id');

    if (error) {
      // event_id is never part of the SET clause, so a 23505 here can only
      // be an ingest_id/playback_id collision — regenerate and retry.
      if (error.code === '23505') continue;
      return { outcome: 'error' };
    }

    if (data && data.length === 1) {
      return { outcome: 'activated', ingestHostname: node.ingestHostname, ingestId, token };
    }

    // Zero rows affected, no error — not a collision. The guarded UPDATE
    // simply found no row matching (event_id, enabled = false). Classify
    // why, post-hoc, without ever having gated the write on this read.
    const { data: diagnostic, error: diagnosticError } = await writeDb
      .from('media_event_assignments')
      .select('event_id, enabled')
      .eq('event_id', eventId)
      .maybeSingle();

    if (diagnosticError) return { outcome: 'error' };
    if (!diagnostic) return { outcome: 'no_draft_assignment' };
    if (diagnostic.enabled) return { outcome: 'already_activated' };
    // Row exists and is still disabled, yet our guarded UPDATE didn't match
    // it — an unexpected inconsistency, not a defined success/idempotent
    // case. Surface as a generic error rather than guessing.
    return { outcome: 'error' };
  }

  return { outcome: 'error' };
}
