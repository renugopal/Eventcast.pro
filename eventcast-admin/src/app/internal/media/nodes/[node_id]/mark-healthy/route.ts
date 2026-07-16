/**
 * POST /internal/media/nodes/{node_id}/mark-healthy
 *
 * Operator-only node lifecycle transition: moves an existing, non-retired,
 * non-maintenance node with at least one active credential from its current
 * status (in practice 'provisioning', 'degraded', or 'unavailable') to
 * 'healthy'. `node_id` in the path is `media_nodes.name`, resolved the same
 * way the sibling `.../credentials` and `.../assignments` routes resolve
 * their own `node_id` segment.
 *
 * Authenticated identically to the sibling node-provisioning and
 * assignment-activation routes: a shared secret
 * (`MEDIA_NODE_PROVISIONING_SECRET`) as `Authorization: Bearer <secret>`,
 * `timingSafeEqual`-compared, fail-closed if unset or mismatched. No
 * studio-facing counterpart exists or is planned; `src/middleware.ts`
 * special-cases this exact path shape to bypass studio-JWT auth, exactly
 * like its sibling `/internal/media/nodes/*` routes do.
 *
 * This route cannot make a node healthy "because an arbitrary caller asked"
 * — see `markNodeHealthy` (`nodeProvisioning.ts`) for the full prerequisite
 * list and, importantly, why no liveness/heartbeat check is or can be
 * performed here: this system persists no such signal anywhere. An operator
 * calling this endpoint is still responsible for having independently
 * confirmed the target Media Agent process is actually up and syncing
 * before doing so.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { markNodeHealthy, timingSafeEqual } from '@/lib/media-agent/nodeProvisioning';

export const runtime = 'edge';

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
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

  const db = supabaseAdmin;
  if (!db) return unauthorized();

  const { node_id: nodeName } = await params;

  const result = await markNodeHealthy(db, nodeName);

  switch (result.outcome) {
    case 'transitioned':
      return NextResponse.json({ node: nodeName, status: 'healthy' }, { status: 200 });
    case 'already_healthy':
      return NextResponse.json({ node: nodeName, status: 'healthy' }, { status: 200 });
    case 'node_not_found':
      return NextResponse.json({ error: 'node_not_found' }, { status: 404 });
    case 'node_retired':
      return NextResponse.json({ error: 'node_retired' }, { status: 409 });
    case 'node_in_maintenance':
      return NextResponse.json({ error: 'node_in_maintenance' }, { status: 409 });
    case 'no_active_credential':
      return NextResponse.json({ error: 'no_active_credential' }, { status: 409 });
    case 'error':
    default:
      return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
