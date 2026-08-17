import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';
import { writeAuditLog } from '@/lib/platformAudit';

/**
 * PATCH /api/platform/support/[ticketId] — platform-side triage of one
 * Support ticket's status (Baseline §15 Support, ADM-008).
 * `requireSuperAdmin`-gated, service-role client.
 *
 * Mirrors the provider route's status semantics exactly (`open`/`closed`,
 * `closed_at` set on close and cleared on reopen) rather than introducing a
 * second, platform-only status model. The before-state is read from the
 * database itself and never taken from the request body, and the audit row
 * records actor, target, before-state, after-state, and reason (ADM-008).
 *
 * Deliberately no platform reply capability: `support_ticket_messages` has
 * no authorship-role column, so a Super Admin's message would appear in the
 * provider's thread as an unattributed message from an unknown user. Making
 * a platform reply honest requires an additive schema change plus a
 * provider-surface attribution change, neither of which belongs in this
 * platform-only package.
 */

const db = supabaseAdmin || supabase;

interface RouteParams {
  params: Promise<{ ticketId: string }>;
}

const STATUSES = ['open', 'closed'] as const;
type Status = (typeof STATUSES)[number];

interface PatchBody {
  status?: unknown;
  reason?: unknown;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { ticketId } = await params;

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!STATUSES.includes(body.status as Status)) {
    return NextResponse.json(
      { success: false, error: 'status must be "open" or "closed"', field: 'status' },
      { status: 400 }
    );
  }
  const status = body.status as Status;

  if (typeof body.reason !== 'string' || body.reason.trim() === '') {
    return NextResponse.json(
      { success: false, error: 'A non-empty reason is required', field: 'reason' },
      { status: 400 }
    );
  }
  const reason = body.reason.trim();

  const { data: existing, error: existingError } = await db
    .from('support_tickets')
    .select('id, status')
    .eq('id', ticketId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ success: false, error: 'Failed to load support ticket' }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ success: false, error: 'Support ticket not found' }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error } = await db
    .from('support_tickets')
    .update({
      status,
      updated_at: nowIso,
      closed_at: status === 'closed' ? nowIso : null,
    })
    .eq('id', ticketId)
    .select('id, studio_id, event_id, subject, category, status, created_at, updated_at, closed_at')
    .single();

  if (error || !updated) {
    return NextResponse.json({ success: false, error: 'Failed to update support ticket' }, { status: 500 });
  }

  await writeAuditLog({
    actorUserId: auth.userId,
    action: 'support_ticket_status_changed',
    targetType: 'support_ticket',
    targetId: ticketId,
    reason,
    before: { status: existing.status as string },
    after: { status },
  });

  return NextResponse.json({
    success: true,
    ticket: {
      id: updated.id,
      studioId: updated.studio_id,
      eventId: updated.event_id,
      subject: updated.subject,
      category: updated.category,
      status: updated.status,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
      closedAt: updated.closed_at,
    },
  });
}
