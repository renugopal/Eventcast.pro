import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';
import { deriveEventLifecycleStatus } from '@/lib/eventLifecycle';

/**
 * GET /api/platform/studios/[studioId] — one studio's operational drill-down.
 * `requireSuperAdmin`-gated, service-role client.
 *
 * Membership is user ids and roles only — never emails, phone numbers, or
 * any other contact PII. Support ticket subjects are metadata (ADM-007
 * treats message bodies, not the existence of a ticket, as private content);
 * message bodies are never returned here.
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

  const { data: studio, error: studioError } = await db
    .from('studios')
    .select('id, slug, display_name, plan_tier, owner_user_id, custom_domain, created_at')
    .eq('id', studioId)
    .maybeSingle();

  if (studioError) {
    return NextResponse.json({ success: false, error: 'Failed to load studio' }, { status: 500 });
  }
  if (!studio) {
    return NextResponse.json({ success: false, error: 'Studio not found' }, { status: 404 });
  }

  const [membersResult, eventsResult, overrideResult, ticketsResult, notificationsResult] = await Promise.all([
    db.from('studio_members').select('user_id, role, created_at').eq('studio_id', studioId),
    db
      .from('events')
      .select('id, slug, page_state, archived_at, scheduled_start_at, event_visibility, template_id')
      .eq('studio_id', studioId)
      .order('created_at', { ascending: false })
      .limit(200),
    db.from('studio_retention_overrides').select('retention_days, updated_at').eq('studio_id', studioId).maybeSingle(),
    db.from('support_tickets').select('status').eq('studio_id', studioId),
    db.from('notifications').select('severity, read_at').eq('studio_id', studioId),
  ]);

  const events = ((eventsResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id,
    slug: row.slug,
    pageState: row.page_state,
    eventVisibility: row.event_visibility,
    templateId: row.template_id,
    scheduledStartAt: row.scheduled_start_at,
    lifecycleStatus: deriveEventLifecycleStatus({
      page_state: row.page_state as string | null,
      archived_at: row.archived_at as string | null,
      scheduled_start_at: row.scheduled_start_at as string | null,
    }),
  }));

  const tickets = (ticketsResult.data ?? []) as { status: string }[];
  const notifications = (notificationsResult.data ?? []) as { severity: string; read_at: string | null }[];

  return NextResponse.json({
    success: true,
    studio: {
      id: studio.id,
      slug: studio.slug,
      displayName: studio.display_name,
      planTier: studio.plan_tier,
      ownerUserId: studio.owner_user_id,
      customDomain: studio.custom_domain,
      createdAt: studio.created_at,
    },
    members: ((membersResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
      userId: row.user_id,
      role: row.role,
      joinedAt: row.created_at,
    })),
    events,
    retentionOverride: {
      retentionDays: (overrideResult.data as { retention_days?: number } | null)?.retention_days ?? null,
      updatedAt: (overrideResult.data as { updated_at?: string } | null)?.updated_at ?? null,
    },
    supportSummary: {
      total: tickets.length,
      open: tickets.filter((ticket) => ticket.status === 'open').length,
    },
    notificationSummary: {
      total: notifications.length,
      unread: notifications.filter((row) => row.read_at === null).length,
      critical: notifications.filter((row) => row.severity === 'critical').length,
    },
  });
}
