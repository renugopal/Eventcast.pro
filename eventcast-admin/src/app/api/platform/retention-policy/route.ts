import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';

/**
 * GET/PATCH /api/platform/retention-policy — the global default
 * retention-days singleton. `requireSuperAdmin`-gated.
 *
 * PATCH calls the `apply_platform_retention_policy_update` database RPC,
 * which updates the singleton and inserts its platform_audit_log row inside
 * one transaction — the policy update can never succeed without its audit
 * entry, or vice versa. This route never accepts an arbitrary `before`/
 * `after` payload; the RPC derives both from the database itself.
 */

const db = supabaseAdmin || supabase;

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await db
    .from('platform_retention_policy')
    .select('default_retention_days, updated_at')
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ success: false, error: 'Failed to load retention policy' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    defaultRetentionDays: data.default_retention_days,
    updatedAt: data.updated_at,
  });
}

interface PatchBody {
  defaultRetentionDays?: unknown;
}

export async function PATCH(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const days = body.defaultRetentionDays;
  if (typeof days !== 'number' || !Number.isInteger(days) || days <= 0) {
    return NextResponse.json(
      { success: false, error: 'defaultRetentionDays must be a positive integer', field: 'defaultRetentionDays' },
      { status: 400 }
    );
  }

  const { data, error } = await db.rpc('apply_platform_retention_policy_update', {
    p_new_default_days: days,
    p_actor: auth.userId,
  });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    defaultRetentionDays: data.default_retention_days,
    updatedAt: data.updated_at,
  });
}
