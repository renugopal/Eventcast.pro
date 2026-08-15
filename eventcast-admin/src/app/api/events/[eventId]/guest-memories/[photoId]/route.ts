import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin, canMutateStudioResources } from '@/lib/auth';
import { getOwnedEventById, getGuestPhotoById, isOwnershipError } from '@/lib/ownership';

/**
 * PATCH/DELETE /api/events/[eventId]/guest-memories/[photoId]
 *
 * Provider moderation actions on one Guest Memory (GM-005: providers can
 * hide, reject, or delete regardless of the default publishing mode). Every
 * verb first proves Event ownership via getOwnedEventById, then resolves
 * the Guest Memory via getGuestPhotoById scoped to that already-owned
 * eventId — the same non-enumerating pattern as the Event Credit routes.
 *
 * PATCH only ever toggles `approved` (approve a pending item, or hide an
 * approved one back to pending/hidden) — there is no separate "rejected"
 * state in the current schema (guest_photos has no status column beyond
 * `approved`), so "reject" is represented as DELETE, which this route
 * already exposes. The R2 object itself is intentionally not deleted here,
 * matching the existing deferred-cleanup precedent on thumbnail
 * replacement — only the guest_photos row is removed.
 */

export const runtime = 'edge';

const db = supabaseAdmin || supabase;

interface RouteParams {
  params: Promise<{ eventId: string; photoId: string }>;
}

interface GuestPhotoRow {
  id: string;
  approved: boolean | null;
}

interface PatchBody {
  approved?: unknown;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json({ success: false, error: 'Forbidden: read-only studio role' }, { status: 403 });
  }

  const { eventId, photoId } = await params;
  const eventOwnership = await getOwnedEventById<{ id: string }>(db, eventId, auth.studioId, 'id');
  if (isOwnershipError(eventOwnership)) return eventOwnership.error;

  const photoOwnership = await getGuestPhotoById<GuestPhotoRow>(db, photoId, eventId, 'id, approved');
  if (isOwnershipError(photoOwnership)) return photoOwnership.error;

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.approved !== 'boolean') {
    return NextResponse.json({ success: false, error: 'approved must be a boolean' }, { status: 400 });
  }

  const { error: updateError } = await db
    .from('guest_photos')
    .update({ approved: body.approved })
    .eq('id', photoId)
    .eq('event_id', eventId);

  if (updateError) {
    return NextResponse.json(
      { success: false, error: 'Guest Memory update failed: ' + updateError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, approved: body.approved });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json({ success: false, error: 'Forbidden: read-only studio role' }, { status: 403 });
  }

  const { eventId, photoId } = await params;
  const eventOwnership = await getOwnedEventById<{ id: string }>(db, eventId, auth.studioId, 'id');
  if (isOwnershipError(eventOwnership)) return eventOwnership.error;

  const photoOwnership = await getGuestPhotoById<GuestPhotoRow>(db, photoId, eventId, 'id');
  if (isOwnershipError(photoOwnership)) return photoOwnership.error;

  const { error: deleteError } = await db
    .from('guest_photos')
    .delete()
    .eq('id', photoId)
    .eq('event_id', eventId);

  if (deleteError) {
    return NextResponse.json(
      { success: false, error: 'Guest Memory delete failed: ' + deleteError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
