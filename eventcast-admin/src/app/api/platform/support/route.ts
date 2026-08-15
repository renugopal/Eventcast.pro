import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';

/**
 * GET /api/platform/support — the cross-tenant Support queue (Baseline §15,
 * SUP-001/SUP-002). `requireSuperAdmin`-gated, service-role client.
 *
 * **Metadata-first (ADM-007).** This roster returns ticket metadata and a
 * message count only. No message body is ever included here. Reading the
 * thread itself requires the separate, reason-gated, audited
 * `POST /api/platform/support/[ticketId]/access` endpoint.
 *
 * Built on migration `0034`'s existing schema. No external WhatsApp, SMS, or
 * email provider is involved — none is integrated in this repository.
 */
export const runtime = 'edge';

const db = supabaseAdmin || supabase;

const PAGE_SIZE = 50;

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
  const statusFilter = url.searchParams.get('status');
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = db
    .from('support_tickets')
    .select('id, studio_id, event_id, subject, category, status, created_at, updated_at, closed_at, studios(slug)', {
      count: 'exact',
    });

  if (statusFilter === 'open' || statusFilter === 'closed') {
    query = query.eq('status', statusFilter);
  }

  const [ticketsResult, messagesResult] = await Promise.all([
    query.order('created_at', { ascending: false }).range(from, to),
    // Message ids and ticket ids only — never a body.
    db.from('support_ticket_messages').select('ticket_id'),
  ]);

  if (ticketsResult.error) {
    return NextResponse.json({ success: false, error: 'Failed to load support queue' }, { status: 500 });
  }

  const messageCounts = new Map<string, number>();
  for (const row of (messagesResult.data ?? []) as { ticket_id: string }[]) {
    messageCounts.set(row.ticket_id, (messageCounts.get(row.ticket_id) ?? 0) + 1);
  }

  const tickets = ((ticketsResult.data ?? []) as Record<string, unknown>[]).map((row) => {
    const studios = row.studios as { slug?: string } | { slug?: string }[] | null;
    const studio = Array.isArray(studios) ? studios[0] : studios;
    return {
      id: row.id,
      studioId: row.studio_id,
      studioSlug: studio?.slug ?? null,
      eventId: row.event_id,
      subject: row.subject,
      category: row.category,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at,
      messageCount: messageCounts.get(row.id as string) ?? 0,
    };
  });

  return NextResponse.json({
    success: true,
    tickets,
    page,
    pageSize: PAGE_SIZE,
    total: ticketsResult.count ?? tickets.length,
    contentAccessPolicy:
      'Message bodies are private customer content (ADM-007). Reading a thread requires a stated reason and is ' +
      'recorded in the platform audit log.',
  });
}
