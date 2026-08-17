import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { getOwnedEventById, getOwnedPartnerById, isOwnershipError } from '@/lib/ownership';
import { PARTNER_TYPES, isPartnerType } from '@/lib/partnerFields';

/**
 * GET / POST /api/events/[eventId]/credits
 *
 * Event Credit attach + list (Baseline V2.1 PART-004/PART-005) against the
 * `event_credits` table (migration 0030). `role_label` reuses the exact same
 * enum as `partners.partner_type` — the migration's check constraint defines
 * an identical closed set, not free text, so it is validated with the
 * existing `isPartnerType`/`PARTNER_TYPES` rather than inventing a second
 * enum. Attach only references an existing Partner; Partner creation is out
 * of scope here.
 */

const db = supabaseAdmin || supabase;

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

interface EventRow {
  id: string;
}

interface PartnerRow {
  id: string;
}

interface CreditCreateBody {
  partnerId?: unknown;
  roleLabel?: unknown;
  isPrimary?: unknown;
}

function isPrimaryConflict(message: string): boolean {
  return message.includes('event_credits_one_primary_per_event');
}

function isDuplicateCreditConflict(message: string): boolean {
  return message.includes('event_credits_unique_event_partner_role');
}

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;
  const ownership = await getOwnedEventById<EventRow>(db, eventId, auth.studioId, 'id');
  if (isOwnershipError(ownership)) return ownership.error;

  const { data, error } = await db
    .from('event_credits')
    .select('*')
    .eq('event_id', eventId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to fetch event credits: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, credits: data || [] });
}

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;
  const eventOwnership = await getOwnedEventById<EventRow>(db, eventId, auth.studioId, 'id');
  if (isOwnershipError(eventOwnership)) return eventOwnership.error;

  let body: CreditCreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const partnerId = typeof body.partnerId === 'string' ? body.partnerId : '';
  if (!partnerId) {
    return NextResponse.json(
      { success: false, error: 'partnerId is required', field: 'partnerId' },
      { status: 400 }
    );
  }

  if (!isPartnerType(body.roleLabel)) {
    return NextResponse.json(
      { success: false, error: `roleLabel must be one of: ${PARTNER_TYPES.join(', ')}`, field: 'roleLabel' },
      { status: 400 }
    );
  }

  if (body.isPrimary !== undefined && typeof body.isPrimary !== 'boolean') {
    return NextResponse.json(
      { success: false, error: 'isPrimary must be a boolean', field: 'isPrimary' },
      { status: 400 }
    );
  }

  // Defense in depth: event_credits_insert_policy (RLS) already requires the
  // referenced partner's studio_id to match the event's studio_id, but this
  // is proven here too, before the insert, with the same non-enumerating
  // 404 the Partner API already uses for cross-tenant/nonexistent Partners.
  const partnerOwnership = await getOwnedPartnerById<PartnerRow>(db, partnerId, auth.studioId, 'id');
  if (isOwnershipError(partnerOwnership)) return partnerOwnership.error;

  const { data, error } = await db
    .from('event_credits')
    .insert([
      {
        event_id: eventId,
        partner_id: partnerId,
        role_label: body.roleLabel,
        is_primary: body.isPrimary === true,
      },
    ])
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
    return NextResponse.json({ success: false, error: 'Event credit creation failed: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, credit: data });
}
