import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';
import { writeAuditLog } from '@/lib/platformAudit';

/**
 * POST /api/platform/support/[ticketId]/access — reason-gated, audited read
 * of one Support thread's message bodies (ADM-007, ADM-008).
 *
 * Deliberately a POST rather than a GET: reading private customer content is
 * an accountable act, not a free browse. A non-empty reason is mandatory,
 * and the audit row is written **before** any message body is returned, so a
 * failure to record the access can never result in content being disclosed
 * anyway. The audit row carries the ticket identity, the studio, the message
 * count, and the stated reason — never a message body.
 */
export const runtime = 'edge';

const db = supabaseAdmin || supabase;

interface RouteParams {
  params: Promise<{ ticketId: string }>;
}

interface PostBody {
  reason?: unknown;
}

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { ticketId } = await params;

  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.reason !== 'string' || body.reason.trim() === '') {
    return NextResponse.json(
      { success: false, error: 'A non-empty reason is required to read a support thread', field: 'reason' },
      { status: 400 }
    );
  }
  const reason = body.reason.trim();

  const { data: ticket, error: ticketError } = await db
    .from('support_tickets')
    .select('id, studio_id, event_id, subject, category, status, created_at, updated_at, closed_at')
    .eq('id', ticketId)
    .maybeSingle();

  if (ticketError) {
    return NextResponse.json({ success: false, error: 'Failed to load support ticket' }, { status: 500 });
  }
  if (!ticket) {
    return NextResponse.json({ success: false, error: 'Support ticket not found' }, { status: 404 });
  }

  const { data: messageRows, error: messagesError } = await db
    .from('support_ticket_messages')
    .select('id, author_user_id, body, created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  if (messagesError) {
    return NextResponse.json({ success: false, error: 'Failed to load support thread' }, { status: 500 });
  }

  const messages = (messageRows ?? []) as { id: string; author_user_id: string | null; body: string; created_at: string }[];

  // Audit first: no message body is returned unless this succeeds.
  const audit = await writeAuditLog({
    actorUserId: auth.userId,
    action: 'support_thread_accessed',
    targetType: 'support_ticket',
    targetId: ticketId,
    reason,
    before: {},
    after: { studioId: ticket.studio_id as string, messageCount: messages.length },
  });

  if (audit.error) {
    return NextResponse.json(
      { success: false, error: 'Access denied: the required audit entry could not be recorded' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    ticket: {
      id: ticket.id,
      studioId: ticket.studio_id,
      eventId: ticket.event_id,
      subject: ticket.subject,
      category: ticket.category,
      status: ticket.status,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      closedAt: ticket.closed_at,
    },
    messages: messages.map((row) => ({
      id: row.id,
      authorUserId: row.author_user_id,
      body: row.body,
      createdAt: row.created_at,
    })),
    accessRecorded: true,
  });
}
