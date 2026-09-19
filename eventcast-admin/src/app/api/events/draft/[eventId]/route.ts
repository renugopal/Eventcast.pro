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
 * Reopen (`GET`) and edit-and-save (`PATCH`) a Draft by its stable event
 * UUID. Both verbs are scoped to the requesting studio via
 * `getOwnedEventById` before any row is read or mutated — a cross-tenant or
 * nonexistent id gets the same generic 404. Neither verb ever touches
 * billing, YouTube, media upload, SRS, Media Agent activation, or
 * Restreamer.
 */

const db = supabaseAdmin || supabase;

const DRAFT_COLUMNS =
  'id, event_type, groom_name, bride_name, venue_name, venue_map_link, slug, template_id, template_version, scheduled_start_at, page_state, guest_photo_wall_enabled, thumbnail_url, event_visibility, archived_at, custom_top_title';

interface DraftEventRow {
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
  /** Read-only here — never accepted from this route's PATCH body (Visibility Foundation Gate). */
  event_visibility: string | null;
  /** Read-only here (Event Workspace Settings tab writes it via /api/events/delete + /api/events/restore, never this route). */
  archived_at: string | null;
  custom_top_title: string | null;
}

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;
  const ownership = await getOwnedEventById<DraftEventRow>(db, eventId, auth.studioId, DRAFT_COLUMNS);
  if (isOwnershipError(ownership)) return ownership.error;

  return NextResponse.json({ success: true, event: ownership.event });
}

interface DraftUpdateBody {
  groomName?: unknown;
  brideName?: unknown;
  scheduledStartAtLocal?: unknown;
  venueName?: unknown;
  venueMapLink?: unknown;
  slug?: unknown;
  customTopTitle?: unknown;
  guestPhotoWallEnabled?: unknown;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  // Provider Event Workspace Premium Redesign package — same owner/admin
  // gate every other event-mutation route already enforces. GET above
  // remains open to every studio member, unchanged.
  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json({ success: false, error: 'Forbidden: read-only studio role' }, { status: 403 });
  }

  const { eventId } = await params;
  const ownership = await getOwnedEventById<DraftEventRow>(db, eventId, auth.studioId, DRAFT_COLUMNS);
  if (isOwnershipError(ownership)) return ownership.error;
  const existing = ownership.event;

  // This endpoint only ever edits a Draft. Once a later Publish task
  // introduces a Published page state, that path must use its own
  // endpoint rather than this one.
  if (existing.page_state !== 'draft') {
    return NextResponse.json(
      { success: false, error: 'Only Draft events can be edited through this endpoint.' },
      { status: 409 }
    );
  }

  let body: DraftUpdateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  // eventType and templateId are fixed at creation for this slice — the
  // stored row's own values are reused rather than trusting client input,
  // so a PATCH request cannot smuggle in a different template or type.
  const draftInput: EventDraftInput = {
    eventType: (existing.event_type || '') as CanonicalEventType,
    groomName: typeof body.groomName === 'string' ? body.groomName : '',
    brideName: typeof body.brideName === 'string' ? body.brideName : '',
    scheduledStartAtLocal: typeof body.scheduledStartAtLocal === 'string' ? body.scheduledStartAtLocal : '',
    venueName: typeof body.venueName === 'string' ? body.venueName : '',
    venueMapLink: typeof body.venueMapLink === 'string' ? body.venueMapLink : existing.venue_map_link,
    slug: typeof body.slug === 'string' ? body.slug : '',
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

  if (record.slug !== existing.slug) {
    const { data: slugMatches, error: slugCheckError } = await db
      .from('events')
      .select('id')
      .eq('studio_id', auth.studioId)
      .eq('slug', record.slug)
      .neq('id', existing.id)
      .limit(1);

    if (slugCheckError) {
      return NextResponse.json({ success: false, error: 'Slug availability check failed: ' + slugCheckError.message }, { status: 500 });
    }
    if (slugMatches && slugMatches.length > 0) {
      return NextResponse.json(
        { success: false, error: 'This event link is already in use for your studio. Please choose a different slug.', field: 'slug' },
        { status: 409 }
      );
    }
  }

  const legacy = deriveLegacySchedule(record.scheduledStartAt);

  const { error: updateError } = await db
    .from('events')
    .update({
      groom_name: record.groomName,
      bride_name: record.brideName,
      venue_name: record.venueName,
      venue_map_link: record.venueMapLink,
      slug: record.slug,
      scheduled_start_at: record.scheduledStartAt,
      event_date: legacy.eventDate,
      event_time: legacy.eventTime,
      timer_target_time: legacy.timerTargetTime,
      guest_photo_wall_enabled: record.guestPhotoWallEnabled,
      custom_top_title: record.customTopTitle,
      // Resets the 7-day Draft inactivity timer (Event Lifecycle
      // automation, migration 0038). Only reached once this request has
      // already passed validation and the page_state !== 'draft'
      // rejection above, so this only ever stamps a real, accepted edit
      // to an actual Draft.
      draft_last_activity_at: new Date().toISOString(),
    })
    .eq('id', existing.id)
    .eq('studio_id', auth.studioId);

  if (updateError) {
    return NextResponse.json({ success: false, error: 'Draft update failed: ' + updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: existing.id, slug: record.slug });
}
