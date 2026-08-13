import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';

/**
 * GET/PUT/DELETE /api/platform/studios/[studioId]/retention-override —
 * view, set/update, or clear one studio's account-level retention override
 * (the approved implementation of the Baseline's "per-user override").
 * `requireSuperAdmin`-gated.
 *
 * PUT/DELETE both call the `apply_studio_retention_override` database RPC
 * (DELETE passes `p_retention_days: null`), which mutates
 * `studio_retention_overrides` and inserts the corresponding
 * `platform_audit_log` row atomically. Setting, changing, or clearing an
 * override is a platform entitlement action and must never succeed without
 * its audit entry — the RPC guarantees that, not this route.
 *
 * A studio default change here never retroactively rewrites an
 * already-frozen event's `retention_expires_at` — `freeze_event_retention()`
 * only reads the override/default at freeze time and is write-once.
 */
export const runtime = 'edge';

const db = supabaseAdmin || supabase;

interface RouteParams {
  params: Promise<{ studioId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { studioId } = await params;

  const { data, error } = await db
    .from('studio_retention_overrides')
    .select('retention_days, updated_at')
    .eq('studio_id', studioId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to load studio retention override' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    studioId,
    retentionDays: data?.retention_days ?? null,
    updatedAt: data?.updated_at ?? null,
  });
}

interface PutBody {
  retentionDays?: unknown;
}

export async function PUT(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { studioId } = await params;

  let body: PutBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const days = body.retentionDays;
  if (typeof days !== 'number' || !Number.isInteger(days) || days <= 0) {
    return NextResponse.json(
      { success: false, error: 'retentionDays must be a positive integer', field: 'retentionDays' },
      { status: 400 }
    );
  }

  const { data, error } = await db.rpc('apply_studio_retention_override', {
    p_studio_id: studioId,
    p_retention_days: days,
    p_actor: auth.userId,
  });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, ...data });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { studioId } = await params;

  const { data, error } = await db.rpc('apply_studio_retention_override', {
    p_studio_id: studioId,
    p_retention_days: null,
    p_actor: auth.userId,
  });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, ...data });
}
