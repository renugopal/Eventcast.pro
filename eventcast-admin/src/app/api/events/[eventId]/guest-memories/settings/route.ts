import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin, canMutateStudioResources } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';

/**
 * GET/PATCH /api/events/[eventId]/guest-memories/settings
 *
 * Reads/writes the event-level Guest Memories Manual Approval toggle
 * (GM-004), backed by the existing `events.guest_photo_moderation` boolean
 * column (already present, default false — matching GM-003's Auto Approval
 * default). When true, `/api/guest-photos/upload` inserts new Guest
 * Memories as `approved = false` (pending review) instead of the
 * auto-approved default.
 */

export const runtime = 'edge';

const db = supabaseAdmin || supabase;

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

interface SettingsEventRow {
  id: string;
  guest_photo_moderation: boolean | null;
}

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;
  const ownership = await getOwnedEventById<SettingsEventRow>(
    db,
    eventId,
    auth.studioId,
    'id, guest_photo_moderation'
  );
  if (isOwnershipError(ownership)) return ownership.error;

  return NextResponse.json({
    success: true,
    manualApprovalEnabled: ownership.event.guest_photo_moderation === true,
  });
}

interface SettingsUpdateBody {
  manualApprovalEnabled?: unknown;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json({ success: false, error: 'Forbidden: read-only studio role' }, { status: 403 });
  }

  const { eventId } = await params;
  const ownership = await getOwnedEventById<{ id: string }>(db, eventId, auth.studioId, 'id');
  if (isOwnershipError(ownership)) return ownership.error;
  const existing = ownership.event;

  let body: SettingsUpdateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.manualApprovalEnabled !== 'boolean') {
    return NextResponse.json({ success: false, error: 'manualApprovalEnabled must be a boolean' }, { status: 400 });
  }

  const { error: updateError } = await db
    .from('events')
    .update({ guest_photo_moderation: body.manualApprovalEnabled })
    .eq('id', existing.id)
    .eq('studio_id', auth.studioId);

  if (updateError) {
    return NextResponse.json(
      { success: false, error: 'Guest Memories settings update failed: ' + updateError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, manualApprovalEnabled: body.manualApprovalEnabled });
}
