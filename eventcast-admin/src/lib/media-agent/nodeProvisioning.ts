/**
 * Service-role write-side helpers for Media Agent node registration,
 * one-time credential issuance, and node lifecycle transitions
 * (`media_nodes`, `media_node_credentials`).
 *
 * Slice 2 scope: create a node row, and issue a single credential digest
 * into a given slot. Reuses the exact pepper-based HMAC-SHA256 pattern
 * already proven in `nodeAuth.ts`'s `verifyMediaNodeCredential`, but for
 * signing (issuance) instead of verification. The raw credential token is
 * generated here and returned to the caller exactly once; only its digest
 * is ever persisted. Never logged.
 *
 * Slice 6 addition: `markNodeHealthy` — an operator-only
 * 'provisioning'/'degraded'/'unavailable' → 'healthy' transition. Still no
 * rotation/revocation flow, no heartbeat writer — this system has none (see
 * `FIRST_PUBLISH_VALIDATION_RUNBOOK.md`), so this transition is deliberately
 * NOT gated on any "recently synced" signal — no such signal is persisted
 * anywhere in this schema, and inventing one here would be fabricating
 * evidence of liveness this codebase doesn't actually have. It is gated on
 * everything that *is* durably knowable: the node exists, isn't retired,
 * isn't in maintenance, and has at least one active (non-revoked) issued
 * credential. An operator is still responsible for having independently
 * confirmed the Media Agent process is actually up (e.g. Slice 5's runbook,
 * "control-plane assignment sync succeeded" log line) before calling this.
 */

const NODE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

interface DbInsertResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

interface ProvisioningDb {
  from: (table: string) => {
    insert: (values: Record<string, unknown>) => {
      select: (columns: string) => { single: () => PromiseLike<DbInsertResult> };
    };
  };
}

/**
 * Constant-time string equality via Web Crypto. Both inputs are first
 * SHA-256-hashed to a fixed 32-byte digest — this removes any timing
 * signal tied to the *original* strings' lengths or content — and the two
 * digests are then compared with a branchless, full-length XOR-accumulate
 * loop rather than `===`/`!==`, so comparison time never depends on where
 * (or whether) the two values first differ. Mirrors the timing-safety
 * intent of `nodeAuth.ts`'s `crypto.subtle.verify`-based credential check,
 * for the simpler shared-secret comparison the provisioning routes need.
 * Shared by both `provision/route.ts` and `[node_id]/credentials/route.ts`.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(a)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

/** Generates a fresh, high-entropy raw credential token (32 random bytes, lowercase hex). */
export function generateRawCredentialToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * HMAC-SHA256(pepper, token) as lowercase hex — the exact digest shape
 * `media_node_credentials.digest` requires (`^[0-9a-f]{64}$`) and the exact
 * value `verifyMediaNodeCredential` in `nodeAuth.ts` will later check the
 * presented token against.
 */
export async function computeCredentialDigest(pepper: string, token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface NodeRegistrationInput {
  name: string;
  region: string;
  ingestHostname: string;
  hardStreamLimit?: number;
}

export type NodeRegistrationResult =
  | { outcome: 'registered'; id: string; name: string }
  | { outcome: 'conflict' }
  | { outcome: 'invalid' }
  | { outcome: 'error' };

/**
 * Inserts a new `media_nodes` row. Relies on the table's own UNIQUE
 * constraints on `name` and `ingest_hostname` (migration 0020) for
 * conflict detection — a Postgres unique_violation (23505) on insert is
 * the sole conflict signal, not a separate check-then-insert.
 */
export async function registerMediaNode(
  db: unknown,
  input: NodeRegistrationInput
): Promise<NodeRegistrationResult> {
  if (!NODE_NAME_PATTERN.test(input.name)) return { outcome: 'invalid' };
  if (input.region.trim().length === 0) return { outcome: 'invalid' };
  if (input.ingestHostname.trim().length === 0) return { outcome: 'invalid' };
  if (
    input.hardStreamLimit !== undefined &&
    (!Number.isInteger(input.hardStreamLimit) || input.hardStreamLimit <= 0)
  ) {
    return { outcome: 'invalid' };
  }

  const queryableDb = db as ProvisioningDb;
  const insertValues: Record<string, unknown> = {
    name: input.name,
    region: input.region,
    ingest_hostname: input.ingestHostname,
  };
  if (input.hardStreamLimit !== undefined) {
    insertValues.hard_stream_limit = input.hardStreamLimit;
  }

  const { data, error } = await queryableDb
    .from('media_nodes')
    .insert(insertValues)
    .select('id, name')
    .single();

  if (error) {
    return error.code === '23505' ? { outcome: 'conflict' } : { outcome: 'error' };
  }
  const row = data as { id: string; name: string };
  return { outcome: 'registered', id: row.id, name: row.name };
}

export type CredentialIssuanceResult =
  | { outcome: 'issued'; token: string }
  | { outcome: 'conflict' }
  | { outcome: 'invalid' }
  | { outcome: 'error' };

/**
 * Generates a fresh raw token, computes its digest, and inserts it into
 * `media_node_credentials` for the given node + slot. Relies on the
 * partial unique index `idx_media_node_credentials_active_slot`
 * (migration 0021) — at most one active (non-revoked) credential per
 * (media_node_id, slot) — for conflict detection: issuing into a slot
 * that already has an active credential fails with 23505, not a separate
 * check-then-insert. The raw token is returned to the caller exactly
 * once here; it is never itself passed to any logging call in this
 * module, and only `digest` is written to the database.
 */
export async function issueMediaNodeCredential(
  db: unknown,
  pepper: string,
  mediaNodeId: string,
  slot: number
): Promise<CredentialIssuanceResult> {
  if (slot !== 1 && slot !== 2) return { outcome: 'invalid' };

  const token = generateRawCredentialToken();
  const digest = await computeCredentialDigest(pepper, token);
  if (!DIGEST_PATTERN.test(digest)) return { outcome: 'error' }; // unreachable in practice; defensive only

  const queryableDb = db as ProvisioningDb;
  const { error } = await queryableDb
    .from('media_node_credentials')
    .insert({ media_node_id: mediaNodeId, slot, digest })
    .select('id')
    .single();

  if (error) {
    return error.code === '23505' ? { outcome: 'conflict' } : { outcome: 'error' };
  }
  return { outcome: 'issued', token };
}

interface NodeLifecycleLookupDb {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        maybeSingle: () => PromiseLike<{
          data: { id: string; status: string; maintenance_mode: boolean } | null;
          error: { message: string; code?: string } | null;
        }>;
      };
    };
  };
}

