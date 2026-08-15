/**
 * Event Workspace lifecycle/status projection (V2.1 baseline EVT-001 /
 * EVT-002 / EVT-003 — Event Workspace + Lifecycle Foundation).
 *
 * Derives one honest user-facing lifecycle bucket from the authoritative
 * dimensions that actually exist in this repository today: `page_state`
 * (Draft/Published, migration 0029), `archived_at` (pre-existing
 * archive-before-delete column), and the authoritative `scheduled_start_at`
 * (migration 0029), with a legacy `event_date` fallback only for rows that
 * predate it.
 *
 * The accepted baseline vocabulary (EVT-002) also names Ready for Test,
 * Testing, Live, Interrupted or Reconnecting, Ended, Replay Processing, and
 * Completed. None of those has authoritative backing evidence in this
 * repository yet — there is no wired private-stream state, YouTube state,
 * or recording/VOD state reaching this table. EVT-003 explicitly forbids
 * inferring Live or Completed from date math alone, so a Published event
 * whose scheduled time has already passed (or has no schedule evidence at
 * all) is represented as the neutral `published` bucket rather than
 * guessing one of those unimplemented states. A later package that wires
 * real stream/recording evidence into this table can extend this function
 * without changing its existing callers' meaning.
 */

export type EventLifecycleStatus = 'draft' | 'upcoming' | 'published' | 'archived';

export interface EventLifecycleInput {
  page_state: string | null;
  archived_at: string | null;
  scheduled_start_at: string | null;
  /** Legacy `YYYY-MM-DD` fallback, consulted only when scheduled_start_at is null. */
  event_date?: string | null;
}

function resolveScheduledInstant(input: EventLifecycleInput): Date | null {
  if (input.scheduled_start_at) {
    const parsed = new Date(input.scheduled_start_at);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (input.event_date) {
    const parsed = new Date(`${input.event_date}T00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

/**
 * Archive takes precedence over every other dimension — an archived Draft is
 * still shown as Archived, not Draft, since archival is the more specific
 * and more recently-taken action. Draft takes precedence over schedule: a
 * Draft whose scheduled_start_at happens to be in the future is still a
 * Draft, never "Upcoming", since Upcoming implies a published, findable
 * page.
 */
export function deriveEventLifecycleStatus(input: EventLifecycleInput): EventLifecycleStatus {
  if (input.archived_at) return 'archived';
  if (input.page_state === 'draft') return 'draft';

  const scheduledAt = resolveScheduledInstant(input);
  if (scheduledAt && scheduledAt.getTime() > Date.now()) return 'upcoming';

  return 'published';
}

export const EVENT_LIFECYCLE_LABELS: Record<EventLifecycleStatus, string> = {
  draft: 'Draft',
  upcoming: 'Upcoming',
  published: 'Published',
  archived: 'Archived',
};

/** Appended to the base `ec-badge` class already used across the admin UI. */
export const EVENT_LIFECYCLE_BADGE_CLASSES: Record<EventLifecycleStatus, string> = {
  draft: 'ec-badge-amber',
  upcoming: 'ec-badge-scheduled',
  published: 'ec-badge-completed',
  archived: '',
};
