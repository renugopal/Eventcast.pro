import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin, canMutateStudioResources } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';
import { projectPublicEventCredits, type PublicEventCredit } from '@/lib/eventContract';
import { loadOwnedEventCreditsWithPartners } from '@/lib/eventCreditsLoader';
import { derivePublishedCreditsStatus } from '@/lib/publishedCreditsRefresh';

/**
 * GET  /api/events/[eventId]/published-credits — status: the frozen public
 *      snapshot vs. what the current Event Credits would project to.
 * POST /api/events/[eventId]/published-credits — the explicit provider
 *      action "Update published credits": re-derive `events.published_credits`
 *      from the current `event_credits` + `partners` rows and write it.
 *
 * Why an explicit action and not an automatic resync: baseline PART-006 /
 * §13 makes the snapshot a deliberate freeze ("later partner-profile edits
 * do not rewrite historical event pages"). A provider who *wants* the
 * published page to reflect their edited credits takes this one action; a
 * Partner or Event Credit edit on its own never touches the snapshot.
 *
 * Deliberately separate from `POST /api/events/[eventId]/publish` (the
 * one-shot Draft → Published transition, which 409s on an already-published
 * row) and from `PATCH /api/events/[eventId]/details` (core fields only).
 * This route writes exactly one column — `published_credits` — and never
 * touches `page_state`, `event_visibility`, or any other field.
 *
 * The new snapshot is always derived server-side through the same
 * `loadOwnedEventCreditsWithPartners()` + `projectPublicEventCredits()` path
 * Publish and the Draft Preview use — one projection, no second copy. The
 * request body is never read: a client cannot supply, influence, or override
 * the stored snapshot.
 */

const db = supabaseAdmin || supabase;

const PUBLISHED_CREDITS_COLUMNS = 'id, page_state, archived_at, published_credits';

interface PublishedCreditsEventRow {
  id: string;
  page_state: string | null;
  archived_at: string | null;
  published_credits: PublicEventCredit[] | null;
}

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

function archivedResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'This event is archived. Restore it before updating its published credits.' },
    { status: 409 }
  );
}

// Used both when the ownership read shows a non-published row and when the
// Published-scoped update matches no row (the event was archived or
// otherwise left the Published state between the read and the write).
function notPublishedResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Only a Published event has published credits to update.' },
    { status: 409 }
  );
}

function creditsLoadFailedResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: "Failed to load this event's Event Credits." },
    { status: 500 }
  );
}

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  // Read-only: open to every studio member, like the other event GET routes.
  const { eventId } = await params;
  const ownership = await getOwnedEventById<PublishedCreditsEventRow>(
    db,
    eventId,
    auth.studioId,
    PUBLISHED_CREDITS_COLUMNS
  );
  if (isOwnershipError(ownership)) return ownership.error;
  const existing = ownership.event;

  const ownedCredits = await loadOwnedEventCreditsWithPartners(db, existing.id);
  if (ownedCredits === null) return creditsLoadFailedResponse();
  const currentCredits = projectPublicEventCredits(ownedCredits);

  const status = derivePublishedCreditsStatus({
    pageState: existing.page_state,
    archivedAt: existing.archived_at,
    frozen: existing.published_credits,
    current: currentCredits,
  });

  return NextResponse.json({
    success: true,
    id: existing.id,
    pageState: existing.page_state,
    archived: Boolean(existing.archived_at),
    frozenCredits: Array.isArray(existing.published_credits) ? existing.published_credits : null,
    currentCredits,
    ...status,
  });
}

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  // Same owner/admin gate every other event-mutation route enforces, before
  // any database access. `member` is read-only.
  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json({ success: false, error: 'Forbidden: read-only studio role' }, { status: 403 });
  }

  const { eventId } = await params;
  const ownership = await getOwnedEventById<PublishedCreditsEventRow>(
    db,
    eventId,
    auth.studioId,
    PUBLISHED_CREDITS_COLUMNS
  );
  if (isOwnershipError(ownership)) return ownership.error;
  const existing = ownership.event;

  // Archive takes precedence over page_state, mirroring the details route
  // and `eventLifecycle.ts`: an archived event is not editable regardless of
  // whether it was published.
  if (existing.archived_at) return archivedResponse();
  if (existing.page_state !== 'published') return notPublishedResponse();

  // Fail closed: a transient credit-read failure must never overwrite the
  // live snapshot with an accidentally empty or partial list. A genuinely
  // credit-less event, by contrast, legitimately refreshes to `[]` — the
  // same no-credit semantics Publish uses (PART-008 is advisory).
  const ownedCredits = await loadOwnedEventCreditsWithPartners(db, existing.id);
  if (ownedCredits === null) return creditsLoadFailedResponse();
  const publishedCredits = projectPublicEventCredits(ownedCredits);

  // Guarded single-column update, scoped by event id, studio ownership, the
  // Published state, AND archived_at IS NULL — so a concurrent archive or
  // any other state change between the read above and this write cannot be
  // raced past. `page_state` and `event_visibility` are deliberately not in
  // the update payload.
  const { data, error } = await db
    .from('events')
    .update({ published_credits: publishedCredits })
    .eq('id', existing.id)
    .eq('studio_id', auth.studioId)
    .eq('page_state', 'published')
    .is('archived_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { success: false, error: 'Could not update the published credits: ' + error.message },
      { status: 500 }
    );
  }

  if (!data) {
    // No row matched the guarded filter — the event left the Published /
    // non-archived state concurrently. Nothing was written.
    return notPublishedResponse();
  }

  return NextResponse.json({
    success: true,
    id: existing.id,
    publishedCredits,
    creditCount: publishedCredits.length,
  });
}
