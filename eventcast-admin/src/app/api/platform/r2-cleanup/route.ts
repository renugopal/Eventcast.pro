import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireSuperAdmin } from '@/lib/superAdmin';
import type { EventRecordingRow } from '@/lib/eventRecording';
import {
  buildR2CleanupPlan,
  R2_CLEANUP_EXECUTION_BLOCKERS,
  type AssignmentActivationRow,
} from '@/lib/platformOperations';

/**
 * GET /api/platform/r2-cleanup — the R2 live/DVR cleanup eligibility report
 * and safe dry run (Baseline §16, STO-001/STO-002). `requireSuperAdmin`-gated.
 *
 * **This endpoint never deletes anything.** It is a read-only report: it
 * evaluates the existing fail-closed authority `isR2CleanupEligible()` for
 * every event that has a recording record, and for eligible events derives
 * the R2 prefixes a future cleanup would target from the event's own
 * append-only activation history (migration `0036`). No storage API is
 * called, no object is enumerated, and no deletion is scheduled.
 *
 * Actual destructive execution is not implemented, deliberately: the exact
 * semantics are not authoritatively defined anywhere in the Baseline or this
 * repository. See `R2_CLEANUP_EXECUTION_BLOCKERS` for the precise unresolved
 * decisions. Authoritative B2 objects are never a cleanup target under any
 * circumstances.
 */

const db = supabaseAdmin || supabase;

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const eventIdFilter = url.searchParams.get('eventId');

  let recordingsQuery = db.from('event_recordings').select('*, events(slug, studio_id)');
  if (eventIdFilter) {
    recordingsQuery = recordingsQuery.eq('event_id', eventIdFilter);
  }

  const [recordingsResult, activationsResult] = await Promise.all([
    recordingsQuery,
    db.from('media_event_assignment_activations').select('event_id, media_node_id, playback_id, activated_at'),
  ]);

  if (recordingsResult.error) {
    return NextResponse.json({ success: false, error: 'Failed to load R2 cleanup report' }, { status: 500 });
  }

  const activationsByEvent = new Map<string, AssignmentActivationRow[]>();
  for (const row of (activationsResult.data ?? []) as (AssignmentActivationRow & { event_id: string })[]) {
    const bucket = activationsByEvent.get(row.event_id) ?? [];
    bucket.push({ playback_id: row.playback_id, media_node_id: row.media_node_id, activated_at: row.activated_at });
    activationsByEvent.set(row.event_id, bucket);
  }

  const reports = ((recordingsResult.data ?? []) as (EventRecordingRow & {
    events?: { slug?: string; studio_id?: string } | { slug?: string; studio_id?: string }[] | null;
  })[]).map((row) => {
    const events = row.events;
    const event = Array.isArray(events) ? events[0] : events;
    return {
      eventSlug: event?.slug ?? null,
      studioId: event?.studio_id ?? null,
      recordingState: row.recording_state,
      retentionExpiresAt: row.retention_expires_at,
      ...buildR2CleanupPlan(row.event_id, row, activationsByEvent.get(row.event_id) ?? []),
    };
  });

  const eligibleCount = reports.filter((report) => report.eligible).length;

  return NextResponse.json({
    success: true,
    reports,
    summary: {
      total: reports.length,
      eligible: eligibleCount,
      notEligible: reports.length - eligibleCount,
    },
    dryRunOnly: true,
    executionAvailable: false,
    executionBlockers: R2_CLEANUP_EXECUTION_BLOCKERS,
    b2ObjectsExcluded: true,
  });
}
