/**
 * POST /internal/media/nodes/provision
 *
 * Operator-only Media Agent node registration. Creates a single
 * `media_nodes` row. No credential is issued here — see the separate
 * `POST /internal/media/nodes/{node_id}/credentials` route for one-time
 * credential issuance against an already-registered node.
 *
 * Authenticated by a single shared secret (`MEDIA_NODE_PROVISIONING_SECRET`),
 * checked as `Authorization: Bearer <secret>` — fail-closed if the env var
 * is unset or the presented value doesn't match, mirroring the existing
 * `CRON_SECRET` pattern in `api/cron/stream-health-monitor/route.ts`. This
 * is deliberately NOT the studio-JWT scheme every other `/api`/`/internal`
 * route uses: node registration is an infrastructure/operator action, not
 * tied to any studio's session. `src/middleware.ts` special-cases this
 * exact path (`MEDIA_AGENT_NODE_PROVISIONING_PATH`) to bypass studio-JWT
 * auth entirely, exactly like the assignments-pull route already does for
 * its own, different machine-auth scheme.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { registerMediaNode, timingSafeEqual } from '@/lib/media-agent/nodeProvisioning';

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

interface ProvisionRequestBody {
  name?: unknown;
  region?: unknown;
  ingestHostname?: unknown;
  hardStreamLimit?: unknown;
}

export async function POST(req: Request) {
  const secret = process.env.MEDIA_NODE_PROVISIONING_SECRET;
  if (!secret) return unauthorized();

  const authHeader = req.headers.get('authorization');
  const presented = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  if (!presented || !(await timingSafeEqual(presented, secret))) return unauthorized();

  const db = supabaseAdmin;
  if (!db) return unauthorized();

  let body: ProvisionRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  if (
    typeof body.name !== 'string' ||
    typeof body.region !== 'string' ||
    typeof body.ingestHostname !== 'string' ||
    (body.hardStreamLimit !== undefined && typeof body.hardStreamLimit !== 'number')
  ) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const result = await registerMediaNode(db, {
    name: body.name,
    region: body.region,
    ingestHostname: body.ingestHostname,
    hardStreamLimit: body.hardStreamLimit,
  });

  switch (result.outcome) {
    case 'registered':
      return NextResponse.json({ id: result.id, name: result.name }, { status: 201 });
    case 'conflict':
      return NextResponse.json({ error: 'conflict' }, { status: 409 });
    case 'invalid':
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    case 'error':
    default:
      return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
