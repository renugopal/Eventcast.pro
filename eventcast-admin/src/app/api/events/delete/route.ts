import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin, canMutateStudioResources } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';

interface ArchivableEventRow {
  id: string;
}

// Use admin client if available (bypasses RLS)
const db = supabaseAdmin || supabase;

/**
 * POST /api/events/delete — soft-archive only. Permanent deletion now lives
 * exclusively at POST /api/events/[eventId]/permanent-delete, which applies
 * its own guard chain (archived-first, live/recording/retention safety,
 * typed confirmation) and can never be reached from this route. The
 * previous `permanent: true` branch — which hard-deleted the row here with
 * none of those guards — has been removed, not merely deprecated.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json(
      { success: false, error: 'Forbidden: only an owner or admin may archive an event' },
      { status: 403 }
    );
  }

  try {
    const { id, permanent } = await req.json();

    // The old hard-delete path took the same body shape as archive, one
    // boolean away from irreversible — reject it explicitly rather than
    // silently reinterpreting a `permanent: true` request as an archive,
    // so an old/stale caller gets a clear error instead of a surprising
    // behavior change.
    if (permanent === true) {
      return NextResponse.json(
        {
          success: false,
          error: 'Permanent delete has moved: use POST /api/events/[eventId]/permanent-delete instead.',
        },
        { status: 400 }
      );
    }

    // Verify ownership before any mutation. Cross-tenant and nonexistent
    // events return the same generic response, so resource existence is
    // never leaked.
    const ownership = await getOwnedEventById<ArchivableEventRow>(db, id, auth.studioId, 'id');
    if (isOwnershipError(ownership)) return ownership.error;
    const event = ownership.event;

    const { error: archiveError } = await db
      .from('events')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', event.id)
      .eq('studio_id', auth.studioId);

    if (archiveError) throw new Error(`Soft Delete Error: ${archiveError.message}`);
    return NextResponse.json({ success: true, message: 'Event archived successfully' });

  } catch (error: any) {
    console.error("Delete Endpoint Error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
