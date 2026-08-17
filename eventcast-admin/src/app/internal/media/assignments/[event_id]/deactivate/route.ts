/**
 * POST /internal/media/assignments/{event_id}/deactivate
 *
 * Operator-only, idempotent release of an activated
 * `media_event_assignments` row — the capacity-release counterpart to
 * `.../activate/route.ts`. Flips `enabled` from `true` to `false` via the
 * `deactivate_media_event_assignment` SQL function (migration 0026),
 * freeing the node capacity that assignment occupied; never deletes the
 * row or clears its historical fields.
 *
 * Authenticated identically to the activation route: a shared secret
 * (`MEDIA_NODE_PROVISIONING_SECRET`) as `Authorization: Bearer <secret>`,
 * compared with the same `timingSafeEqual` helper, fail-closed if unset or
 * mismatched. `src/middleware.ts` special-cases this exact path shape to
 * bypass studio-JWT auth, exactly like the sibling activation/status
 * routes do — this route has no studio-facing counterpart.
 *
 * Both `deactivated` and `already_inactive` return HTTP 200 — deactivation
 * must be safe to call repeatedly (a retry, or a second "End Live" click)
 * without erroring or re-mutating the row. There is nothing secret to
 * return on any branch of this route.
 *
 * This route provides operator-triggered capacity release only — nothing
 * in the existing codebase calls it automatically on event end (VOD
 * finalization touches only the Media Agent's own local SQLite state,
 * never `media_event_assignments`). See
 * `livestream-infra/08_OPERATIONS_RUNBOOK.md`'s "Manual End Live" section
 * for the documented, operator-driven usage.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { timingSafeEqual } from '@/lib/media-agent/nodeProvisioning';
import { deactivateAssignment } from '@/lib/media-agent/assignmentDeactivation';

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

  const result = await deactivateAssignment(db, eventId);

  switch (result.outcome) {
    case 'deactivated':
      return NextResponse.json({ eventId, outcome: 'deactivated' }, { status: 200 });
    case 'already_inactive':
      return NextResponse.json({ eventId, outcome: 'already_inactive' }, { status: 200 });
    case 'event_not_found':
      return NextResponse.json({ error: 'event_not_found' }, { status: 404 });
    case 'no_assignment':
      return NextResponse.json({ error: 'no_assignment' }, { status: 404 });
    case 'error':
    default:
      return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
