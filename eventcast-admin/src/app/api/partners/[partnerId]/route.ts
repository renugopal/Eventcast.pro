import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin, canMutateStudioResources } from '@/lib/auth';
import { getOwnedPartnerById, isOwnershipError } from '@/lib/ownership';
import { PARTNER_TYPES, PARTNER_OPTIONAL_TEXT_FIELDS, isPartnerType } from '@/lib/partnerFields';

/**
 * PATCH / DELETE a single Partner by its stable UUID. Both verbs are scoped
 * to the requesting studio via getOwnedPartnerById before any row is
 * mutated — a cross-tenant or nonexistent id gets the same generic 404
 * (mirrors /api/events/draft/[eventId] and /api/events/[eventId]/thumbnail).
 *
 * Write authority is checked first, before the ownership lookup: migration
 * 0030 restricts partner INSERT/UPDATE/DELETE to `owner`/`admin`, and this
 * route's service-role client bypasses RLS, so the rule is enforced here.
 * A same-studio `member` gets an explicit 403 rather than the generic 404 —
 * the 404 is reserved for "you cannot see this row", which is a different
 * fact and would misreport an authorization failure.
 */

const MUTATION_FORBIDDEN = 'Forbidden: your studio role cannot modify partners';

export const runtime = 'edge';

const db = supabaseAdmin || supabase;

interface RouteParams {
  params: Promise<{ partnerId: string }>;
}

interface PartnerRow {
  id: string;
}

interface PartnerUpdateBody {
  partnerType?: unknown;
  businessName?: unknown;
  [key: string]: unknown;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json({ success: false, error: MUTATION_FORBIDDEN }, { status: 403 });
  }

  const { partnerId } = await params;
  const ownership = await getOwnedPartnerById<PartnerRow>(db, partnerId, auth.studioId, 'id');
  if (isOwnershipError(ownership)) return ownership.error;
  const existing = ownership.event;

  let body: PartnerUpdateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const updatePayload: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(body, 'partnerType')) {
    if (!isPartnerType(body.partnerType)) {
      return NextResponse.json(
        { success: false, error: `partnerType must be one of: ${PARTNER_TYPES.join(', ')}`, field: 'partnerType' },
        { status: 400 }
      );
    }
    updatePayload.partner_type = body.partnerType;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'businessName')) {
    const businessName = typeof body.businessName === 'string' ? body.businessName.trim() : '';
    if (!businessName) {
      return NextResponse.json(
        { success: false, error: 'businessName cannot be empty', field: 'businessName' },
        { status: 400 }
      );
    }
    updatePayload.business_name = businessName;
  }

  for (const [bodyKey, column] of PARTNER_OPTIONAL_TEXT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, bodyKey)) continue;
    const value = body[bodyKey];
    if (value === null || typeof value === 'string') {
      updatePayload[column] = value;
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ success: false, error: 'No updatable fields provided' }, { status: 400 });
  }

  updatePayload.updated_at = new Date().toISOString();

  const { data, error } = await db
    .from('partners')
    .update(updatePayload)
    .eq('id', existing.id)
    .eq('studio_id', auth.studioId)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: 'Partner update failed: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, partner: data });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json({ success: false, error: MUTATION_FORBIDDEN }, { status: 403 });
  }

  const { partnerId } = await params;
  const ownership = await getOwnedPartnerById<PartnerRow>(db, partnerId, auth.studioId, 'id');
  if (isOwnershipError(ownership)) return ownership.error;
  const existing = ownership.event;

  const { error } = await db
    .from('partners')
    .delete()
    .eq('id', existing.id)
    .eq('studio_id', auth.studioId);

  if (error) {
    // event_credits.partner_id has no ON DELETE clause (matching the legacy
    // events.photographer_id behavior) -- deleting a still-credited partner
    // is blocked by Postgres (FK violation, code 23503) rather than
    // silently cascading or orphaning the reference.
    if ((error as { code?: string }).code === '23503') {
      return NextResponse.json(
        { success: false, error: 'This partner is credited on one or more events and cannot be deleted.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: false, error: 'Partner deletion failed: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
