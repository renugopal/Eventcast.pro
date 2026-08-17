import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';

/**
 * GET /api/platform/audit-log — paginated read of `platform_audit_log`.
 * `requireSuperAdmin`-gated, service-role client.
 *
 * Optional `action`, `targetType`, and `targetId` query filters narrow the
 * same read; they never widen it. The audit log is append-only from the
 * application's side (migration `0035` grants service_role SELECT and INSERT
 * only), so this route offers no mutation verb of any kind.
 */

const db = supabaseAdmin || supabase;

const PAGE_SIZE = 50;

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = db
    .from('platform_audit_log')
    .select('id, actor_user_id, actor_platform_role, action, target_type, target_id, reason, before_state, after_state, created_at', {
      count: 'exact',
    });

  const actionFilter = url.searchParams.get('action');
  const targetTypeFilter = url.searchParams.get('targetType');
  const targetIdFilter = url.searchParams.get('targetId');
  if (actionFilter) query = query.eq('action', actionFilter);
  if (targetTypeFilter) query = query.eq('target_type', targetTypeFilter);
  if (targetIdFilter) query = query.eq('target_id', targetIdFilter);

  const { data, error, count } = await query.order('created_at', { ascending: false }).range(from, to);

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to load audit log' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    entries: (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id,
      actorUserId: row.actor_user_id,
      actorPlatformRole: row.actor_platform_role,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      reason: row.reason,
      beforeState: row.before_state,
      afterState: row.after_state,
      createdAt: row.created_at,
    })),
    page,
    pageSize: PAGE_SIZE,
    total: count ?? 0,
  });
}
