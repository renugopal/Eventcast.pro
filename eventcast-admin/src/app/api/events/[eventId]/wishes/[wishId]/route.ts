import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin, canMutateStudioResources } from '@/lib/auth';
import { getOwnedEventById, getWishById, isOwnershipError } from '@/lib/ownership';

/**
 * PATCH/DELETE /api/events/[eventId]/wishes/[wishId]
 *
 * Provider moderation actions on one Wish (WISH-002: approve, pin, hide,
 * reject, delete). Every verb first proves Event ownership via
 * getOwnedEventById, then resolves the Wish via getWishById scoped to that
 * already-owned eventId — the same non-enumerating pattern as the Event
 * Credit and Guest Memory routes.
 *
 * PATCH accepts `status` ('approved' | 'hidden' | 'rejected', migration
 * 0033) and/or `isPinned` independently, so a caller can pin without
 * touching moderation status or vice versa. DELETE remains a separate,
 * permanent action distinct from `status: 'rejected'`.
 */

const db = supabaseAdmin || supabase;

const WISH_STATUSES = ['approved', 'hidden', 'rejected'] as const;
type WishStatus = (typeof WISH_STATUSES)[number];

interface RouteParams {
  params: Promise<{ eventId: string; wishId: string }>;
}

interface PatchBody {
  status?: unknown;
  isPinned?: unknown;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json({ success: false, error: 'Forbidden: read-only studio role' }, { status: 403 });
  }

  const { eventId, wishId } = await params;
  const eventOwnership = await getOwnedEventById<{ id: string }>(db, eventId, auth.studioId, 'id');
  if (isOwnershipError(eventOwnership)) return eventOwnership.error;

  const wishOwnership = await getWishById<{ id: string }>(db, wishId, eventId, 'id');
  if (isOwnershipError(wishOwnership)) return wishOwnership.error;

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const update: { status?: WishStatus; is_pinned?: boolean } = {};

  if ('status' in body) {
    if (typeof body.status !== 'string' || !WISH_STATUSES.includes(body.status as WishStatus)) {
      return NextResponse.json(
        { success: false, error: `status must be one of: ${WISH_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }
    update.status = body.status as WishStatus;
  }

  if ('isPinned' in body) {
    if (typeof body.isPinned !== 'boolean') {
      return NextResponse.json({ success: false, error: 'isPinned must be a boolean' }, { status: 400 });
    }
    update.is_pinned = body.isPinned;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: false, error: 'No recognized fields to update' }, { status: 400 });
  }

  const dbUpdate: Record<string, unknown> = {};
  if (update.status) dbUpdate.status = update.status;
  if (typeof update.is_pinned === 'boolean') dbUpdate.is_pinned = update.is_pinned;

  const { error: updateError } = await db
    .from('wishes')
    .update(dbUpdate)
    .eq('id', wishId)
    .eq('event_id', eventId);

  if (updateError) {
    return NextResponse.json({ success: false, error: 'Wish update failed: ' + updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, ...update });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json({ success: false, error: 'Forbidden: read-only studio role' }, { status: 403 });
  }

  const { eventId, wishId } = await params;
  const eventOwnership = await getOwnedEventById<{ id: string }>(db, eventId, auth.studioId, 'id');
  if (isOwnershipError(eventOwnership)) return eventOwnership.error;

  const wishOwnership = await getWishById<{ id: string }>(db, wishId, eventId, 'id');
  if (isOwnershipError(wishOwnership)) return wishOwnership.error;

  const { error: deleteError } = await db
    .from('wishes')
    .delete()
    .eq('id', wishId)
    .eq('event_id', eventId);

  if (deleteError) {
    return NextResponse.json({ success: false, error: 'Wish delete failed: ' + deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
