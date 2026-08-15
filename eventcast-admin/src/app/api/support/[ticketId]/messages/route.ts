import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { getOwnedSupportTicketById, isOwnershipError } from '@/lib/ownership';

/**
 * POST /api/support/[ticketId]/messages
 *
 * Appends a message to an owned ticket's history and bumps the ticket's
 * `updated_at` so the roster (`GET /api/support`) reflects recent activity.
 * Allowed on both open and closed tickets — closing is a status flag, not a
 * lock on the conversation.
 */

export const runtime = 'edge';

const db = supabaseAdmin || supabase;

interface RouteParams {
  params: Promise<{ ticketId: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { ticketId } = await params;
  const ownership = await getOwnedSupportTicketById<{ id: string }>(db, ticketId, auth.studioId, 'id');
  if (isOwnershipError(ownership)) return ownership.error;

  let body: { body?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const messageBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!messageBody) {
    return NextResponse.json({ success: false, error: 'Message body is required' }, { status: 400 });
  }

  const { data: message, error } = await db
    .from('support_ticket_messages')
    .insert({ ticket_id: ticketId, author_user_id: auth.userId, body: messageBody })
    .select('id, author_user_id, body, created_at')
    .single();

  if (error || !message) {
    return NextResponse.json(
      { success: false, error: 'Failed to add message: ' + (error?.message ?? 'unknown error') },
      { status: 500 }
    );
  }

  await db.from('support_tickets').update({ updated_at: new Date().toISOString() }).eq('id', ticketId);

  return NextResponse.json({ success: true, message });
}
