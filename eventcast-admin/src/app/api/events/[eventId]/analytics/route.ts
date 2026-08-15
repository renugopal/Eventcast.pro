import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';

/**
 * GET /api/events/[eventId]/analytics
 *
 * Real, source-backed Event-page + EventCast-private-stream audience
 * analytics (Analytics + Provider operational/support/auth delivery
 * package, Baseline V2.1 ANA-002/ANA-003). Every number here comes from an
 * actual stored row — nothing is estimated, inferred, or fabricated.
 *
 * Event-page analytics (page_views, wishes, guest_photos — all pre-existing
 * tables):
 *  - totalPageViews: count(*) of page_views for this event.
 *  - uniqueVisitors: count(distinct visitor_id) — visitor_id (migration
 *    0034) is a nullable column added going forward only. Rows recorded
 *    before this column existed have visitor_id = NULL and are excluded
 *    from this count, never fabricated a value — see
 *    `uniqueVisitorsCoverageNote` below, which the UI must surface.
 *  - referral/device/country breakdowns: grouped directly from the stored
 *    columns.
 *  - wishesCount / guestMemoriesCount: plain counts against the existing
 *    Wishes/Guest Memories tables.
 *
 * EventCast-private-stream audience analytics (event_audience_heartbeats,
 * migration 0034) — Baseline ANA-003. Heartbeats are written only by the
 * EventCast HLS <video> player while it is genuinely in the 'playing'
 * state (see wedding-template-01/script.js); never by the page-presence
 * widget, never by YouTube playback, and never by a direct table INSERT —
 * the only write path is the SECURITY DEFINER RPC
 * record_event_audience_heartbeat(), which stamps `bucket_started_at` from
 * database time and accepts at most one row per (event, session, 20s
 * bucket). Every figure below is therefore derived from *accepted distinct
 * server buckets*, never from a client-submitted duration and never from a
 * raw insert count a caller could inflate by repeating requests:
 *  - currentViewers: distinct viewer_id with an accepted bucket inside the
 *    last HEARTBEAT_ACTIVE_TIMEOUT_SECONDS.
 *  - peakConcurrentViewers: buckets are grouped into fixed
 *    PEAK_BUCKET_SECONDS windows; the maximum distinct-viewer count across
 *    any single window. An honest approximation at HEARTBEAT_INTERVAL_
 *    SECONDS resolution, not a continuous concurrency trace.
 *  - totalUniqueViewers: distinct viewer_id across every fetched heartbeat.
 *  - totalWatchTimeSeconds / averageWatchTimeSeconds: per (viewer_id,
 *    session_id), the number of DISTINCT accepted buckets *
 *    HEARTBEAT_INTERVAL_SECONDS, summed and averaged per unique viewer.
 *    Counting distinct buckets rather than rows means a retried or
 *    duplicated heartbeat can never add watch time, even if a privileged
 *    writer were ever to bypass the table's unique index. Using bucket
 *    counts (rather than max - min) also avoids over-counting any
 *    paused/buffering gap where no heartbeat was sent.
 *  - Rows are fetched newest-first up to HEARTBEAT_FETCH_LIMIT — a simple,
 *    current-EventCast-scale approximation, not an unbounded aggregation
 *    pipeline. `audienceCoverageNote` discloses this in the response.
 *
 * viewer_id is a privacy-safe browser/player identity, not a verified
 * unique human — the response labels these as measured player sessions.
 *
 * No technical stream metrics (resolution/FPS/bitrate/codecs/reconnects/
 * source-relay health) are computed or returned here — no authoritative
 * source exists (unchanged from the Live Control Room package).
 */

export const runtime = 'edge';

const db = supabaseAdmin || supabase;

const HEARTBEAT_INTERVAL_SECONDS = 20;
const HEARTBEAT_ACTIVE_TIMEOUT_SECONDS = 60;
const PEAK_BUCKET_SECONDS = 60;
const HEARTBEAT_FETCH_LIMIT = 50000;

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

