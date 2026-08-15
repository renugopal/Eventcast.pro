import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin, canMutateStudioResources } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';
import { deactivateAssignment } from '@/lib/media-agent/assignmentDeactivation';

/**
 * POST /api/events/[eventId]/livestream/end
 *
 * Provider-facing safe end/deactivation control for the Live Control Room
 * (Baseline V2.1 LIV-007). Reuses `deactivateAssignment` exactly as built —
 * a single guarded `enabled: true -> false` update (migration 0026) that
 * releases the assigned node's capacity and preserves every historical
 * field (`ingest_id`, `playback_id`, publish window) rather than clearing
 * them. Idempotent: ending an already-inactive or never-activated stream is
 * not an error.
 *
 * This route only ever touches `media_event_assignments.enabled`. It never
 * deletes the Event, the public page, media, Event Credits, or the YouTube
 * watch-link field, and it performs no SRS/Media Agent node restart or
 * arbitrary infrastructure action — exactly the "safe end/control behavior"
 * boundary this package is scoped to.
 */

export const runtime = 'edge';

const db = supabaseAdmin || supabase;

interface LivestreamEventRow {
  id: string;
}

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json({ success: false, error: 'Forbidden: read-only studio role' }, { status: 403 });
  }

  const { eventId } = await params;
  const ownership = await getOwnedEventById<LivestreamEventRow>(db, eventId, auth.studioId, 'id');
  if (isOwnershipError(ownership)) return ownership.error;
  const event = ownership.event;

  const result = await deactivateAssignment(db, event.id);

  switch (result.outcome) {
    case 'deactivated':
      return NextResponse.json({ success: true, status: 'deactivated' });
    case 'already_inactive':
      return NextResponse.json({ success: true, status: 'already_inactive' });
    case 'event_not_found':
      return NextResponse.json({ success: false, error: 'Event not found' }, { status: 404 });
    case 'no_assignment':
      return NextResponse.json({ success: true, status: 'no_assignment' });
    case 'error':
    default:
      return NextResponse.json({ success: false, error: 'Failed to end the stream.' }, { status: 500 });
  }
}
