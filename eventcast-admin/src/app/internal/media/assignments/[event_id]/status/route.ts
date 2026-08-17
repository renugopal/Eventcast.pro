/**
 * GET /internal/media/assignments/{event_id}/status
 *
 * Operator-only, secret-free retrieval of an event's assignment state —
 * `playback_id`, `ingest_id`, `enabled`, publish window, config version,
 * and `youtube_enabled` only. Added specifically so the manual first-publish
 * validation runbook no longer needs direct, DBA-only SQL access just to
 * retrieve `playback_id` after activation (see
 * `FIRST_PUBLISH_VALIDATION_RUNBOOK.md`, step 6, which documents that
 * workaround and its limitations).
 *
 * Deliberately a separate route from `POST .../activate`, not an addition
 * to that route's one-time response: activation's response carries a raw,
 * one-time publish token and is intentionally never retrievable again;
 * this route is safe to call repeatedly, before or after activation, and
 * never carries a secret of any kind.
 *
 * Authenticated identically to the sibling activation and node-lifecycle
 * routes: a shared secret (`MEDIA_NODE_PROVISIONING_SECRET`) as
 * `Authorization: Bearer <secret>`, `timingSafeEqual`-compared, fail-closed
 * if unset or mismatched. `src/middleware.ts` special-cases this exact path
 * shape to bypass studio-JWT auth, exactly like its sibling
 * `/internal/media/assignments/*` route does.
 */
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { timingSafeEqual } from '@/lib/media-agent/nodeProvisioning';
import { loadAssignmentStatus } from '@/lib/media-agent/assignmentStatusRepo';

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export async function GET(
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

  const result = await loadAssignmentStatus(db, eventId);

  switch (result.outcome) {
    case 'found':
      return NextResponse.json(result.status, { status: 200 });
    case 'not_found':
      return NextResponse.json({ error: 'no_assignment' }, { status: 404 });
    case 'error':
    default:
      return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
