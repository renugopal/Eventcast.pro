import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';

/**
 * GET/POST /api/support
 *
 * Minimal tenant-owned Support Ticket capability (Baseline V2.1 SUP-001/
 * SUP-002). Any studio member (any role) may list and create their own
 * studio's tickets — no owner/admin restriction exists for Support in this
 * repository's product decisions, unlike Partner mutation.
 *
 * A ticket always carries its opening message — POST requires both
 * `subject` and an initial `message`, inserted together (ticket row, then
 * its first message row). `category: 'urgent_live'` with an `eventId` is
 * how the Live tab's "Urgent Live Support" action opens a ticket already
 * associated with the event the provider is looking at; `eventId` is
 * optional for a general ticket.
 *
 * This is purely local, in-app ticket storage — no outbound email/
 * WhatsApp/SMS notification is sent by this route. Platform-side handling
 * of these tickets (a Super Admin Support Console) is Milestone M and is
 * not implemented here.
 */

export const runtime = 'edge';

const db = supabaseAdmin || supabase;

const CATEGORIES = ['general', 'urgent_live'] as const;
type Category = (typeof CATEGORIES)[number];

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await db
    .from('support_tickets')
    .select('id, event_id, subject, category, status, created_at, updated_at, closed_at')
    .eq('studio_id', auth.studioId)
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to load tickets: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, tickets: data ?? [] });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  let body: { subject?: unknown; message?: unknown; category?: unknown; eventId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const category: Category = CATEGORIES.includes(body.category as Category) ? (body.category as Category) : 'general';
  const eventId = typeof body.eventId === 'string' && body.eventId.trim() ? body.eventId.trim() : null;

  if (!subject) {
    return NextResponse.json({ success: false, error: 'Subject is required' }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ success: false, error: 'An opening message is required' }, { status: 400 });
  }

  // If an event is named, it must actually be owned by this studio — proven
  // before the ticket is created, same defense-in-depth pattern as
  // getOwnedPartnerById is used from the Event Credit attach route.
  if (eventId) {
    const ownership = await getOwnedEventById<{ id: string }>(db, eventId, auth.studioId, 'id');
    if (isOwnershipError(ownership)) return ownership.error;
  }

  const { data: ticket, error: ticketError } = await db
    .from('support_tickets')
    .insert({
      studio_id: auth.studioId,
      event_id: eventId,
      created_by_user_id: auth.userId,
      subject,
      category,
    })
    .select('id, event_id, subject, category, status, created_at, updated_at, closed_at')
    .single();

  if (ticketError || !ticket) {
    return NextResponse.json(
      { success: false, error: 'Failed to create ticket: ' + (ticketError?.message ?? 'unknown error') },
      { status: 500 }
    );
  }

  const { error: messageError } = await db.from('support_ticket_messages').insert({
    ticket_id: ticket.id,
    author_user_id: auth.userId,
    body: message,
  });

  if (messageError) {
    // The ticket exists but its opening message failed to save — surfaced
    // clearly rather than silently reporting full success.
    return NextResponse.json(
      {
        success: false,
        error: 'Ticket created but the opening message failed to save: ' + messageError.message,
        ticket,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, ticket });
}
