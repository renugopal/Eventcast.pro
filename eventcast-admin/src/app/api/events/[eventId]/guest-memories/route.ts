import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';

/**
 * GET /api/events/[eventId]/guest-memories
 *
 * Lists every Guest Memory (guest_photos row, GM-001 renamed from Guest
 * Photo Wall) for an owned event — including unapproved/pending ones, since
 * this is the provider moderation view (GM-005: providers can review and
 * later hide/reject/delete regardless of the default publishing mode). The
 * public-facing page only ever reads `approved = true` rows (unchanged,
 * existing `guest_photos_public_select` RLS policy) — this route is the
 * authenticated studio-side counterpart, scoped by event ownership before
 * any row is read. Storage usage/bytes stay out of the response
 * (DASH-003/PLAN-006: storage remains a Super Admin concern in V1).
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
    .from('guest_photos')
    .select('id, photo_url, uploader_name, approved, created_at')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to load Guest Memories: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, guestMemories: data ?? [] });
}
