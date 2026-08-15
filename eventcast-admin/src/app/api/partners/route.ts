import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin, canMutateStudioResources } from '@/lib/auth';
import { PARTNER_TYPES, PARTNER_OPTIONAL_TEXT_FIELDS, isPartnerType } from '@/lib/partnerFields';

/**
 * Partner directory CRUD (Baseline V2.1 PART-001/PART-002/PART-003).
 * Studio-owned reusable Partner/Client records against the new `partners`
 * table (migration 0030). Tenant ownership is always taken from the
 * authenticated server-side context (`auth.studioId`), never from a
 * client-supplied studio id.
 *
 * Authorization has two independent layers:
 *   - tenant isolation — every query is scoped by `auth.studioId`;
 *   - write authority — migration 0030 lets any studio member SELECT but
 *     restricts INSERT/UPDATE/DELETE to `owner`/`admin`. This route runs
 *     through the service-role client, which bypasses RLS, so that rule is
 *     enforced here in the application instead.
 */

const MUTATION_FORBIDDEN = 'Forbidden: your studio role cannot modify partners';

export const runtime = 'edge';

const db = supabaseAdmin || supabase;

interface PartnerCreateBody {
  partnerType?: unknown;
  businessName?: unknown;
  [key: string]: unknown;
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await db
    .from('partners')
    .select('*')
    .eq('studio_id', auth.studioId)
    .order('business_name', { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to fetch partners: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, partners: data || [] });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json({ success: false, error: MUTATION_FORBIDDEN }, { status: 403 });
  }

  let body: PartnerCreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isPartnerType(body.partnerType)) {
    return NextResponse.json(
      { success: false, error: `partnerType must be one of: ${PARTNER_TYPES.join(', ')}`, field: 'partnerType' },
      { status: 400 }
    );
  }

  const businessName = typeof body.businessName === 'string' ? body.businessName.trim() : '';
  if (!businessName) {
    return NextResponse.json(
      { success: false, error: 'businessName is required', field: 'businessName' },
      { status: 400 }
    );
  }

  const insertPayload: Record<string, unknown> = {
    studio_id: auth.studioId,
    partner_type: body.partnerType,
    business_name: businessName,
  };
  for (const [bodyKey, column] of PARTNER_OPTIONAL_TEXT_FIELDS) {
    insertPayload[column] = typeof body[bodyKey] === 'string' ? body[bodyKey] : null;
  }

  const { data, error } = await db
    .from('partners')
    .insert([insertPayload])
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: 'Partner creation failed: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, partner: data });
}
