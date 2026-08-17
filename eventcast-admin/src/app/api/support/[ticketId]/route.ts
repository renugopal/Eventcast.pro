import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { getOwnedSupportTicketById, isOwnershipError } from '@/lib/ownership';

/**
 * GET /api/support/[ticketId] — ticket detail + its full message history.
 * PATCH /api/support/[ticketId] — change status (open <-> closed).
 *
 * Both verbs prove studio ownership via `getOwnedSupportTicketById` first
 * (generic 404 for cross-tenant/nonexistent, same non-enumerating pattern
 * used across this repository).
 */

const db = supabaseAdmin || supabase;

interface RouteParams {
  params: Promise<{ ticketId: string }>;
}

const STATUSES = ['open', 'closed'] as const;
type Status = (typeof STATUSES)[number];

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { ticketId } = await params;
  const ownership = await getOwnedSupportTicketById<{
    id: string;
    event_id: string | null;
    subject: string;
    category: string;
    status: string;
    created_at: string;
    updated_at: string;
    closed_at: string | null;
  }>(db, ticketId, auth.studioId, 'id, event_id, subject, category, status, created_at, updated_at, closed_at');
  if (isOwnershipError(ownership)) return ownership.error;

  const { data: messages, error } = await db
    .from('support_ticket_messages')
    .select('id, author_user_id, body, created_at')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to load messages: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, ticket: ownership.event, messages: messages ?? [] });
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { ticketId } = await params;
  const ownership = await getOwnedSupportTicketById<{ id: string }>(db, ticketId, auth.studioId, 'id');
  if (isOwnershipError(ownership)) return ownership.error;

  let body: { status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!STATUSES.includes(body.status as Status)) {
    return NextResponse.json({ success: false, error: 'status must be "open" or "closed"' }, { status: 400 });
  }
  const status = body.status as Status;

  const { data: updated, error } = await db
    .from('support_tickets')
    .update({
      status,
      updated_at: new Date().toISOString(),
      closed_at: status === 'closed' ? new Date().toISOString() : null,
    })
    .eq('id', ticketId)
    .eq('studio_id', auth.studioId)
    .select('id, event_id, subject, category, status, created_at, updated_at, closed_at')
    .single();

  if (error || !updated) {
    return NextResponse.json(
      { success: false, error: 'Failed to update ticket: ' + (error?.message ?? 'unknown error') },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, ticket: updated });
}
