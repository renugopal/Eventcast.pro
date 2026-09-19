import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin, canMutateStudioResources } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';
import { permanentlyDeleteEvent } from '@/lib/eventPermanentDelete';

/**
 * POST /api/events/[eventId]/permanent-delete
 *
 * The sole manual entry point for permanently deleting an event. Requires
 * `owner`/`admin` studio role (a `member` cannot mutate lifecycle at all),
 * the event to already be archived, and a typed confirmation matching the
 * event's own slug — three independent gates before the shared guarded
 * `permanentlyDeleteEvent()` is even called, which then applies the
 * live/recording/retention safety guards itself.
 *
 * This route deliberately does NOT replace `/api/events/delete`'s soft
 * archive path or `/api/events/restore` — it exists purely for the
 * irreversible action, in a route whose name states exactly what it does.
 */

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

interface PermanentDeleteEventRow {
  id: string;
  slug: string | null;
  archived_at: string | null;
}

const db = supabaseAdmin || supabase;

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json(
      { success: false, error: 'Forbidden: only an owner or admin may permanently delete an event' },
      { status: 403 }
    );
  }

  const { eventId } = await params;

  const ownership = await getOwnedEventById<PermanentDeleteEventRow>(db, eventId, auth.studioId, 'id, slug, archived_at');
  if (isOwnershipError(ownership)) return ownership.error;
  const event = ownership.event;

  let body: { confirmSlug?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.confirmSlug !== 'string' || body.confirmSlug !== event.slug) {
    return NextResponse.json(
      { success: false, error: 'Confirmation text does not match this event\'s slug.' },
      { status: 400 }
    );
  }

  let result;
  try {
    result = await permanentlyDeleteEvent(event.id, auth.studioId, {
      type: 'manual',
      userId: auth.userId,
      platformRole: auth.platformRole,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  if (result.status === 'not_found') {
    return NextResponse.json({ success: false, error: 'Event not found' }, { status: 404 });
  }
  if (result.status === 'blocked') {
    return NextResponse.json({ success: false, error: result.message, reason: result.reason }, { status: 409 });
  }
  if (result.status === 'skipped') {
    // A race (e.g. a concurrent duplicate request) — a clear 409, not a
    // 500: nothing failed unexpectedly, the event just no longer matched
    // the expected state at delete time.
    return NextResponse.json({ success: false, error: result.message }, { status: 409 });
  }

  return NextResponse.json({ success: true, message: 'Deleted permanently', warnings: result.warnings });
}
