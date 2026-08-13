/**
 * Service-role data-access helpers for the internal Media Agent assignments
 * control-plane endpoint (`GET /internal/media/nodes/{node_id}/assignments`).
 *
 * Every function here is a thin, single-purpose Supabase query against the
 * service-role-only tables from migrations 0020/0021 — no authentication, no
 * crypto, no HTTP concerns. The route composes these with the pure
 * primitives in `nodeAuth.ts` and the pure adapter in `assignmentAdapter.ts`.
 */

import type { MediaAgentAssignmentSource } from './contracts';

interface DbQueryResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

// Minimal, structurally-typed Supabase surface this module needs — kept
// loose (like `ownership.ts`'s `QueryableDb`) so the real `supabaseAdmin`
// client and test mocks both satisfy it without instantiating Supabase's
// full generic client type.
interface DbQueryBuilder<T> extends PromiseLike<DbQueryResult<T>> {
  eq: (column: string, value: unknown) => DbQueryBuilder<T>;
  is: (column: string, value: null) => DbQueryBuilder<T>;
  limit: (count: number) => DbQueryBuilder<T>;
  maybeSingle: () => PromiseLike<DbQueryResult<T>>;
}

interface MediaAgentDb {
  from: (table: string) => {
    select: (columns: string) => DbQueryBuilder<unknown>;
    insert: (values: Record<string, unknown>) => PromiseLike<DbQueryResult<unknown>>;
  };
}

