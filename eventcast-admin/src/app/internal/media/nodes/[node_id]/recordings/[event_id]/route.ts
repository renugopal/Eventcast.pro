/**
 * POST /internal/media/nodes/{node_id}/recordings/{event_id}
 *
 * Internal control-plane endpoint consumed by the Media Agent Go client
 * (`livestream-infra/services/media-agent/internal/controlplane/client.go`,
 * `ReportRecordingState`). It receives one node's evidence about an event's
 * recording lifecycle — local finalization, B2 archival progress, gap
 * facts, and playback provenance — and applies it through the narrow
 * `apply_event_recording_transition` RPC (migration `0036`).
 *
 * Lives outside `src/app/api` for the same reason as the sibling
 * assignments route: the Go client's request path carries no `/api` prefix.
 *
 * Authenticated with the SAME node machine-auth scheme as
 * `GET .../assignments` — rotatable node bearer credential, node id,
 * per-request id, timestamp tolerance, atomic replay-nonce claim, and a
 * fail-closed node rate limit — reusing those primitives verbatim rather
 * than re-implementing them. It deliberately does NOT use the operator
 * provisioning secret: this is node-originated, not operator-originated.
 *
 * Authorization goes one step further than the assignments route. A valid
 * node credential proves *which node is calling*, not *that this node may
 * speak for this event*, so the route additionally requires an append-only
 * activation-history row binding the node to the event
 * (`nodeHasEventActivation`). Without it, any credentialed node could
 * report state for any event UUID. The transition RPC is never invoked
 * after an authorization failure.
 *
 * Every failure collapses to the same generic 401 — the same
 * non-enumerating discipline the assignments route uses — with the sole
 * exceptions of a definitive rate-limit throttle (429) and a malformed
 * body (400, which reveals nothing about the event or node).
 *
 * NOTE: this route's exact path shape is special-cased in
 * `src/middleware.ts` (`MEDIA_AGENT_RECORDING_REPORT_PATH`) to bypass
 * studio-JWT middleware. Any path change here must be mirrored there.
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
  loadActiveCredentialDigests,
  nodeHasEventActivation,
} from '@/lib/media-agent/nodeAssignmentsRepo';
// Shared with the sibling assignments endpoint so both node-authenticated
// routes enforce one timestamp-tolerance constant rather than two that
// could drift apart.
import { MEDIA_AGENT_TIMESTAMP_TOLERANCE_MS } from '../../assignments/route';

export const runtime = 'edge';

const NODE_RATE_LIMIT_MAX_REQUESTS = 60;
const NODE_RATE_LIMIT_WINDOW_SECONDS = 60;
const NODE_RATE_LIMIT_ENDPOINT = 'media/nodes/recordings';

/** Bounds the request body. The payload is a small JSON object. */
const MAX_BODY_BYTES = 8 * 1024;

const VALID_STATES = new Set([
  'not_started',
  'recording',
  'local_finalized',
  'b2_finalizing',
  'b2_finalized',
  'failed',
]);
const VALID_GAP_STATUSES = new Set(['none', 'pending_review', 'acknowledged', 'rejected']);

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function badRequest(): NextResponse {
  return NextResponse.json({ error: 'invalid_report' }, { status: 400 });
}

interface RecordingReportBody {
  state: string;
  finalization_generation?: string;
  local_finalized_at?: string;
  b2_object_key?: string;
  b2_bucket?: string;
  gap_count?: number;
  gap_status?: string;
  strong_integrity_verified?: boolean;
  covered_playback_ids?: string[];
  failure_reason?: string;
}

/**
 * Shape validation only. The database function remains the authority on
 * the transition rules, evidence completeness, and provenance — this is a
 * cheap early reject, never the security boundary.
 */
