import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';
import type { EventRecordingRow } from '@/lib/eventRecording';
import { isR2CleanupEligible } from '@/lib/r2CleanupEligibility';
import { toPlatformRecordingView } from '@/lib/platformOperations';

/**
 * GET /api/platform/media-operations — the cross-tenant Media Operations
 * roster (Baseline §15). `requireSuperAdmin`-gated, service-role client.
 *
 * One row per event that has a recording record, carrying recording state,
 * gap/provenance evidence, B2 archive identity, retention state, and the
 * existing `isR2CleanupEligible()` verdict. Recording semantics are consumed
 * from `event_recordings` and its RPCs; nothing is recomputed here.
 *
 * Guest Memories counts are included as the other real media dimension this
 * repository stores. Their moderation remains a provider-tenant capability —
 * this route counts them and never returns photo URLs, uploader names, or
 * any other guest content (ADM-007: private content is not routinely
 * browsed).
 */
export const runtime = 'edge';

const db = supabaseAdmin || supabase;

const PAGE_SIZE = 50;

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const [recordingsResult, guestPhotosResult] = await Promise.all([
    db
      .from('event_recordings')
      .select('*, events(slug, studio_id)', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(from, to),
    db.from('guest_photos').select('event_id, approved'),
  ]);

  if (recordingsResult.error) {
    return NextResponse.json({ success: false, error: 'Failed to load media operations' }, { status: 500 });
  }

  const guestPhotoCounts = new Map<string, { total: number; pending: number }>();
  for (const row of (guestPhotosResult.data ?? []) as { event_id: string; approved: boolean }[]) {
    const bucket = guestPhotoCounts.get(row.event_id) ?? { total: 0, pending: 0 };
    bucket.total += 1;
    if (!row.approved) bucket.pending += 1;
    guestPhotoCounts.set(row.event_id, bucket);
  }

  const recordings = ((recordingsResult.data ?? []) as (EventRecordingRow & {
    events?: { slug?: string; studio_id?: string } | { slug?: string; studio_id?: string }[] | null;
  })[]).map((row) => {
    const events = row.events;
    const event = Array.isArray(events) ? events[0] : events;
    const guestPhotos = guestPhotoCounts.get(row.event_id) ?? { total: 0, pending: 0 };
    return {
      eventId: row.event_id,
      eventSlug: event?.slug ?? null,
      studioId: event?.studio_id ?? null,
      ...toPlatformRecordingView(row),
      // The existing fail-closed authority — never a local re-derivation.
      r2CleanupEligible: isR2CleanupEligible(row),
      guestMemoryCount: guestPhotos.total,
      guestMemoryPendingCount: guestPhotos.pending,
    };
  });

  return NextResponse.json({
    success: true,
    recordings,
    page,
    pageSize: PAGE_SIZE,
    total: recordingsResult.count ?? recordings.length,
  });
}