interface MediaAgentRpcDb {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * Fixed, syntactically-valid-but-never-real UUID used as the
 * `media_node_credentials.media_node_id` filter when the requested node
 * does not exist. This keeps the credential query's shape — one query,
 * same columns, same filters — identical whether the node is real or not,
 * so an unknown node never skips work an attacker could time against a
 * known one. `media_node_id` is a `uuid NOT NULL` column (migration 0021),
 * so this must be UUID-shaped, not an arbitrary sentinel string.
 */
export const DECOY_MEDIA_NODE_ID = '00000000-0000-0000-0000-000000000000';

export const MEDIA_NODE_SELECT_COLUMNS = 'id, config_version';
export const MEDIA_NODE_CREDENTIALS_SELECT_COLUMNS = 'slot, digest';
export const MEDIA_EVENT_ASSIGNMENTS_SELECT_COLUMNS =
  'event_id, ingest_id, playback_id, stream_secret_hash, enabled, publish_window_start_at, publish_window_end_at, config_version, updated_at, youtube_enabled';

export interface MediaNodeRow {
  id: string;
  configVersion: string;
}

/**
 * Resolves `media_nodes.name` (the Media Agent's own node identifier, sent
 * as the path segment and `X-EventCast-Node-Id`) to its row. Returns `null`
 * for both "no such node" and any query error — the caller must not
 * distinguish between them in its response.
 */
export async function findMediaNodeByName(
  db: unknown,
  name: string
): Promise<MediaNodeRow | null> {
  const queryableDb = db as MediaAgentDb;
  const { data, error } = await queryableDb
    .from('media_nodes')
    .select(MEDIA_NODE_SELECT_COLUMNS)
    .eq('name', name)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as { id: string; config_version: string | null };
  return { id: row.id, configVersion: row.config_version ?? '' };
}

export interface MediaNodeCredentialDigests {
  slot1: string | null;
  slot2: string | null;
}

/**
 * Loads the active (non-revoked) slot 1 / slot 2 credential digests for a
 * media_node_id. Filters `revoked_at IS NULL` at the database level (via
 * `.is()`, the PostgREST-correct null filter — `.eq('revoked_at', null)`
 * would compile to `revoked_at = NULL`, which never matches under SQL's
 * three-valued logic). Called unconditionally by the route for every
 * request — with `DECOY_MEDIA_NODE_ID` when the node is unknown — so this
 * query's shape and cost never reveals node existence. Returns `null` only
 * on a genuine query error; a node with zero active credentials still
 * returns `{ slot1: null, slot2: null }`, which
 * `verifyMediaNodeCredential`'s fixed decoy-digest padding already handles
 * as a normal (always-failing) case.
 */
export async function loadActiveCredentialDigests(
  db: unknown,
  mediaNodeId: string
): Promise<MediaNodeCredentialDigests | null> {
  const queryableDb = db as MediaAgentDb;
  const { data, error } = await queryableDb
    .from('media_node_credentials')
    .select(MEDIA_NODE_CREDENTIALS_SELECT_COLUMNS)
    .eq('media_node_id', mediaNodeId)
    .is('revoked_at', null);

  if (error) return null;
  const rows = (data ?? []) as { slot: number; digest: string }[];

  let slot1: string | null = null;
  let slot2: string | null = null;
  for (const row of rows) {
    if (row.slot === 1) slot1 = row.digest;
    else if (row.slot === 2) slot2 = row.digest;
  }
  return { slot1, slot2 };
}

export type NodeActivationCheckResult = 'authorized' | 'not_authorized' | 'error';

/**
 * Proves that `mediaNodeId` genuinely produced a recording for `eventId`,
 * by requiring an append-only activation-history row for that exact pair.
 *
 * Reads `media_event_assignment_activations` (migration `0036`), never
 * `media_event_assignments.assigned_media_node_id`. That column is
 * overwritten on every activation by `activate_media_event_assignment`
 * (migration `0024`), so after a reassignment it names the *current* node
 * rather than the one that produced an earlier recording — using it here
 * would simultaneously reject the legitimate producing node's late
 * finalization report and authorize a node that produced none of those
 * bytes.
 *
 * Deliberately ignores `enabled` and does not require the current
 * assignment to still point at this node: recording finalization and B2
 * archival legitimately happen well after the live assignment is disabled.
 *
 * Fails closed — a query error is `error`, never `authorized` — and the
 * caller must not invoke the recording-transition RPC unless this returns
 * `authorized`.
 *
 * This is an EXISTENCE check (`.limit(1)`), deliberately not
 * `.maybeSingle()`. `media_event_assignment_activations` is append-only and
 * holds one row per activation, so a node legitimately accumulates several
 * rows for the same `(event_id, media_node_id)` pair whenever an event is
 * deactivated (migration `0026`) and activated again — and oldest-first
 * node selection makes reselecting the same node the expected outcome, not
 * an edge case. `.maybeSingle()` treats >1 match as a query error, which
 * would have collapsed to a permanent 401 for exactly the reactivated
 * events this table exists to handle correctly. Multiple rows are valid
 * evidence and must never be resolved with a UNIQUE constraint: that would
 * contradict the append-only design and make a second activation fail.
 */
export async function nodeHasEventActivation(
  db: unknown,
  eventId: string,
  mediaNodeId: string
): Promise<NodeActivationCheckResult> {
  const queryableDb = db as MediaAgentDb;
  const { data, error } = await queryableDb
    .from('media_event_assignment_activations')
    .select('id')
    .eq('event_id', eventId)
    .eq('media_node_id', mediaNodeId)
    .limit(1);

  if (error) return 'error';
  // Anything that is not a populated row set is a denial, so an unexpected
  // response shape fails closed rather than authorizing.
  return Array.isArray(data) && data.length > 0 ? 'authorized' : 'not_authorized';
}

export type NonceClaimResult = 'claimed' | 'conflict' | 'error';

/**
 * Atomically claims a request nonce. The UNIQUE (media_node_id, request_id)
 * constraint on `media_node_request_nonces` (migration 0021) — not a
 * separate check-then-insert — IS the replay check: a conflict here means
 * this request_id was already accepted for this node, detected purely from
 * the Postgres unique_violation code (23505), atomic across instances.
 * `acceptedAt` and `expiresAt` are both caller-supplied (the same clock the
 * route already validated the request's timestamp against), rather than
 * relying on the table's `DEFAULT now()`, so a single consistent clock
 * reading backs both the freshness check and the stored nonce window.
 */
export async function claimRequestNonce(
  db: unknown,
  mediaNodeId: string,
  requestId: string,
  acceptedAt: Date,
  expiresAt: Date
): Promise<NonceClaimResult> {
  const queryableDb = db as MediaAgentDb;
  const { error } = await queryableDb.from('media_node_request_nonces').insert({
    media_node_id: mediaNodeId,
    request_id: requestId,
    accepted_at: acceptedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  });

  if (!error) return 'claimed';
  return error.code === '23505' ? 'conflict' : 'error';
}

export type NodeRateLimitResult = 'allowed' | 'limited' | 'error';

/**
 * Strict, fail-CLOSED node rate limit check for this authenticated
 * machine-auth boundary. Reuses the existing `check_rate_limit` RPC
 * (migration 0010) — the same schema `@/lib/rateLimit`'s `enforceRateLimit`
 * uses — but deliberately does NOT reuse that helper: `enforceRateLimit` is
 * designed to fail OPEN for public, unauthenticated flows (e.g. the guest
 * photo wall), which is the wrong default here. Any RPC error or unexpected
 * exception collapses to `'error'`, which the route treats as not allowed.
 */
export async function checkNodeRateLimit(
  db: unknown,
  mediaNodeId: string,
  endpoint: string,
  limit: number,
  windowSeconds: number
): Promise<NodeRateLimitResult> {
  try {
    const rpcDb = db as MediaAgentRpcDb;
    const { data, error } = await rpcDb.rpc('check_rate_limit', {
      p_ip_hash: mediaNodeId,
      p_endpoint: endpoint,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) return 'error';
    return data === false ? 'limited' : 'allowed';
  } catch {
    return 'error';
  }
}

interface AssignmentRow {
  event_id: string;
  ingest_id: string | null;
  playback_id: string | null;
  stream_secret_hash: string | null;
  enabled: boolean;
  publish_window_start_at: string | null;
  publish_window_end_at: string | null;
  config_version: number | string;
  updated_at: string;
  youtube_enabled: boolean;
}

/**
 * Loads every assignment currently enabled for the given node, selecting
 * exactly the wire-relevant columns. `youtube_secret_reference` (an opaque
 * secret-store reference, never a raw key — see migration 0020) is
 * deliberately never selected: raw YouTube stream key resolution is out of
 * scope for this slice (no YouTube provisioning here), so `youtubeStreamKey`
 * is always `''` — `isValidAssignmentSource` below is what turns that into
 * a fail-closed 503 rather than a silently-wrong assignment. Callers MUST
 * run every returned source through `isValidAssignmentSource` before
 * serving it. `youtubeDestinationBaseUrl` is server-side config per
 * migration 0020's design (not a persisted column) — the caller supplies it
 * rather than this module reading `process.env` itself.
 *
 * The non-null casts below rely on `media_event_assignments_core_eligibility_chk`
 * (migration 0020): every row with `enabled = true` is guaranteed to have
 * non-null, non-empty `ingest_id`/`playback_id`/`stream_secret_hash`/publish
 * window fields, and this query filters on `enabled = true`.
 */
export async function loadEnabledAssignmentSources(
  db: unknown,
  mediaNodeId: string,
  youtubeDestinationBaseUrl: string
): Promise<MediaAgentAssignmentSource[] | null> {
  const queryableDb = db as MediaAgentDb;
  const { data, error } = await queryableDb
    .from('media_event_assignments')
    .select(MEDIA_EVENT_ASSIGNMENTS_SELECT_COLUMNS)
    .eq('assigned_media_node_id', mediaNodeId)
    .eq('enabled', true);

  if (error) return null;
  const rows = (data ?? []) as AssignmentRow[];

  return rows.map((row) => ({
    ingestId: row.ingest_id as string,
    eventId: row.event_id,
    playbackId: row.playback_id as string,
    streamSecretHash: row.stream_secret_hash as string,
    enabled: row.enabled,
    publishWindowStartAt: row.publish_window_start_at as string,
    publishWindowEndAt: row.publish_window_end_at as string,
    configVersion: String(row.config_version),
    updatedAt: row.updated_at,
    youtubeEnabled: row.youtube_enabled,
    youtubeDestinationBaseUrl: row.youtube_enabled ? youtubeDestinationBaseUrl : '',
    youtubeStreamKey: '',
  }));
}

const STREAM_SECRET_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Validates a single assignment source before it is allowed onto the wire.
 * The Go client requires a strict lowercase 64-hex `stream_secret_hash`; a
 * row that fails this (or any other invariant) must never reach the wire.
 *
 * Any `youtubeEnabled` source currently always fails: this slice has no
 * approved YouTube secret-store resolver, `youtubeStreamKey` is always `''`
 * (see `loadEnabledAssignmentSources`), and the correct behavior for an
 * unresolvable secret is to fail the whole request closed — never to serve
 * `youtube_enabled: true` with an empty/fake key, and never to silently
 * coerce it to `false`.
 */
export function isValidAssignmentSource(source: MediaAgentAssignmentSource): boolean {
  if (!STREAM_SECRET_HASH_PATTERN.test(source.streamSecretHash)) return false;
  if (source.youtubeEnabled) {
    if (source.youtubeDestinationBaseUrl.length === 0) return false;
    if (source.youtubeStreamKey.length === 0) return false;
  }
  return true;
}
