import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';

/**
 * GET /api/platform/security — the Security surface (Baseline §15
 * "Security"). `requireSuperAdmin`-gated, service-role client.
 *
 * Answers the two questions this repository can answer authoritatively:
 * who currently holds a platform role, and what the recent audited platform
 * activity looks like in aggregate.
 *
 * Secret boundary, stated explicitly because `platform_users` is a
 * PII-carrying table: `mobile_number` is never selected or projected here.
 * Only the boolean `mobile_verified` is surfaced, which is the operationally
 * meaningful fact (AUTH-001) without disclosing the number itself. No
 * password, OTP value, session token, refresh token, or provisioning
 * credential is reachable from this route.
 */
export const runtime = 'edge';

const db = supabaseAdmin || supabase;

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const [platformUsersResult, auditResult] = await Promise.all([
    db
      .from('platform_users')
      .select('user_id, platform_role, mobile_verified, created_at')
      .order('created_at', { ascending: true }),
    db
      .from('platform_audit_log')
      .select('action, actor_user_id, created_at')
      .order('created_at', { ascending: false })
      .limit(500),
  ]);

  if (platformUsersResult.error) {
    return NextResponse.json({ success: false, error: 'Failed to load platform roles' }, { status: 500 });
  }

  const auditRows = (auditResult.data ?? []) as { action: string; actor_user_id: string; created_at: string }[];

  const actionCounts: Record<string, number> = {};
  const actorCounts: Record<string, number> = {};
  for (const row of auditRows) {
    actionCounts[row.action] = (actionCounts[row.action] ?? 0) + 1;
    actorCounts[row.actor_user_id] = (actorCounts[row.actor_user_id] ?? 0) + 1;
  }

  return NextResponse.json({
    success: true,
    platformUsers: ((platformUsersResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
      userId: row.user_id,
      platformRole: row.platform_role,
      mobileVerified: row.mobile_verified,
      createdAt: row.created_at,
    })),
    auditActivity: {
      // Scoped to the most recent 500 audited actions, stated so the counts
      // are never mistaken for all-time totals.
      sampleSize: auditRows.length,
      mostRecentAt: auditRows[0]?.created_at ?? null,
      byAction: actionCounts,
      byActor: actorCounts,
    },
    sessionControls: {
      available: false,
      reason:
        'Session listing and revocation are not implemented. Supabase Auth remains the sole session authority ' +
        'and this repository exposes no session-management path.',
    },
  });
}
