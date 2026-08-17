import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';

/**
 * PATCH /api/notifications/[notificationId]/read
 *
 * Marks one owned notification as read. Scoped by both `id` and
 * `studio_id` in the same update statement (no separate ownership read
 * first — there is nothing else this route needs from the row), matching
 * this repository's non-enumerating pattern: a cross-tenant/nonexistent id
 * matches zero rows and gets the same generic 404 as if it never existed.
 */

const db = supabaseAdmin || supabase;

interface RouteParams {
  params: Promise<{ notificationId: string }>;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { notificationId } = await params;

  const { data, error } = await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('studio_id', auth.studioId)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to mark notification read: ' + error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ success: false, error: 'Notification not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
