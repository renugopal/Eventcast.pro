/**
 * POST /internal/media/nodes/{node_id}/credentials
 *
 * Operator-only, one-time Media Agent node credential issuance. `node_id`
 * in the path is the node's `media_nodes.name` (the same convention the
 * sibling `.../assignments` route uses for its own `node_id` path
 * segment), resolved via the existing `findMediaNodeByName` helper.
 *
 * Authenticated the same way as `POST /internal/media/nodes/provision`:
 * a shared secret (`MEDIA_NODE_PROVISIONING_SECRET`) as
 * `Authorization: Bearer <secret>`, fail-closed if unset or mismatched.
 * `src/middleware.ts` special-cases this exact path shape to bypass
 * studio-JWT auth, exactly like the sibling `.../assignments` route does
 * for its own machine-auth scheme.
 *
 * The raw credential token is generated and returned in this response
 * exactly once. Only its HMAC-SHA256(pepper, token) digest — computed via
 * the same pepper-based construction `nodeAuth.ts` already uses for
 * verification — is ever persisted (`media_node_credentials.digest`). The
 * raw token is never logged and never stored anywhere else.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { findMediaNodeByName } from '@/lib/media-agent/nodeAssignmentsRepo';
import { issueMediaNodeCredential, timingSafeEqual } from '@/lib/media-agent/nodeProvisioning';

export const runtime = 'edge';

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

interface CredentialsRequestBody {
  slot?: unknown;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ node_id: string }> }
) {
  const secret = process.env.MEDIA_NODE_PROVISIONING_SECRET;
  if (!secret) return unauthorized();

  const authHeader = req.headers.get('authorization');
  const presented = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  if (!presented || !(await timingSafeEqual(presented, secret))) return unauthorized();

  const pepper = process.env.MEDIA_NODE_TOKEN_PEPPER;
  if (!pepper) return unauthorized();

  const db = supabaseAdmin;
  if (!db) return unauthorized();

  const { node_id: nodeName } = await params;

  let body: CredentialsRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  if (typeof body.slot !== 'number' || (body.slot !== 1 && body.slot !== 2)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const node = await findMediaNodeByName(db, nodeName);
  if (!node) return NextResponse.json({ error: 'node_not_found' }, { status: 404 });

  const result = await issueMediaNodeCredential(db, pepper, node.id, body.slot);

  switch (result.outcome) {
    case 'issued':
      return NextResponse.json(
        { nodeId: node.id, slot: body.slot, token: result.token },
        { status: 201 }
      );
    case 'conflict':
      return NextResponse.json({ error: 'conflict' }, { status: 409 });
    case 'invalid':
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    case 'error':
    default:
      return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