interface ActiveCredentialLookupDb {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => {
        is: (column: string, value: null) => PromiseLike<{
          data: { id: string }[] | null;
          error: { message: string; code?: string } | null;
        }>;
      };
    };
  };
}

interface NodeHealthyTransitionWriteDb {
  from: (table: string) => {
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: unknown) => {
        neq: (column: string, value: unknown) => {
          select: (columns: string) => PromiseLike<{
            data: { id: string }[] | null;
            error: { message: string; code?: string } | null;
          }>;
        };
      };
    };
  };
}

export type NodeHealthyTransitionResult =
  | { outcome: 'transitioned' }
  | { outcome: 'already_healthy' }
  | { outcome: 'node_not_found' }
  | { outcome: 'node_retired' }
  | { outcome: 'node_in_maintenance' }
  | { outcome: 'no_active_credential' }
  | { outcome: 'error' };

/**
 * Transitions `nodeName` (`media_nodes.name`) to `status = 'healthy'`.
 * Prerequisites, all checked against durably persisted state (see module
 * docblock for why no liveness/heartbeat signal is or can be checked here):
 *   - the node exists
 *   - its status is not already 'retired' (retirement is a one-way door;
 *     this function never reverses it)
 *   - `maintenance_mode` is false
 *   - it has at least one active (non-revoked) issued credential
 *
 * Already-healthy is reported as its own outcome (idempotent no-op, not an
 * error) rather than silently re-succeeding, so a caller can tell a retry
 * apart from a first-time transition. The final `UPDATE` is still guarded
 * with `.neq('status', 'retired')` even though the check above already
 * confirmed this, purely to close the narrow window where a concurrent
 * retirement could land between the read and the write — low-stakes enough
 * (unlike assignment-capacity enforcement) not to need a locking function.
 */
export async function markNodeHealthy(db: unknown, nodeName: string): Promise<NodeHealthyTransitionResult> {
  const lookupDb = db as NodeLifecycleLookupDb;
  const { data: node, error: lookupError } = await lookupDb
    .from('media_nodes')
    .select('id, status, maintenance_mode')
    .eq('name', nodeName)
    .maybeSingle();

  if (lookupError) return { outcome: 'error' };
  if (!node) return { outcome: 'node_not_found' };
  if (node.status === 'retired') return { outcome: 'node_retired' };
  if (node.maintenance_mode) return { outcome: 'node_in_maintenance' };
  if (node.status === 'healthy') return { outcome: 'already_healthy' };

  const credDb = db as ActiveCredentialLookupDb;
  const { data: activeCredentials, error: credError } = await credDb
    .from('media_node_credentials')
    .select('id')
    .eq('media_node_id', node.id)
    .is('revoked_at', null);

  if (credError) return { outcome: 'error' };
  if (!activeCredentials || activeCredentials.length === 0) {
    return { outcome: 'no_active_credential' };
  }

  const writeDb = db as NodeHealthyTransitionWriteDb;
  const { data: updated, error: updateError } = await writeDb
    .from('media_nodes')
    .update({ status: 'healthy' })
    .eq('id', node.id)
    .neq('status', 'retired')
    .select('id');

  if (updateError) return { outcome: 'error' };
  if (!updated || updated.length === 0) {
    // Concurrently retired between the read above and this write.
    return { outcome: 'node_retired' };
  }
  return { outcome: 'transitioned' };
}
