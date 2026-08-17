import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';
import { unavailable, NO_OUTBOUND_DELIVERY_REASON } from '@/lib/platformOperations';

/**
 * GET /api/platform/notifications — cross-tenant Notification Center
 * visibility (Baseline §15 "Notification Delivery", NOT-001).
 * `requireSuperAdmin`-gated, service-role client.
 *
 * Returns notification metadata only — type, severity, title, read state,
 * dedup presence, and the owning studio/event. The `body` column is not
 * projected: it can carry event-specific detail, and this is an operational
 * delivery view rather than a content browser (ADM-007).
 *
 * `outboundDelivery` is always explicitly unavailable. Migration `0034`'s
 * table records in-app notifications only; no WhatsApp, SMS, or email
 * provider is integrated anywhere in this repository, so no "sent",
 * "delivered", or "failed" channel state exists to report and none is
 * fabricated.
 */

const db = supabaseAdmin || supabase;

const PAGE_SIZE = 50;

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
  const severityFilter = url.searchParams.get('severity');
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = db
    .from('notifications')
    .select('id, studio_id, event_id, severity, notification_type, title, dedup_key, read_at, created_at, studios(slug)', {
      count: 'exact',
    });

  if (severityFilter === 'info' || severityFilter === 'warning' || severityFilter === 'critical') {
    query = query.eq('severity', severityFilter);
  }

  const { data, error, count } = await query.order('created_at', { ascending: false }).range(from, to);

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to load notifications' }, { status: 500 });
  }

  const notifications = ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const studios = row.studios as { slug?: string } | { slug?: string }[] | null;
    const studio = Array.isArray(studios) ? studios[0] : studios;
    return {
      id: row.id,
      studioId: row.studio_id,
      studioSlug: studio?.slug ?? null,
      eventId: row.event_id,
      severity: row.severity,
      notificationType: row.notification_type,
      title: row.title,
      // Presence only — the key itself is a caller-constructed operational
      // string, not content, but the useful operational fact is whether
      // dedup was requested at all.
      deduplicated: row.dedup_key !== null,
      readAt: row.read_at,
      createdAt: row.created_at,
    };
  });

  return NextResponse.json({
    success: true,
    notifications,
    page,
    pageSize: PAGE_SIZE,
    total: count ?? notifications.length,
    outboundDelivery: unavailable(NO_OUTBOUND_DELIVERY_REASON),
  });
}
