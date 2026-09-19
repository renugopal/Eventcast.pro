import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { permanentlyDeleteEvent } from '@/lib/eventPermanentDelete';

/**
 * GET /api/cron/event-lifecycle-sweep
 *
 * The automated half of the Event Lifecycle package, called on the same
 * GitHub Actions schedule + `CRON_SECRET` pattern as the existing
 * `sync-live-status` cron. Two independent sweeps, both scoped to
 * `page_state = 'draft'` only — Published/Live/Completed/VOD events are
 * structurally unreachable by either query, so they can never be touched
 * by automatic lifecycle regardless of their `archived_at` value.
 *
 * Sweep 1 (7-day Draft inactivity -> auto-archive): a plain `archived_at`
 * update through the same write the manual Archive action performs. Never
 * calls `permanentlyDeleteEvent()` — auto-archive only ever archives. The
 * UPDATE re-asserts every eligibility condition (`page_state = 'draft'`,
 * `archived_at IS NULL`, `draft_last_activity_at < cutoff`) in its own
 * WHERE clause and checks the actual returned row count — a candidate
 * that was edited/archived/restored between the SELECT and this UPDATE
 * simply matches zero rows and is reported `skipped`, never `archived`.
 *
 * Sweep 2 (30-day Archived-Draft -> auto-permanent-delete): calls the
 * exact same guarded `permanentlyDeleteEvent()` the manual route uses —
 * identical live/recording/retention safety gates for a human-triggered
 * and an automated delete — with a single fixed cutoff computed once for
 * this whole sweep run, passed through as cron eligibility data so the
 * shared function re-asserts it both after its own fetch and atomically on
 * its own DELETE.
 */

const DRAFT_INACTIVITY_DAYS = 7;
const ARCHIVED_DRAFT_DELETE_DAYS = 30;

interface DraftAutoArchiveCandidate {
  id: string;
}

interface ArchivedDraftAutoDeleteCandidate {
  id: string;
  studio_id: string;
}

type AutoArchiveOutcome = { id: string; status: 'archived' | 'skipped' | 'error'; detail?: string };
type AutoDeleteOutcome = { id: string; status: 'deleted' | 'blocked' | 'skipped' | 'error'; detail?: string };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ success: false, error: 'Supabase Admin client not initialized' }, { status: 500 });
  }
  const db = supabaseAdmin;

  // ── Sweep 1: 7-day Draft inactivity -> auto-archive ──────────────────────
  const archiveCutoff = new Date(Date.now() - DRAFT_INACTIVITY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: autoArchiveCandidates, error: autoArchiveFetchError } = await db
    .from('events')
    .select('id')
    .eq('page_state', 'draft')
    .is('archived_at', null)
    .lt('draft_last_activity_at', archiveCutoff);

  const autoArchiveResults: AutoArchiveOutcome[] = [];

  if (!autoArchiveFetchError) {
    for (const candidate of (autoArchiveCandidates ?? []) as DraftAutoArchiveCandidate[]) {
      const { data: updated, error: archiveError } = await db
        .from('events')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', candidate.id)
        .eq('page_state', 'draft')
        .is('archived_at', null)
        .lt('draft_last_activity_at', archiveCutoff)
        .select('id');

      if (archiveError) {
        autoArchiveResults.push({ id: candidate.id, status: 'error', detail: archiveError.message });
      } else if (!updated || updated.length !== 1) {
        // Race: edited, archived, or otherwise changed between the SELECT
        // above and this UPDATE. Safe by construction — never reported as
        // archived.
        autoArchiveResults.push({ id: candidate.id, status: 'skipped' });
      } else {
        console.log('[event-lifecycle-sweep] auto-archived inactive Draft', { eventId: candidate.id });
        autoArchiveResults.push({ id: candidate.id, status: 'archived' });
      }
    }
  }

  // ── Sweep 2: 30-day Archived-Draft -> auto-permanent-delete ─────────────
  // One fixed cutoff for this entire sweep run — never recomputed per
  // candidate — so eligibility means the same instant everywhere it is
  // checked (the candidate query here, the re-check inside
  // permanentlyDeleteEvent, and its own DELETE statement).
  const deleteCutoff = new Date(Date.now() - ARCHIVED_DRAFT_DELETE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: autoDeleteCandidates, error: autoDeleteFetchError } = await db
    .from('events')
    .select('id, studio_id')
    .eq('page_state', 'draft')
    .not('archived_at', 'is', null)
    .lt('archived_at', deleteCutoff);

  const autoDeleteResults: AutoDeleteOutcome[] = [];

  if (!autoDeleteFetchError) {
    for (const candidate of (autoDeleteCandidates ?? []) as ArchivedDraftAutoDeleteCandidate[]) {
      try {
        const result = await permanentlyDeleteEvent(candidate.id, candidate.studio_id, {
          type: 'cron',
          requireDraft: true,
          archivedBefore: deleteCutoff,
        });

        if (result.status === 'deleted') {
          console.log('[event-lifecycle-sweep] auto-permanently-deleted Archived Draft', { eventId: candidate.id });
          autoDeleteResults.push({
            id: candidate.id,
            status: 'deleted',
            detail: result.warnings.length > 0 ? result.warnings.join('; ') : undefined,
          });
        } else if (result.status === 'blocked') {
          console.log('[event-lifecycle-sweep] auto-delete blocked by safety guard', {
            eventId: candidate.id,
            reason: result.reason,
          });
          autoDeleteResults.push({ id: candidate.id, status: 'blocked', detail: result.reason });
        } else if (result.status === 'skipped') {
          autoDeleteResults.push({ id: candidate.id, status: 'skipped', detail: result.message });
        } else {
          // not_found — candidate row vanished between the SELECT above
          // and permanentlyDeleteEvent()'s own fetch. Same race family as
          // `skipped`, reported the same way.
          autoDeleteResults.push({ id: candidate.id, status: 'skipped', detail: 'not_found' });
        }
      } catch (err) {
        autoDeleteResults.push({
          id: candidate.id,
          status: 'error',
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // A failed top-level candidate query, OR any individual item that hit a
  // real error (not merely blocked/skipped, both of which are expected
  // lifecycle outcomes), is a genuine degraded run — never buried inside
  // an unconditional success:true. The calling GitHub Actions step already
  // fails its job on any non-200, so this makes both classes of failure
  // genuinely alertable via existing cron monitoring.
  const hasItemErrors =
    autoArchiveResults.some((r) => r.status === 'error') || autoDeleteResults.some((r) => r.status === 'error');

  const degraded = Boolean(autoArchiveFetchError || autoDeleteFetchError) || hasItemErrors;

  return NextResponse.json(
    {
      success: !degraded,
      autoArchive: {
        processed: autoArchiveResults.length,
        results: autoArchiveResults,
        fetchError: autoArchiveFetchError?.message ?? null,
      },
      autoDelete: {
        processed: autoDeleteResults.length,
        results: autoDeleteResults,
        fetchError: autoDeleteFetchError?.message ?? null,
      },
    },
    { status: degraded ? 500 : 200 }
  );
}
