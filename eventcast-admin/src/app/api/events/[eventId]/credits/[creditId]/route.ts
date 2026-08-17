import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { getOwnedEventById, getEventCreditById, isOwnershipError } from '@/lib/ownership';
import { PARTNER_TYPES, isPartnerType } from '@/lib/partnerFields';

/**
 * PATCH / DELETE /api/events/[eventId]/credits/[creditId]
 *
 * Update editable Event Credit fields (`role_label`, `is_primary`) or detach
 * a credit. Ownership is proven twice before any mutation: first the Event
 * via getOwnedEventById (id + studio_id), then the Event Credit via
 * getEventCreditById scoped to that already-owned eventId — event_credits
 * has no studio_id column of its own (migration 0030), so this is how its
 * tenant isolation is enforced at the application layer, mirroring the
 * database's own EXISTS-through-events RLS policies.
 */

const db = supabaseAdmin || supabase;

interface RouteParams {
  params: Promise<{ eventId: string; creditId: string }>;
}

interface EventRow {
  id: string;
}

interface CreditRow {
  id: string;
}

interface CreditUpdateBody {
  roleLabel?: unknown;
  isPrimary?: unknown;
}

function isPrimaryConflict(message: string): boolean {
  return message.includes('event_credits_one_primary_per_event');
}

function isDuplicateCreditConflict(message: string): boolean {
  return message.includes('event_credits_unique_event_partner_role');
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId, creditId } = await params;
  const eventOwnership = await getOwnedEventById<EventRow>(db, eventId, auth.studioId, 'id');
  if (isOwnershipError(eventOwnership)) return eventOwnership.error;

  const creditOwnership = await getEventCreditById<CreditRow>(db, creditId, eventId, 'id');
  if (isOwnershipError(creditOwnership)) return creditOwnership.error;
  const existing = creditOwnership.event;

  let body: CreditUpdateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const updatePayload: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(body, 'roleLabel')) {
    if (!isPartnerType(body.roleLabel)) {
      return NextResponse.json(
        { success: false, error: `roleLabel must be one of: ${PARTNER_TYPES.join(', ')}`, field: 'roleLabel' },
        { status: 400 }
      );
    }
    updatePayload.role_label = body.roleLabel;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'isPrimary')) {
    if (typeof body.isPrimary !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'isPrimary must be a boolean', field: 'isPrimary' },
        { status: 400 }
      );
    }
    updatePayload.is_primary = body.isPrimary;
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ success: false, error: 'No updatable fields provided' }, { status: 400 });
  }

  const { data, error } = await db
    .from('event_credits')
    .update(updatePayload)
    .eq('id', existing.id)
    .eq('event_id', eventId)
    .select('*')
    .single();

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      const message = error.message || '';
      if (isPrimaryConflict(message)) {
        return NextResponse.json(
          { success: false, error: 'This event already has a primary credit. Update or remove it before assigning a new one.' },
          { status: 409 }
        );
      }
      if (isDuplicateCreditConflict(message)) {
        return NextResponse.json(
          { success: false, error: 'This partner is already credited under that role on this event.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: false, error: 'Duplicate event credit.' }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: 'Event credit update failed: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, credit: data });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId, creditId } = await params;
  const eventOwnership = await getOwnedEventById<EventRow>(db, eventId, auth.studioId, 'id');
  if (isOwnershipError(eventOwnership)) return eventOwnership.error;

  const creditOwnership = await getEventCreditById<CreditRow>(db, creditId, eventId, 'id');
  if (isOwnershipError(creditOwnership)) return creditOwnership.error;
  const existing = creditOwnership.event;

  const { error } = await db
    .from('event_credits')
    .delete()
    .eq('id', existing.id)
    .eq('event_id', eventId);

  if (error) {
    return NextResponse.json({ success: false, error: 'Event credit deletion failed: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
