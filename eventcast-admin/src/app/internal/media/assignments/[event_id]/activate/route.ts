/**
 * POST /internal/media/assignments/{event_id}/activate
 *
 * Operator-only Media Agent assignment activation. Turns an existing
 * disabled draft `media_event_assignments` row (created by Slice 3's
 * `ensureDraftAssignment`) into a real, usable SRS credential: selects a
 * node, generates `ingest_id`/`playback_id`/a raw publish secret, hashes
 * the secret, and atomically enables the row.
 *
 * Authenticated the same way as Slice 2's node-provisioning routes: a
 * shared secret (`MEDIA_NODE_PROVISIONING_SECRET`) as
 * `Authorization: Bearer <secret>`, compared with the same
 * `timingSafeEqual` helper, fail-closed if unset or mismatched. This is
 * deliberately NOT studio-JWT auth — activation returns a genuine
 * high-entropy secret that must never reach a browser (see
 * `ARCHITECTURE`/session rules: browsers must never receive raw publish
 * tokens or internal URLs), so this route has no studio-facing counterpart
 * and nothing in the Admin app's own UI ever calls it.
 * `src/middleware.ts` special-cases this exact path shape to bypass
 * studio-JWT auth entirely, exactly like the sibling `/internal/media/nodes/*`
 * routes do for their own machine/operator-auth schemes.
 *
 * The raw secret is returned in this response exactly once — only on the
 * branch where this call was the one that activated the row. Every other
 * outcome (already active, no draft, no eligible node, any error) returns
 * no secret at all. Delivering that one response's contents to the
 * studio's actual encoder (OBS/Kiloview) is an explicit, out-of-band
 * operator responsibility — not something this route or any browser-facing
 * surface does.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { timingSafeEqual } from '@/lib/media-agent/nodeProvisioning';
import { activateAssignment } from '@/lib/media-agent/assignmentActivation';

export const runtime = 'edge';

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ event_id: string }> }
) {
  const secret = process.env.MEDIA_NODE_PROVISIONING_SECRET;
  if (!secret) return unauthorized();

  const authHeader = req.headers.get('authorization');
  const presented = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  if (!presented || !(await timingSafeEqual(presented, secret))) return unauthorized();

  const db = supabaseAdmin;
  if (!db) return unauthorized();

  const { event_id: eventId } = await params;

  const result = await activateAssignment(db, eventId);

  switch (result.outcome) {
    case 'activated':
      return NextResponse.json(
        {
          eventId,
          ingestUrl: `rtmp://${result.ingestHostname}/live/${result.ingestId}`,
          token: result.token,
        },
        { status: 201 }
      );
    case 'already_activated':
      return NextResponse.json({ error: 'already_activated' }, { status: 409 });
    case 'event_not_found':
      return NextResponse.json({ error: 'event_not_found' }, { status: 404 });
    case 'no_draft_assignment':
      return NextResponse.json({ error: 'no_draft_assignment' }, { status: 404 });
    case 'no_eligible_node':
      return NextResponse.json({ error: 'no_eligible_node' }, { status: 503 });
    case 'node_at_capacity':
      return NextResponse.json({ error: 'node_at_capacity' }, { status: 503 });
    case 'error':
    default:
      return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
