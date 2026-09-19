import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin, canMutateStudioResources } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';
import {
  deriveLegacySchedule,
  draftInputToCanonicalRecord,
  type CanonicalEventType,
  type EventDraftInput,
} from '@/lib/eventContract';

/**
 * PATCH /api/events/[eventId]/details
 *
 * Post-Publish Core Details Editing. Deliberately a separate endpoint from
 * `PATCH /api/events/draft/[eventId]` (Draft-only, 409s on anything but
 * `page_state = 'draft'`) rather than widening that route's own semantics —
 * this route does the opposite: it only ever acts on an already-Published,
 * non-archived Event.
 *
 * Editable: groom/bride names, custom headline, scheduled date/time, venue
 * name, venue map link, Guest Photo Wall toggle — the same
 * `draftInputToCanonicalRecord()` validation the Draft path already uses, so
 * behavior can't silently drift between the two editors.
 *
 * Locked, by design (Baseline V2.1 §01: "changing the slug... must not break
 * previously shared links" — no alias/redirect mechanism exists in this
 * repository): slug, template_id, template_version, page_state,
 * event_visibility, published_credits, thumbnail_url, studio_id. A request
 * that includes `slug` is rejected outright rather than silently ignored.
 *
 * Never touches `draft_last_activity_at` — that column is a Draft-only
 * automation input (Event Lifecycle Management package) and a Published
 * event is excluded from that automation by construction.
 */

const db = supabaseAdmin || supabase;

const PUBLISHED_DETAILS_COLUMNS =
  'id, event_type, groom_name, bride_name, venue_name, venue_map_link, slug, template_id, template_version, scheduled_start_at, page_state, guest_photo_wall_enabled, thumbnail_url, event_visibility, archived_at, custom_top_title';

interface PublishedDetailsEventRow {
  id: string;
  event_type: string | null;
  groom_name: string | null;
  bride_name: string | null;
  venue_name: string | null;
  venue_map_link: string | null;
  slug: string | null;
  template_id: string | null;
  template_version: string | null;
  scheduled_start_at: string | null;
  page_state: string | null;
  guest_photo_wall_enabled: boolean | null;
  thumbnail_url: string | null;
  event_visibility: string | null;
  archived_at: string | null;
  custom_top_title: string | null;
}

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

interface PublishedDetailsUpdateBody {
  groomName?: unknown;
  brideName?: unknown;
  scheduledStartAtLocal?: unknown;
  venueName?: unknown;
  venueMapLink?: unknown;
  customTopTitle?: unknown;
  guestPhotoWallEnabled?: unknown;
  slug?: unknown;
}

function notPublishedResponse(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: 'Only a Published event can be edited through this endpoint. Use the Draft editor for events that have not been published yet.',
    },
    { status: 409 }
  );
}

function archivedResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'This event is archived. Restore it before editing its details.' },
    { status: 409 }
  );
}

function staleStateResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: "This event's state changed and could not be updated. Please refresh and try again." },
    { status: 409 }
  );
}

/**
 * Only used here (not the shared `eventContract.ts`, so the already-completed
 * Draft/Create Event path is left byte-unchanged) — a non-empty
 * `venueMapLink` must be an absolute http(s) URL. Blank/omitted clears the
 * field, same tolerance as the Draft path.
 */
function isValidOptionalHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Compares two `scheduled_start_at` values by the instant they represent, not
 * their printed string — Supabase normalizes a `timestamptz` read to `+00:00`
 * regardless of the offset it was written with (see
 * `scheduledStartAtToIstDateTimeLocal`'s own doc comment), so a same-instant
 * value written as `+05:30` and read back as `+00:00` must never be reported
 * as a schedule change. A previously-null/unparseable value is always
 * reported as changed.
 */
function scheduledInstantChanged(previous: string | null, next: string): boolean {
  const previousMs = previous ? new Date(previous).getTime() : NaN;
  const nextMs = new Date(next).getTime();
  return previousMs !== nextMs || Number.isNaN(previousMs);
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json({ success: false, error: 'Forbidden: read-only studio role' }, { status: 403 });
  }

  const { eventId } = await params;
  const ownership = await getOwnedEventById<PublishedDetailsEventRow>(db, eventId, auth.studioId, PUBLISHED_DETAILS_COLUMNS);
  if (isOwnershipError(ownership)) return ownership.error;
  const existing = ownership.event;

  // Archive takes precedence over page_state, same precedence order
  // eventLifecycle.ts already established for display purposes — an
  // archived event is not editable here regardless of its page_state.
  if (existing.archived_at) {
    return archivedResponse();
  }
  if (existing.page_state !== 'published') {
    return notPublishedResponse();
  }

  let body: PublishedDetailsUpdateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  // Slug is locked after Publish (see file header). Rejected outright rather
  // than silently ignored, so a client relying on it being applied fails
  // loudly instead of assuming success.
  if (body.slug !== undefined) {
    return NextResponse.json(
      { success: false, error: 'The event link (slug) cannot be changed after publishing.', field: 'slug' },
      { status: 400 }
    );
  }

  if (typeof body.venueMapLink === 'string' && !isValidOptionalHttpUrl(body.venueMapLink)) {
    return NextResponse.json(
      { success: false, error: 'Venue map link must be a valid http:// or https:// URL.', field: 'venueMapLink' },
      { status: 400 }
    );
  }

  // eventType, templateId, and slug are fixed here — always the stored row's
  // own values, never client input, so this endpoint structurally cannot
  // smuggle in a different template, type, or link.
  const draftInput: EventDraftInput = {
    eventType: (existing.event_type || '') as CanonicalEventType,
    groomName: typeof body.groomName === 'string' ? body.groomName : '',
    brideName: typeof body.brideName === 'string' ? body.brideName : '',
    scheduledStartAtLocal: typeof body.scheduledStartAtLocal === 'string' ? body.scheduledStartAtLocal : '',
    venueName: typeof body.venueName === 'string' ? body.venueName : '',
    venueMapLink: typeof body.venueMapLink === 'string' ? body.venueMapLink : existing.venue_map_link,
    slug: existing.slug || '',
    templateId: existing.template_id || '',
    customTopTitle: typeof body.customTopTitle === 'string' ? body.customTopTitle : existing.custom_top_title,
    guestPhotoWallEnabled:
      typeof body.guestPhotoWallEnabled === 'boolean'
        ? body.guestPhotoWallEnabled
        : existing.guest_photo_wall_enabled !== false,
  };

  const result = draftInputToCanonicalRecord(draftInput);
  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error.message, field: result.error.field },
      { status: 400 }
    );
  }
  const record = result.record;

  const legacy = deriveLegacySchedule(record.scheduledStartAt);
  const scheduleChanged = scheduledInstantChanged(existing.scheduled_start_at, record.scheduledStartAt);

  // Scoped by id, studio ownership, expected Published state, AND
  // archived_at IS NULL — same guarded-update pattern as the
  // visibility/publish routes, widened so a concurrent archive between the
  // ownership read and this write cannot be raced past either (page_state
  // alone would not catch that: an archived event can still carry
  // page_state = 'published').
  const { data, error: updateError } = await db
    .from('events')
    .update({
      groom_name: record.groomName,
      bride_name: record.brideName,
      venue_name: record.venueName,
      venue_map_link: record.venueMapLink,
      scheduled_start_at: record.scheduledStartAt,
      event_date: legacy.eventDate,
      event_time: legacy.eventTime,
      timer_target_time: legacy.timerTargetTime,
      guest_photo_wall_enabled: record.guestPhotoWallEnabled,
      custom_top_title: record.customTopTitle,
    })
    .eq('id', existing.id)
    .eq('studio_id', auth.studioId)
    .eq('page_state', 'published')
    .is('archived_at', null)
    .select('id')
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ success: false, error: 'Update failed: ' + updateError.message }, { status: 500 });
  }

  if (!data) {
    return staleStateResponse();
  }

  return NextResponse.json({ success: true, id: existing.id, scheduleChanged });
}
