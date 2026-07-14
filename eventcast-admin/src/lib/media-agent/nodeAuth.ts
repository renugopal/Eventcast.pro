/**
 * Pure, Edge-compatible Media Agent machine-authentication primitives.
 *
 * No Supabase access, no credential-table queries, no nonce insertion, no
 * rate limiting, no audit logging, no provisioning. This module only
 * validates the shape of an already-received request (headers + a
 * caller-supplied clock) and verifies a presented bearer token against up
 * to two already-fetched credential digests. Fetching those digests from
 * `media_node_credentials`, inserting into `media_node_request_nonces`,
 * and wiring this into an actual route are all separate, later slices.
 *
 * Uses Web Crypto (`crypto.subtle`) only — never Node's `crypto` module —
 * so this runs unchanged on the Edge runtime this codebase's API routes
 * already use (see `eventcast-admin/src/lib/security.ts` for the existing,
 * proven HMAC-SHA256 sign/verify pattern this module mirrors for a
 * different purpose).
 *
 * Locked V1 wire contract (already committed): `Authorization: Bearer
 * <token>`, `X-EventCast-Node-Id`, `X-EventCast-Request-Id`,
 * `X-EventCast-Idempotency-Key`, `X-EventCast-Timestamp`. See
 * `livestream-infra/services/media-agent/internal/controlplane/client.go`.
 */

const NODE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * A fixed, valid-format, always-non-matching digest used to pad a missing
 * or malformed credential slot, so the number of `crypto.subtle.verify`
 * calls — and therefore their timing — never depends on how many real
 * active credentials a node actually has.
 */
const DECOY_DIGEST = '0'.repeat(64);

/** The raw header values this contract requires, as received from a request. */
export interface MediaAgentAuthHeaders {
  authorization: string | null | undefined;
  nodeId: string | null | undefined;
  requestId: string | null | undefined;
  idempotencyKey: string | null | undefined;
  timestamp: string | null | undefined;
}

/**
 * Minimal, generic result. Deliberately carries no detail about which
 * check failed, which slot matched, or any credential material — the
 * future route must never expose more than this boolean.
 */
export interface MediaAgentAuthResult {
  authorized: boolean;
}

/**
 * Extracts the token from `Authorization: Bearer <token>`. Returns `null`
 * for a missing header, a non-`Bearer` scheme, or an empty token —
 * mirroring `internal/operatorauth.bearerToken`'s exact prefix check.
 */
export function parseBearerToken(authorization: string | null | undefined): string | null {
  if (typeof authorization !== 'string') return null;
  const prefix = 'Bearer ';
  if (!authorization.startsWith(prefix)) return null;
  const token = authorization.slice(prefix.length);
  return token.length > 0 ? token : null;
}

/**
 * Validates every structural requirement of the V1 contract that doesn't
 * need a credential lookup: header presence/format, the node-id charset
 * and length, the request-id format, idempotency-key equality, and
 * timestamp freshness against a caller-supplied clock and tolerance.
 *
 * `now` and `toleranceMs` are both caller-supplied (never `Date.now()`
 * internally) so callers — including tests — are fully deterministic.
 */
export function validateMediaAgentAuthStructure(
  headers: MediaAgentAuthHeaders,
  now: Date,
  toleranceMs: number
): boolean {
  const token = parseBearerToken(headers.authorization);
  if (!token) return false;

  if (typeof headers.nodeId !== 'string' || !NODE_ID_PATTERN.test(headers.nodeId)) return false;

  if (typeof headers.requestId !== 'string' || !REQUEST_ID_PATTERN.test(headers.requestId)) {
    return false;
  }

  if (headers.idempotencyKey !== headers.requestId) return false;

  if (typeof headers.timestamp !== 'string' || headers.timestamp.length === 0) return false;
  const parsed = new Date(headers.timestamp);
  if (Number.isNaN(parsed.getTime())) return false;

  const diffMs = Math.abs(now.getTime() - parsed.getTime());
  return diffMs <= toleranceMs;
}

async function importPepperKey(pepper: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Copies a `Uint8Array` view's bytes into a standalone `ArrayBuffer`.
 * Some `Uint8Array`-producing APIs (e.g. `TextEncoder.encode`) are typed
 * against the wider `ArrayBufferLike`, which `crypto.subtle.verify`'s
 * `BufferSource` parameters don't accept directly under this project's
 * TypeScript/lib configuration; copying into a freshly-allocated
 * `Uint8Array` (whose `.buffer` is a concrete `ArrayBuffer`) satisfies
 * that parameter type without a cast.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Resolves a slot's digest for verification: the real digest if present
 * and correctly formatted, otherwise the fixed decoy — malformed digest
 * input (wrong length, non-hex characters) is treated exactly like a
 * missing slot rather than ever being passed through to
 * `crypto.subtle.verify`, which fails closed without throwing.
 */
function resolveSlotDigest(digest: string | null): string {
  return digest !== null && DIGEST_PATTERN.test(digest) ? digest : DECOY_DIGEST;
}

/**
 * Verifies a presented bearer token against up to two active credential
 * digests (the fixed two-slot rotation model — see
 * `media_node_credentials`). Both `crypto.subtle.verify` calls always
 * execute, in full, before either result is inspected — never a
 * short-circuit on the first — so response timing never reveals whether
 * a node has zero, one, or two real active credentials. Returns only a
 * boolean: never which slot matched.
 */
export async function verifyMediaNodeCredential(
  pepper: string,
  presentedToken: string,
  slot1Digest: string | null,
  slot2Digest: string | null
): Promise<boolean> {
  const key = await importPepperKey(pepper);
  const tokenBuffer = toArrayBuffer(new TextEncoder().encode(presentedToken));

  const digest1 = resolveSlotDigest(slot1Digest);
  const digest2 = resolveSlotDigest(slot2Digest);

  const result1 = await crypto.subtle.verify('HMAC', key, toArrayBuffer(hexToBytes(digest1)), tokenBuffer);
  const result2 = await crypto.subtle.verify('HMAC', key, toArrayBuffer(hexToBytes(digest2)), tokenBuffer);

  return result1 || result2;
}

/**
 * The single composed entry point: structural validation first (cheap,
 * no crypto), then credential verification only if structure passed.
 * Every failure — structural or credential — collapses to the same
 * `{ authorized: false }` shape; no detail about which check failed is
 * ever exposed through the return value.
 */
export async function authenticateMediaAgentRequest(
  headers: MediaAgentAuthHeaders,
  now: Date,
  toleranceMs: number,
  pepper: string,
  slot1Digest: string | null,
  slot2Digest: string | null
): Promise<MediaAgentAuthResult> {
  if (!validateMediaAgentAuthStructure(headers, now, toleranceMs)) {
    return { authorized: false };
  }

  const token = parseBearerToken(headers.authorization) as string;
  const authorized = await verifyMediaNodeCredential(pepper, token, slot1Digest, slot2Digest);
  return { authorized };
}
