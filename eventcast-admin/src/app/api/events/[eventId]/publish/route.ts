import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';
import { projectPublicEventCredits, type EventPublicVisibility, type PublicEventCredit } from '@/lib/eventContract';
import { loadOwnedEventCreditsWithPartners } from '@/lib/eventCreditsLoader';

/**
 * POST /api/events/[eventId]/publish
 *
 * The controlled Public Page Publish action: the `page_state` Draft →
 * Published transition (migration `0029`) together with the frozen public
 * Event Credit snapshot (`events.published_credits`, migration `0030`,
 * baseline PART-006 / section 13 — "published events preserve a snapshot of
 * public credit details so that later partner-profile edits do not rewrite
 * historical event pages").
 *
 * Atomicity: the snapshot and the page-state transition are written in ONE
 * update of the same `events` row. Deliberately NOT `freeze, then transition`
 * — two sequential writes can leave a Draft carrying a frozen (and later
 * stale) snapshot if the second write fails. The standalone
 * `freezePublishedEventCredits()` helper is therefore intentionally not used
 * here; it remains a separate write-once capability.
 *
 * The snapshot is always derived server-side from this Event's current
 * `event_credits` + `partners` rows through the same public-safe
 * `projectPublicEventCredits()` the Draft Preview/renderer path uses. A
 * client can never supply, influence, or override the stored
 * `published_credits`. The request body is read for exactly one field —
 * `visibility` — an explicit, required Public/Unlisted choice (Visibility
 * Foundation Gate); no other `event_visibility` value can be selected here,
 * and nothing else in the body is trusted.
 *
 * Publish is page-only (baseline CRT-012: "the page may be published before
 * the stream; page publishing does not start the livestream"). This route
 * touches exactly one `events` row: no wallet debit, YouTube resource, media
 * upload, SRS activation, Media Agent assignment, Restreamer provisioning, or
 * any other lifecycle side effect.
 */

export const runtime = 'edge';

const db = supabaseAdmin || supabase;

const PUBLISH_COLUMNS = 'id, page_state, published_credits';

interface PublishEventRow {
  id: string;
  page_state: string | null;
  published_credits: PublicEventCredit[] | null;
}

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

interface PublishRequestBody {
  visibility?: unknown;
}

// The only two canonical values Publish may write. Legacy `private`/
// `synthetic` are deliberately never selectable through this route.
const CANONICAL_PUBLISH_VISIBILITIES: readonly EventPublicVisibility[] = ['public', 'unlisted'];

function isValidPublishVisibility(value: unknown): value is EventPublicVisibility {
  return typeof value === 'string' && (CANONICAL_PUBLISH_VISIBILITIES as readonly string[]).includes(value);
}

// The same conflict response for "this Event is no longer a Draft", whether
// that is discovered by the ownership read or by the Draft-scoped update
// matching no row (a concurrent Publish that won the race). Mirrors the
// existing non-Draft 409 convention of `PATCH /api/events/draft/[eventId]`.
function notADraftResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Only Draft events can be published.' },
    { status: 409 }
  );
}

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;
  const ownership = await getOwnedEventById<PublishEventRow>(db, eventId, auth.studioId, PUBLISH_COLUMNS);
  if (isOwnershipError(ownership)) return ownership.error;
  const existing = ownership.event;

  // An already-published Event is never republished: its frozen snapshot is
  // the historical record and must not be rewritten from today's mutable
  // Partner data.
  if (existing.page_state !== 'draft') {
    return notADraftResponse();
  }

  // Fail closed on the inconsistent state the standalone freeze helper can
  // produce (frozen snapshot on a still-Draft Event): the snapshot may have
  // been frozen before later Credit edits, so neither silently publishing it
  // nor silently overwriting it is safe. This requires deliberate resolution
  // rather than a guess by this route.
  if (existing.published_credits !== null && existing.published_credits !== undefined) {
    return NextResponse.json(
      {
        success: false,
        error:
          'This Draft already carries a frozen public credit snapshot and cannot be published automatically. Its snapshot must be resolved deliberately before publishing.',
      },
      { status: 409 }
    );
  }

  // Publish requires an explicit, provider-chosen Public/Unlisted visibility
  // (Visibility Foundation Gate) — never silently inherited from the Draft's
  // persistence-owned 'unlisted' default, and never any other
  // event_visibility value. Checked before the credit read below so an
  // invalid request never triggers that extra query.
  let body: PublishRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isValidPublishVisibility(body.visibility)) {
    return NextResponse.json(
      {
        success: false,
        error: 'A visibility choice of "public" or "unlisted" is required to publish.',
        field: 'visibility',
      },
      { status: 400 }
    );
  }
  const visibility = body.visibility;

  // Baseline PART-008 says at least one approved public Event Credit "should
  // normally" be selected before publishing — advisory, not a hard gate, so a
  // credit-less Event still publishes with a valid empty `[]` snapshot
  // (distinguishable from an unfrozen `null`) rather than being blocked here.
  const ownedCredits = await loadOwnedEventCreditsWithPartners(db, existing.id);
  if (ownedCredits === null) {
    // Fail closed: a transient credit-read failure must never publish a page
    // with an accidentally empty or partial historical credit snapshot.
    return NextResponse.json(
      { success: false, error: "Failed to load this event's Event Credits." },
      { status: 500 }
    );
  }
  const publishedCredits = projectPublicEventCredits(ownedCredits);

  // One row update carries both halves of Publish. The filter is scoped to
  // the Event id, the authenticated studio, AND the expected Draft state, so
  // a stale or concurrent request cannot rewrite an already-published row —
  // the earlier ownership read is not the only protection.
  const { data, error } = await db
    .from('events')
    .update({ published_credits: publishedCredits, page_state: 'published', event_visibility: visibility })
    .eq('id', existing.id)
    .eq('studio_id', auth.studioId)
    .eq('page_state', 'draft')
    .select('id, page_state, event_visibility')
    .maybeSingle();

  if (error) {
    // Neither the snapshot nor the transition happened — both live in this
    // single failed statement, so neither may be reported as successful.
    return NextResponse.json(
      { success: false, error: 'Publish failed: ' + error.message },
      { status: 500 }
    );
  }

  if (!data) {
    // No row matched the Draft-scoped filter: another request published this
    // Event between the read above and this write. This request changed
    // nothing and must not report success.
    return notADraftResponse();
  }

  return NextResponse.json({
    success: true,
    id: existing.id,
    pageState: 'published',
    visibility,
    publishedCredits,
  });
}
