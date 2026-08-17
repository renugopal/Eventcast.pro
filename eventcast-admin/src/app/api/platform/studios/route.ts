import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';
import { deriveEventLifecycleStatus } from '@/lib/eventLifecycle';

/**
 * GET /api/platform/studios — the cross-tenant Users and Studios roster
 * (Baseline §15, ADM-004). `requireSuperAdmin`-gated, service-role client.
 *
 * Inspection surface only. Suspend/restore, session termination, entitlement
 * changes, and trial extensions are deliberately absent: this repository has
 * no suspension state, no entitlement model (billing is deferred by
 * PLAN-007), and no session-revocation mechanism, so there is nothing
 * authoritative to drive them. A button backed by no mechanism would be
 * worse than an honest omission.
 *
 * Membership is reported as user ids and roles only. Emails, phone numbers,
 * and any other contact PII are never projected here — `platform_users`
 * carries `mobile_number` and this route never reads it.
 */

const db = supabaseAdmin || supabase;

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const [studiosResult, membersResult, eventsResult, overridesResult] = await Promise.all([
    db
      .from('studios')
      .select('id, slug, display_name, plan_tier, owner_user_id, created_at')
      .order('created_at', { ascending: false }),
    db.from('studio_members').select('studio_id, user_id, role'),
    db.from('events').select('studio_id, page_state, archived_at, scheduled_start_at'),
    db.from('studio_retention_overrides').select('studio_id, retention_days'),
  ]);

  if (studiosResult.error) {
    return NextResponse.json({ success: false, error: 'Failed to load studios' }, { status: 500 });
  }

  const memberCounts = new Map<string, number>();
  for (const row of (membersResult.data ?? []) as { studio_id: string }[]) {
    memberCounts.set(row.studio_id, (memberCounts.get(row.studio_id) ?? 0) + 1);
  }

  const eventCounts = new Map<string, { total: number; byLifecycle: Record<string, number> }>();
  for (const row of (eventsResult.data ?? []) as {
    studio_id: string;
    page_state: string | null;
    archived_at: string | null;
    scheduled_start_at: string | null;
  }[]) {
    const bucket = eventCounts.get(row.studio_id) ?? { total: 0, byLifecycle: {} };
    bucket.total += 1;
    const lifecycle = deriveEventLifecycleStatus(row);
    bucket.byLifecycle[lifecycle] = (bucket.byLifecycle[lifecycle] ?? 0) + 1;
    eventCounts.set(row.studio_id, bucket);
  }

  const overrides = new Map<string, number>();
  for (const row of (overridesResult.data ?? []) as { studio_id: string; retention_days: number }[]) {
    overrides.set(row.studio_id, row.retention_days);
  }

  const studios = ((studiosResult.data ?? []) as Record<string, unknown>[]).map((row) => {
    const id = row.id as string;
    const events = eventCounts.get(id);
    return {
      id,
      slug: row.slug,
      displayName: row.display_name,
      planTier: row.plan_tier,
      ownerUserId: row.owner_user_id,
      createdAt: row.created_at,
      memberCount: memberCounts.get(id) ?? 0,
      eventCount: events?.total ?? 0,
      eventsByLifecycle: events?.byLifecycle ?? {},
      retentionOverrideDays: overrides.get(id) ?? null,
    };
  });

  return NextResponse.json({
    success: true,
    studios,
    accountControls: {
      available: false,
      reason:
        'Suspend/restore, session termination, entitlement changes, and trial extension have no authoritative ' +
        'mechanism in this repository: no suspension state exists, billing/entitlements are deferred (PLAN-007), ' +
        'and no session-revocation path is implemented. Retention override is the one account-level control ' +
        'that is backed by a real mechanism.',
    },
  });
}
