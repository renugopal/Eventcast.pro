import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';

/**
 * GET /api/events/[eventId]/wishes
 *
 * Lists every Wish (WISH-001, persistent text greeting, separate from Guest
 * Memories and future Live Chat) for an owned event — including hidden and
 * rejected ones, since this is the provider moderation view (WISH-002:
 * approve, pin, hide, reject, delete). Pinned first, then newest first.
 */

const db = supabaseAdmin || supabase;

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;
  const ownership = await getOwnedEventById<{ id: string }>(db, eventId, auth.studioId, 'id');
  if (isOwnershipError(ownership)) return ownership.error;

  const { data, error } = await db
    .from('wishes')
    .select('id, name, message, status, is_pinned, created_at')
    .eq('event_id', eventId)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to load Wishes: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, wishes: data ?? [] });
}
