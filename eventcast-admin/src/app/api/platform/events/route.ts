import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';
import { deriveEventLifecycleStatus } from '@/lib/eventLifecycle';

/**
 * GET /api/platform/events — paginated cross-tenant event list for the
 * Platform Console. `requireSuperAdmin`-gated, service-role client.
 */

const db = supabaseAdmin || supabase;

const PAGE_SIZE = 50;

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error, count } = await db
    .from('events')
    .select('id, slug, page_state, event_visibility, scheduled_start_at, archived_at, studio_id, studios(slug)', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to load events' }, { status: 500 });
  }

  const events = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    slug: row.slug,
    pageState: row.page_state,
    eventVisibility: row.event_visibility,
    scheduledStartAt: row.scheduled_start_at,
    studioId: row.studio_id,
    studioSlug: (row.studios as { slug?: string } | { slug?: string }[] | null | undefined) && !Array.isArray(row.studios)
      ? (row.studios as { slug?: string } | null)?.slug ?? null
      : Array.isArray(row.studios)
        ? (row.studios[0]?.slug ?? null)
        : null,
    lifecycleStatus: deriveEventLifecycleStatus({
      page_state: row.page_state as string | null,
      archived_at: row.archived_at as string | null,
      scheduled_start_at: row.scheduled_start_at as string | null,
    }),
  }));

  return NextResponse.json({
    success: true,
    events,
    page,
    pageSize: PAGE_SIZE,
    total: count ?? events.length,
  });
}