function countBy(rows: { key: string | null }[], fallback: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const key = row.key && row.key.trim() ? row.key : fallback;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;
  const ownership = await getOwnedEventById<{ id: string }>(db, eventId, auth.studioId, 'id');
  if (isOwnershipError(ownership)) return ownership.error;

  const [pageViewsResult, wishesCountResult, guestMemoriesCountResult, heartbeatsResult] = await Promise.all([
    db.from('page_views').select('referrer, device_type, country, visitor_id').eq('event_id', eventId),
    db.from('wishes').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
    db.from('guest_photos').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
    db
      .from('event_audience_heartbeats')
      .select('viewer_id, session_id, bucket_started_at')
      .eq('event_id', eventId)
      .order('bucket_started_at', { ascending: false })
      .limit(HEARTBEAT_FETCH_LIMIT),
  ]);

  if (pageViewsResult.error) {
    return NextResponse.json(
      { success: false, error: 'Failed to load page views: ' + pageViewsResult.error.message },
      { status: 500 }
    );
  }
  if (heartbeatsResult.error) {
    return NextResponse.json(
      { success: false, error: 'Failed to load audience heartbeats: ' + heartbeatsResult.error.message },
      { status: 500 }
    );
  }

  const pageViews = pageViewsResult.data ?? [];
  const visitorIds = new Set(pageViews.map((r) => r.visitor_id).filter((v): v is string => !!v));
  const trackedVisitorRows = pageViews.filter((r) => !!r.visitor_id).length;

  const referralBreakdown = countBy(pageViews.map((r) => ({ key: r.referrer })), 'Direct');
  const deviceBreakdown = countBy(pageViews.map((r) => ({ key: r.device_type })), 'Unknown');
  const countryBreakdown = countBy(pageViews.map((r) => ({ key: r.country })), 'Unknown');

  // ── Audience heartbeat aggregation ────────────────────────────────────
  const heartbeats = heartbeatsResult.data ?? [];
  const nowMs = Date.now();
  const activeThresholdMs = nowMs - HEARTBEAT_ACTIVE_TIMEOUT_SECONDS * 1000;

  const currentViewerIds = new Set<string>();
  const allViewerIds = new Set<string>();
  const peakBuckets = new Map<number, Set<string>>();
  // Distinct accepted server buckets per playback session — never a raw row
  // count, so a duplicate or retried heartbeat contributes nothing.
  const sessionBuckets = new Map<string, { viewerId: string; buckets: Set<number> }>();

  for (const row of heartbeats) {
    const bucketStartedAtMs = new Date(row.bucket_started_at).getTime();
    if (Number.isNaN(bucketStartedAtMs)) continue;

    allViewerIds.add(row.viewer_id);
    if (bucketStartedAtMs >= activeThresholdMs) currentViewerIds.add(row.viewer_id);

    const peakBucket = Math.floor(bucketStartedAtMs / (PEAK_BUCKET_SECONDS * 1000));
    if (!peakBuckets.has(peakBucket)) peakBuckets.set(peakBucket, new Set());
    peakBuckets.get(peakBucket)!.add(row.viewer_id);

    const sessionKey = `${row.viewer_id}::${row.session_id}`;
    const existing = sessionBuckets.get(sessionKey);
    if (existing) existing.buckets.add(bucketStartedAtMs);
    else sessionBuckets.set(sessionKey, { viewerId: row.viewer_id, buckets: new Set([bucketStartedAtMs]) });
  }

  let peakConcurrentViewers = 0;
  for (const bucketViewers of peakBuckets.values()) {
    if (bucketViewers.size > peakConcurrentViewers) peakConcurrentViewers = bucketViewers.size;
  }

  const watchTimeByViewer = new Map<string, number>();
  let totalWatchTimeSeconds = 0;
  for (const { viewerId, buckets } of sessionBuckets.values()) {
    const seconds = buckets.size * HEARTBEAT_INTERVAL_SECONDS;
    totalWatchTimeSeconds += seconds;
    watchTimeByViewer.set(viewerId, (watchTimeByViewer.get(viewerId) ?? 0) + seconds);
  }

  const totalUniqueViewers = allViewerIds.size;
  const averageWatchTimeSeconds = totalUniqueViewers > 0 ? Math.round(totalWatchTimeSeconds / totalUniqueViewers) : 0;

  return NextResponse.json({
    success: true,
    analytics: {
      pageAnalytics: {
        totalPageViews: pageViews.length,
        uniqueVisitors: visitorIds.size,
        uniqueVisitorsCoverageNote:
          trackedVisitorRows < pageViews.length
            ? 'Unique-visitor tracking started partway through this event\'s history — only page views recorded after that point are counted. Total page views above still include every view.'
            : null,
        referralBreakdown,
        deviceBreakdown,
        countryBreakdown,
        wishesCount: wishesCountResult.count ?? 0,
        guestMemoriesCount: guestMemoriesCountResult.count ?? 0,
      },
      audienceAnalytics: {
        currentViewers: currentViewerIds.size,
        peakConcurrentViewers,
        totalUniqueViewers,
        totalWatchTimeSeconds,
        averageWatchTimeSeconds,
        heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
        activeTimeoutSeconds: HEARTBEAT_ACTIVE_TIMEOUT_SECONDS,
        coverageNote:
          heartbeats.length >= HEARTBEAT_FETCH_LIMIT
            ? `Based on the most recent ${HEARTBEAT_FETCH_LIMIT.toLocaleString()} heartbeat records — very long-running events may have earlier activity not reflected here.`
            : null,
      },
    },
  });
}
