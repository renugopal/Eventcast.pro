/**
 * POST /internal/media/nodes/{node_id}/telemetry
 *
 * Internal control-plane endpoint consumed by the Media Agent Go client
 * (`livestream-infra/services/media-agent/internal/controlplane/client.go`,
 * `ReportTelemetry`). It receives one node's current technical stream
 * telemetry for zero or more events it believes it is actively serving,
 * durable ended-session summaries, and a node heartbeat, and applies all
 * of it through the narrow `apply_media_stream_telemetry_report` RPC
 * (migration `0040`).
 *
 * Lives outside `src/app/api` for the same reason as the sibling
 * assignments/recordings routes: the Go client's request path carries no
 * `/api` prefix.
 *
 * Authenticated with the SAME node machine-auth scheme as
 * `GET .../assignments` and `POST .../recordings/{event_id}` — rotatable
 * node bearer credential, node id, per-request id, timestamp tolerance,
 * atomic replay-nonce claim, and a fail-closed node rate limit — reusing
 * those primitives verbatim rather than re-implementing them.
 *
 * Unlike the recordings route, this route does NOT call
 * `nodeHasEventActivation` itself: per-entry authorization (current
 * enabled assignment for streams, activation history for ended sessions)
 * is enforced INSIDE the RPC, because a single request can carry entries
 * for many different events at once — the RPC evaluates each entry
 * independently and skips/never-acknowledges anything this node is not
 * authorized for, exactly as documented in migration `0040`.
 *
 * Body validation here is shape-only — a cheap early reject, never the
 * security or business-rule boundary, matching the recordings route's
 * `parseBody` convention exactly. The database function remains the sole
 * authority on which entries are actually accepted.
 *
 * Every failure collapses to the same generic 401 — the same
 * non-enumerating discipline the sibling routes use — with the sole
 * exceptions of a definitive rate-limit throttle (429) and a malformed
 * body (400, which reveals nothing about the node).
 *
 * NOTE: this route's exact path shape is special-cased in
 * `src/middleware.ts` (`MEDIA_AGENT_TELEMETRY_REPORT_PATH`) to bypass
 * studio-JWT middleware. Any path change here must be mirrored there.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  parseBearerToken,
  resolveMediaNodeCredentialMatch,
  validateMediaAgentAuthStructure,
  type MediaAgentAuthHeaders,
} from '@/lib/media-agent/nodeAuth';
import {
  DECOY_MEDIA_NODE_ID,
  checkNodeRateLimit,
  claimRequestNonce,
  findMediaNodeByName,
  isCredentialEvidenceStale,
  loadActiveCredentialDigests,
  recordCredentialSlotVerified,
} from '@/lib/media-agent/nodeAssignmentsRepo';
import { MEDIA_AGENT_TIMESTAMP_TOLERANCE_MS } from '../assignments/route';

const NODE_RATE_LIMIT_MAX_REQUESTS = 60;
const NODE_RATE_LIMIT_WINDOW_SECONDS = 60;
const NODE_RATE_LIMIT_ENDPOINT = 'media/nodes/telemetry';

/**
 * Bounds the request body. A telemetry report can legitimately carry many
 * stream/session entries in one call, so this is deliberately larger than
 * the recordings route's single-report 8 KiB bound, while still being a
 * small, fixed ceiling — never unbounded.
 */
const MAX_BODY_BYTES = 256 * 1024;

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function badRequest(): NextResponse {
  return NextResponse.json({ error: 'invalid_report' }, { status: 400 });
}

/**
 * Reads req's body as raw bytes, never buffering more than maxBytes plus
 * the single in-flight chunk needed to detect an overflow (that chunk is
 * discarded immediately, never appended). Returns null the instant the
 * running total exceeds maxBytes — the reader is cancelled right away and
 * no further bytes are read. This is a real bounded streaming read, not
 * "read everything then check string length": JS string .length is
 * UTF-16 code units, not UTF-8 byte count, and req.text()/arrayBuffer()
 * would materialize an attacker-controlled body fully before any check
 * could run. Uses only the standard Web ReadableStream API, so it runs
 * unchanged on both the Node and Edge/Workers runtimes this app targets.
 */