function parseBody(raw: unknown): RecordingReportBody | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;

  const state = body.state;
  if (typeof state !== 'string' || !VALID_STATES.has(state)) return null;

  if (body.gap_status !== undefined && (typeof body.gap_status !== 'string' || !VALID_GAP_STATUSES.has(body.gap_status))) {
    return null;
  }
  if (body.gap_count !== undefined && (typeof body.gap_count !== 'number' || !Number.isInteger(body.gap_count) || body.gap_count < 0)) {
    return null;
  }
  if (body.covered_playback_ids !== undefined) {
    if (!Array.isArray(body.covered_playback_ids)) return null;
    if (body.covered_playback_ids.some((id) => typeof id !== 'string')) return null;
  }

  return {
    state,
    finalization_generation: typeof body.finalization_generation === 'string' ? body.finalization_generation : undefined,
    local_finalized_at: typeof body.local_finalized_at === 'string' ? body.local_finalized_at : undefined,
    b2_object_key: typeof body.b2_object_key === 'string' ? body.b2_object_key : undefined,
    b2_bucket: typeof body.b2_bucket === 'string' ? body.b2_bucket : undefined,
    gap_count: typeof body.gap_count === 'number' ? body.gap_count : undefined,
    gap_status: typeof body.gap_status === 'string' ? body.gap_status : undefined,
    strong_integrity_verified: body.strong_integrity_verified === true,
    covered_playback_ids: Array.isArray(body.covered_playback_ids)
      ? (body.covered_playback_ids as string[])
      : undefined,
    failure_reason: typeof body.failure_reason === 'string' ? body.failure_reason : undefined,
  };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ node_id: string; event_id: string }> }
) {
  try {
    const pepper = process.env.MEDIA_NODE_TOKEN_PEPPER;
    if (!pepper) return unauthorized();

    const { node_id: pathNodeId, event_id: eventId } = await params;

    const headers: MediaAgentAuthHeaders = {
      authorization: req.headers.get('authorization'),
      nodeId: req.headers.get('x-eventcast-node-id'),
      requestId: req.headers.get('x-eventcast-request-id'),
      idempotencyKey: req.headers.get('x-eventcast-idempotency-key'),
      timestamp: req.headers.get('x-eventcast-timestamp'),
    };

    if (!pathNodeId || pathNodeId !== headers.nodeId || !eventId) {
      return unauthorized();
    }

    const now = new Date();
    if (!validateMediaAgentAuthStructure(headers, now, MEDIA_AGENT_TIMESTAMP_TOLERANCE_MS)) {
      return unauthorized();
    }

    const db = supabaseAdmin;
    if (!db) return unauthorized();

    // Always resolve the node, then always run exactly one credential query
    // of the same shape — decoy id when unknown — so an unknown node never
    // skips a round trip an attacker could time against a known one.
    const nodeRow = await findMediaNodeByName(db, pathNodeId);
    const digests = await loadActiveCredentialDigests(db, nodeRow ? nodeRow.id : DECOY_MEDIA_NODE_ID);
    if (!digests) return unauthorized();

    const token = parseBearerToken(headers.authorization) as string;
    const credentialOk = await verifyMediaNodeCredential(pepper, token, digests.slot1, digests.slot2);
    if (!credentialOk || !nodeRow) return unauthorized();

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

    // Authorization: this node must have genuinely produced a recording for
    // this event. Checked BEFORE the body is trusted and before any RPC
    // call, so a cross-node report can never reach the state machine.
    const activation = await nodeHasEventActivation(db, eventId, nodeRow.id);
    if (activation !== 'authorized') return unauthorized();

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) return badRequest();

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return badRequest();
    }

    const body = parseBody(parsedJson);
    if (!body) return badRequest();

    const { data, error } = await db.rpc('apply_event_recording_transition', {
      p_event_id: eventId,
      p_target_state: body.state,
      p_finalization_generation: body.finalization_generation ?? null,
      p_local_finalized_at: body.local_finalized_at ?? null,
      p_b2_object_key: body.b2_object_key ?? null,
      p_b2_bucket: body.b2_bucket ?? null,
      p_gap_count: body.gap_count ?? null,
      p_gap_status: body.gap_status ?? null,
      p_strong_integrity_verified: body.strong_integrity_verified === true,
      p_failure_reason: body.failure_reason ?? null,
      // Always the AUTHENTICATED node's id, never a body field — a spoofed
      // node id in the payload cannot influence the provenance gate.
      p_reporting_media_node_id: nodeRow.id,
      p_covered_playback_ids: body.covered_playback_ids ?? null,
    });

    if (error) {
      // A rejected transition is a client-evidence problem, not an auth
      // problem, and the node needs to distinguish it in order to stop
      // retrying. It carries no information about other tenants or events.
      return NextResponse.json({ error: 'transition_rejected' }, { status: 409 });
    }

    const recording = data as {
      recording_state: string;
      finalization_generation: string | null;
      integrity_verified_at: string | null;
    } | null;

    // Retention may freeze only once the recording genuinely holds both
    // authoritative B2 finalization and strong integrity verification. The
    // RPC refuses to grant the latter without eligible gap evidence and
    // single-node provenance, and `freeze_event_retention` (migration 0035)
    // independently re-checks its own preconditions, so this call is safe
    // and fail-closed on both sides.
    if (recording?.recording_state === 'b2_finalized' && recording.integrity_verified_at) {
      await db.rpc('freeze_event_retention', { p_event_id: eventId });
    }

    return NextResponse.json(
      {
        recording_state: recording?.recording_state ?? null,
        finalization_generation: recording?.finalization_generation ?? null,
        event_authoritative:
          recording?.recording_state === 'b2_finalized' &&
          recording.finalization_generation === (body.finalization_generation ?? null),
      },
      { status: 200 }
    );
  } catch {
    return unauthorized();
  }
}
