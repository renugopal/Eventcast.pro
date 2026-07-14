/**
 * Service-role write-side helpers for Media Agent node registration and
 * one-time credential issuance (`media_nodes`, `media_node_credentials`).
 *
 * Slice 2 scope only: create a node row, and issue a single credential
 * digest into a given slot. No rotation/revocation flow, no assignment
 * writers, no heartbeat writer — those are later slices. Reuses the exact
 * pepper-based HMAC-SHA256 pattern already proven in `nodeAuth.ts`'s
 * `verifyMediaNodeCredential`, but for signing (issuance) instead of
 * verification.
 *
 * The raw credential token is generated here and returned to the caller
 * exactly once; only its digest is ever persisted. Never logged.
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
