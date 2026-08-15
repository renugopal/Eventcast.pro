import { getOwnedEventById, isOwnershipError } from './ownership';
import { loadOwnedEventCreditsWithPartners } from './eventCreditsLoader';
import { projectPublicEventCredits, type PublicEventCredit } from './eventContract';

interface OwnedEventPublishState {
  id: string;
  published_credits: PublicEventCredit[] | null;
}

interface UpdateQueryResult {
  data: unknown;
  error: { message: string } | null;
}

interface UpdateSingleBuilder {
  single: () => PromiseLike<UpdateQueryResult>;
}

interface UpdateSelectBuilder {
  select: (columns: string) => UpdateSingleBuilder;
}

interface UpdateFilterStage2 {
  eq: (column: string, value: unknown) => UpdateSelectBuilder;
}

interface UpdateFilterStage1 {
  eq: (column: string, value: unknown) => UpdateFilterStage2;
}

interface UpdateQueryBuilder {
  update: (values: Record<string, unknown>) => UpdateFilterStage1;
}

interface UpdateableDb {
  from: (table: string) => UpdateQueryBuilder;
}

export type FreezePublishedEventCreditsResult =
  | { status: 'ok'; snapshot: PublicEventCredit[] }
  | { status: 'already_frozen'; snapshot: PublicEventCredit[] }
  | { status: 'not_found' }
  | { status: 'query_failed' }
  | { status: 'write_failed' };

/**
 * Freezes the current public-safe Event Credit projection for an owned
 * Event into its existing `published_credits` jsonb column (migration
 * `0030`). Reuses the same canonical projection (`projectPublicEventCredits`)
 * and credit-loading query (`loadOwnedEventCreditsWithPartners`) as Draft
 * Preview — no parallel Event Credit representation.
 *
 * Write-once: the Admin Baseline V2.1 defines `published_credits` only as
 * an invariant of already-published events ("later partner-profile edits
 * do not rewrite historical event pages" — PART-006 / section 13) and does
 * not define semantics for repeated pre-Publish snapshot generation. Absent
 * that explicit permission, an Event that already carries a frozen snapshot
 * (including a previously frozen empty one) is left untouched rather than
 * silently overwritten — callers must treat `already_frozen` as a distinct
 * outcome, not a success/failure to retry.
 *
 * Fails closed: an Event Credit/Partner query failure returns `query_failed`
 * and never reaches the write, so a transient read error can never freeze a
 * partial or accidentally-empty snapshot. Does not accept a caller-supplied
 * snapshot — the frozen payload is always derived server-side from the
 * owned Event's current `event_credits` + `partners` rows.
 */
export async function freezePublishedEventCredits(
  db: unknown,
  eventId: string | null | undefined,
  studioId: string | null | undefined
): Promise<FreezePublishedEventCreditsResult> {
  const ownership = await getOwnedEventById<OwnedEventPublishState>(
    db,
    eventId,
    studioId,
    'id, published_credits'
  );
  if (isOwnershipError(ownership)) {
    return { status: 'not_found' };
  }
  const event = ownership.event;

  if (event.published_credits !== null && event.published_credits !== undefined) {
    return { status: 'already_frozen', snapshot: event.published_credits };
  }

  const ownedCredits = await loadOwnedEventCreditsWithPartners(db, event.id);
  if (ownedCredits === null) {
    return { status: 'query_failed' };
  }

  const snapshot = projectPublicEventCredits(ownedCredits);

  const queryableDb = db as UpdateableDb;
  const { error } = await queryableDb
    .from('events')
    .update({ published_credits: snapshot })
    .eq('id', event.id)
    .eq('studio_id', studioId as string)
    .select('id')
    .single();

  if (error) {
    return { status: 'write_failed' };
  }

  return { status: 'ok', snapshot };
}
