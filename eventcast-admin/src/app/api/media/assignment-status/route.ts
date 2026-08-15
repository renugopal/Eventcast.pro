import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';
import { loadAssignmentStatus } from '@/lib/media-agent/assignmentStatusRepo';

export const runtime = 'edge';

interface OwnedEventRef {
  id: string;
}

/**
 * Studio-facing bridge onto the already-built, secret-free
 * assignmentStatusRepo/BrowserSafeAssignment projection. The only other
 * consumer of that repo (GET /internal/media/assignments/{event_id}/status)
 * is gated by the operator-only MEDIA_NODE_PROVISIONING_SECRET, not a studio
 * session, and public.media_event_assignments has RLS enabled with zero
 * anon/authenticated policies (migration 0020) — so this route exists
 * purely to apply requireAdmin() + ownership before reusing that same repo,
 * never to add a new authorization model.
 */
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const eventId = new URL(req.url).searchParams.get('eventId');
  if (!eventId) {
    return NextResponse.json({ success: false, error: 'Missing eventId' }, { status: 400 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 500 });
  }

  // Ownership check — same studio-scoped pattern every other event route
  // uses. super_admin is not special-cased: no existing route grants
  // cross-tenant event reads, so none is invented here either.
  const ownership = await getOwnedEventById<OwnedEventRef>(supabaseAdmin, eventId, auth.studioId, 'id');
  if (isOwnershipError(ownership)) return ownership.error;

  const result = await loadAssignmentStatus(supabaseAdmin, ownership.event.id);

  if (result.outcome === 'error') {
    return NextResponse.json({ success: false, error: 'Failed to load assignment status' }, { status: 500 });
  }

  if (result.outcome === 'not_found') {
    return NextResponse.json({ success: true, status: null });
  }

  return NextResponse.json({ success: true, status: result.status });
}