async function readBodyBounded(req: Request, maxBytes: number): Promise<Uint8Array | null> {
  const body = req.body;
  if (!body) return new Uint8Array(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

interface TelemetryReportBody {
  node: Record<string, unknown>;
  streams: Record<string, unknown>[];
  ended_sessions: Record<string, unknown>[];
}

/**
 * Shape validation only, mirroring the recordings route's parseBody
 * convention exactly: reject anything structurally wrong (wrong types,
 * not an object/array) before it reaches the RPC, but never attempt to
 * validate individual field values here — the RPC owns every business
 * rule (required-field presence, authorization, freshness, idempotency).
 */
function parseBody(raw: unknown): TelemetryReportBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;

  const node = body.node;
  if (node !== undefined && (typeof node !== 'object' || node === null || Array.isArray(node))) {
    return null;
  }

  const streams = body.streams;
  if (streams !== undefined) {
    if (!Array.isArray(streams)) return null;
    if (streams.some((s) => typeof s !== 'object' || s === null || Array.isArray(s))) return null;
  }

  const endedSessions = body.ended_sessions;
  if (endedSessions !== undefined) {
    if (!Array.isArray(endedSessions)) return null;
    if (endedSessions.some((s) => typeof s !== 'object' || s === null || Array.isArray(s))) return null;
  }

  return {
    node: (node as Record<string, unknown>) ?? {},
    streams: (streams as Record<string, unknown>[]) ?? [],
    ended_sessions: (endedSessions as Record<string, unknown>[]) ?? [],
  };
}

function integerOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ node_id: string }> }
) {
  try {
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

    if (!pathNodeId || pathNodeId !== headers.nodeId) {
      return unauthorized();
    }

    const now = new Date();
    if (!validateMediaAgentAuthStructure(headers, now, MEDIA_AGENT_TIMESTAMP_TOLERANCE_MS)) {
      return unauthorized();
    }

    const db = supabaseAdmin;
    if (!db) return unauthorized();

    // Always resolve the node, then always run exactly one credential
    // query of the same shape — decoy id when unknown — so an unknown
    // node never skips a round trip an attacker could time against a
    // known one. Mirrors the assignments/recordings routes exactly.
    const nodeRow = await findMediaNodeByName(db, pathNodeId);
    const digests = await loadActiveCredentialDigests(db, nodeRow ? nodeRow.id : DECOY_MEDIA_NODE_ID);
    if (!digests) return unauthorized();

    const token = parseBearerToken(headers.authorization) as string;
    const credentialMatch = await resolveMediaNodeCredentialMatch(pepper, token, digests.slot1, digests.slot2);
    if (!credentialMatch.authenticated || !nodeRow) return unauthorized();

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
    if (rateLimitResult === 'error') return unauthorized();

    const expiresAt = new Date(now.getTime() + MEDIA_AGENT_TIMESTAMP_TOLERANCE_MS);
    const nonceResult = await claimRequestNonce(db, nodeRow.id, headers.requestId as string, now, expiresAt);
    if (nonceResult !== 'claimed') return unauthorized();

    // Server-only slot-verification evidence (migration 0041). Unique match
    // only; no DB request while the loaded timestamp is fresh. Best-effort,
    // never throws, never affects this response.
    const matchedSlot = credentialMatch.uniquelyMatchedSlot;
    if (matchedSlot !== null) {
      const lastVerifiedAt =
        matchedSlot === 1 ? digests.slot1LastVerifiedAt : digests.slot2LastVerifiedAt;

      if (isCredentialEvidenceStale(lastVerifiedAt, now)) {
        await recordCredentialSlotVerified(db, nodeRow.id, matchedSlot, now);
      }
    }

    const bodyBytes = await readBodyBounded(req, MAX_BODY_BYTES);
    if (bodyBytes === null) return badRequest();

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(new TextDecoder().decode(bodyBytes));
    } catch {
      return badRequest();
    }

    const body = parseBody(parsedJson);
    if (!body) return badRequest();

    // Every field below is passed through untouched — the RPC is the
    // sole authority on required-field presence, type validity (via its
    // own cast + NULL check per field), authorization, freshness, and
    // idempotency. This route never coerces a bad value into something
    // that would silently pass; a malformed jsonb element is handled by
    // the RPC's own per-entry exception isolation.
    const node = body.node;
    const { data, error } = await db.rpc('apply_media_stream_telemetry_report', {
      p_reporting_media_node_id: nodeRow.id,
      p_disk_free_bytes: integerOrNull(node.disk_free_bytes),
      p_r2_queue_bytes: integerOrNull(node.r2_queue_bytes),
      p_software_version: stringOrNull(node.software_version),
      p_config_version: stringOrNull(node.config_version),
      p_active_stream_count: integerOrNull(node.active_stream_count),
      p_streams: body.streams,
      p_ended_sessions: body.ended_sessions,
    });

    if (error) {
      // A rejected/errored call is a client-evidence problem, not an
      // auth problem — surfaced distinctly so the node can distinguish
      // it and simply retry on its next tick (every entry stays
      // unacknowledged, exactly as if this call had never happened).
      return NextResponse.json({ error: 'report_rejected' }, { status: 409 });
    }

    const acceptedSessionIds = Array.isArray(data) ? (data as string[]) : [];

    return NextResponse.json(
      {
        // Informational only today — the RPC does not report which
        // individual stream entries were written vs. skipped, since
        // current-state telemetry carries no retry state to update
        // (superseded by the next report tick either way).
        accepted_stream_event_ids: [] as string[],
        accepted_session_ids: acceptedSessionIds,
      },
      { status: 200 }
    );
  } catch {
    return unauthorized();
  }
}
