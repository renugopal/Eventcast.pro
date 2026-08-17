/**
 * GET /internal/media/nodes/{node_id}/assignments
 *
 * Internal Admin control-plane endpoint consumed by the Media Agent Go
 * client (see `livestream-infra/services/media-agent/internal/controlplane/client.go`).
 * Lives outside `src/app/api` deliberately: the Go client's actual request
 * path has no `/api` prefix, so this route must be rooted at
 * `src/app/internal/...` for the URL to match at all.
 *
 * Authenticates the request using the machine-auth primitives in
 * `@/lib/media-agent/nodeAuth`, then returns the node's current enabled
 * assignment set via the existing wire adapter.
 *
 * Every failure — missing/malformed/stale/replayed headers, an unknown
 * node, a wrong or revoked credential, a path/header node-id mismatch, a
 * rate-limit database failure, or any downstream database error —
 * collapses to the exact same generic 401 response so nothing about *why*
 * a request failed (including whether the node exists at all) is ever
 * observable from the outside. The sole intentional exceptions are a
 * definitive rate-limit throttle (429) and a fail-closed, secret-store-not-
 * implemented-yet assignment (503) — both distinct, non-auth decisions.
 *
 * NOTE: this route's exact path is special-cased in `src/middleware.ts`
 * (`MEDIA_AGENT_ASSIGNMENTS_PATH`) to bypass studio-JWT middleware — it
 * authenticates Media Agent nodes via its own bearer-token scheme, not a
 * studio user's Supabase session JWT. Any other path change here must be
 * mirrored there.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  parseBearerToken,
  validateMediaAgentAuthStructure,
  verifyMediaNodeCredential,
  type MediaAgentAuthHeaders,
} from '@/lib/media-agent/nodeAuth';
import {
  DECOY_MEDIA_NODE_ID,
  checkNodeRateLimit,
  claimRequestNonce,
  findMediaNodeByName,
  isValidAssignmentSource,
  loadActiveCredentialDigests,
  loadEnabledAssignmentSources,
} from '@/lib/media-agent/nodeAssignmentsRepo';
import { toMediaAgentAssignmentsResponseWire } from '@/lib/media-agent/assignmentAdapter';

/**
 * V1 fixed timestamp tolerance for Media Agent machine auth — the single
 * explicit server-side constant every check in this route uses. Matches the
 * 5-minute default already assumed by
 * `tests/security/media-agent-node-auth.test.ts`; no other project constant
 * for this exists yet. Also doubles as the replay-nonce TTL: `expires_at`
 * is computed as `acceptedAt + this window`, satisfying migration 0021's
 * `expires_at > accepted_at` check.
 */
export const MEDIA_AGENT_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

// Authenticated, node-scoped throttle — a strict, fail-closed helper
// (`checkNodeRateLimit`), NOT `@/lib/rateLimit`'s `enforceRateLimit` (which
// fails OPEN, correct for public unauthenticated flows but wrong here).
//
// A pre-auth, source-IP-based limit is deliberately NOT implemented here:
// this deployment's IP resolution (`getClientIp` in `src/lib/rateLimit.ts` /
// `src/middleware.ts`) falls back to the client-supplied, spoofable
// `x-forwarded-for` / `x-real-ip` headers whenever `cf-connecting-ip` is
// absent, so it is not a safe trusted-source-IP mechanism to gate an
// unauthenticated boundary on. Inventing a new one is out of scope for this
// slice; this is a documented, blocked follow-up.
const NODE_RATE_LIMIT_MAX_REQUESTS = 60;
const NODE_RATE_LIMIT_WINDOW_SECONDS = 60;
const NODE_RATE_LIMIT_ENDPOINT = 'media/nodes/assignments';

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function serviceUnavailable(): NextResponse {
  return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ node_id: string }> }
) {
  try {
    // Read the pepper only here, in route/integration code. Fail closed —
    // never fall back to a default, never log the value.
    const pepper = process.env.MEDIA_NODE_TOKEN_PEPPER;
    if (!pepper) return unauthorized();

    const { node_id: pathNodeId } = await params;

    const headers: MediaAgentAuthHeaders = {
      authorization: req.headers.get('authorization'),
      nodeId: req.headers.get('x-eventcast-node-id'),
      requestId: req.headers.get('x-eventcast-request-id'),
      idempotencyKey: req.headers.get('x-eventcast-idempotency-key'),
      timestamp: req.headers.get('x-eventcast-timestamp'),
    };

    // Path and header node id must match exactly, before anything else.
    if (!pathNodeId || pathNodeId !== headers.nodeId) {
      return unauthorized();
    }

    const now = new Date();
    if (!validateMediaAgentAuthStructure(headers, now, MEDIA_AGENT_TIMESTAMP_TOLERANCE_MS)) {
      return unauthorized();
    }

    const db = supabaseAdmin;
    if (!db) return unauthorized();

    // Always resolve the node, then ALWAYS run exactly one credential query
    // of the same shape — using a fixed decoy UUID when the node is
    // unknown — so an unknown node never skips a database round trip an
    // attacker could otherwise time against a known one.
    const nodeRow = await findMediaNodeByName(db, pathNodeId);
    const digests = await loadActiveCredentialDigests(
      db,
      nodeRow ? nodeRow.id : DECOY_MEDIA_NODE_ID
    );
    if (!digests) return unauthorized(); // credential lookup / database failure

    const token = parseBearerToken(headers.authorization) as string; // non-null: structure already validated
    const credentialOk = await verifyMediaNodeCredential(pepper, token, digests.slot1, digests.slot2);
    if (!credentialOk || !nodeRow) return unauthorized();

    // Strict, fail-closed node rate limit — immediately after credential
    // verification succeeds, and before the replay nonce is ever inserted.
    const rateLimitResult = await checkNodeRateLimit(
      db,
      nodeRow.id,
      NODE_RATE_LIMIT_ENDPOINT,
      NODE_RATE_LIMIT_MAX_REQUESTS,
      NODE_RATE_LIMIT_WINDOW_SECONDS
    );
    if (rateLimitResult === 'limited') {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    if (rateLimitResult === 'error') {
      return unauthorized();
    }

    // Replay protection: atomically claim this request_id for this node.
    const expiresAt = new Date(now.getTime() + MEDIA_AGENT_TIMESTAMP_TOLERANCE_MS);
    const nonceResult = await claimRequestNonce(
      db,
      nodeRow.id,
      headers.requestId as string, // non-null: structure already validated
      now,
      expiresAt
    );
    if (nonceResult !== 'claimed') return unauthorized(); // replay or database failure

    const assignments = await loadEnabledAssignmentSources(
      db,
      nodeRow.id,
      process.env.YOUTUBE_DESTINATION_BASE_URL ?? ''
    );
    if (!assignments) return unauthorized(); // assignment lookup failure

    // Fail closed rather than ever return an invalid or partial set — most
    // notably any youtube_enabled assignment, since no approved secret-store
    // resolver exists yet in this slice.
    if (assignments.some((assignment) => !isValidAssignmentSource(assignment))) {
      return serviceUnavailable();
    }

    const responseBody = toMediaAgentAssignmentsResponseWire({
      configVersion: nodeRow.configVersion,
      generatedAt: now.toISOString(),
      assignments,
    });

    return NextResponse.json(responseBody, { status: 200 });
  } catch {
    // Any unexpected failure collapses to the same generic response —
    // never leak internal error detail from this boundary.
    return unauthorized();
  }
}
