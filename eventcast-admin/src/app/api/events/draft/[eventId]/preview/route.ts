import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';
import { CANONICAL_WEDDING_TEMPLATE_01_HTML } from '@/lib/canonicalWeddingTemplateHtml';
import {
  canonicalRecordToWeddingTemplateRenderRow,
  primaryPublicEventCreditToPhotographerRow,
  projectPublicEventCredits,
} from '@/lib/eventContract';
import { loadOwnedEventCreditsWithPartners } from '@/lib/eventCreditsLoader';
import { renderEvent, type EventRow } from '@/lib/weddingTemplateRenderer';

/**
 * Renders an owned Draft through the exact canonical renderer the public
 * Worker uses (baseline TPL-003/CRT-011 preview parity foundation), for
 * every `template_id` this route supports (`SUPPORTED_PREVIEW_TEMPLATES`
 * below). Deliberately read-only and side-effect-free: no write to
 * `events`, no SRS/Media Agent lookup, no YouTube/media/billing call — the
 * Draft stays exactly as it was before this request.
 *
 * Each template's markup comes from its own embedded copy of the Worker's
 * template asset (`@/lib/canonicalWeddingTemplateHtml`). The deployed Worker
 * has no project filesystem to read that asset from at request time, so this
 * route must never reach for `node:fs`/`node:path`/`process.cwd()` — that is
 * true under the Node.js runtime this app now targets on Cloudflare Workers,
 * and was equally true under the Edge runtime it previously used. No copy can
 * drift silently: `tests/contract/canonicalWeddingTemplateHtml.test.ts` fails
 * if the embedded copy stops matching its Worker template file.
 *
 * `wedding-floral-pastel-01` is intentionally not in `SUPPORTED_PREVIEW_TEMPLATES`
 * yet (build-blocker correction, 2026-09-19): its canonical HTML module and
 * the Worker template/release it would need to stay in sync with are still
 * uncommitted prototype work (see `docs/project-state/CURRENT_STATE.md`).
 * Adding it back requires committing that matched set together, not just an
 * import here — a Draft with this `template_id` gets the route's existing
 * clean "Preview is not available for template..." 400 in the meantime.
 *
 * Known gap, not fixed here: `PREVIEW_COLUMNS`/`canonicalRecordToWeddingTemplateRenderRow`
 * only carry the field set the canonical Draft/`CanonicalEventRecord`
 * contract captures (identity, schedule, venue, venue map link, guest-photo-
 * wall toggle, custom headline, thumbnail — widened by the Create Event
 * redesign to add venue map link and custom headline; see `eventContract.ts`).
 * `gallery_urls`, `invitation_video_url`, `notes`, `custom_initials`, and
 * `loader_photo_url` still exist on `public.events` and are read directly by
 * the public Worker (`select=*`), but are deliberately kept on their own
 * post-creation routes (`/api/events/[eventId]/media`, etc.) rather than the
 * canonical Draft contract, so this preview route still cannot select or
 * thread those for *any* template without widening that shared adapter — a
 * larger, separate contract change, not a narrow per-template addition.
 */

const db = supabaseAdmin || supabase;

const PREVIEW_COLUMNS =
  'id, event_type, groom_name, bride_name, venue_name, venue_map_link, slug, template_id, scheduled_start_at, guest_photo_wall_enabled, studio_id, thumbnail_url, custom_top_title';

/** Every `template_id` this route can preview, and the canonical markup for each. */
const SUPPORTED_PREVIEW_TEMPLATES: Record<string, string> = {
  'wedding-template-01': CANONICAL_WEDDING_TEMPLATE_01_HTML,
};

interface DraftPreviewRow {
  id: string;
  event_type: string | null;
  groom_name: string | null;
  bride_name: string | null;
  venue_name: string | null;
  venue_map_link: string | null;
  slug: string | null;
  template_id: string | null;
  scheduled_start_at: string | null;
  guest_photo_wall_enabled: boolean | null;
  studio_id: string;
  thumbnail_url: string | null;
  custom_top_title: string | null;
}

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;
  const ownership = await getOwnedEventById<DraftPreviewRow>(db, eventId, auth.studioId, PREVIEW_COLUMNS);
  if (isOwnershipError(ownership)) return ownership.error;
  const event = ownership.event;

  // No silent fallback to a different template's markup (baseline CRT-003)
  // if this Draft's `template_id` isn't one this route knows how to preview.
  const templateHtml = event.template_id ? SUPPORTED_PREVIEW_TEMPLATES[event.template_id] : undefined;
  if (!templateHtml) {
    return NextResponse.json(
      { success: false, error: `Preview is not available for template "${event.template_id}".` },
      { status: 400 }
    );
  }
  if (!event.scheduled_start_at) {
    return NextResponse.json(
      { success: false, error: 'This Draft is missing a scheduled start time.' },
      { status: 400 }
    );
  }
  if (!event.slug) {
    return NextResponse.json({ success: false, error: 'This Draft is missing a link (slug).' }, { status: 400 });
  }

  const ownedCredits = await loadOwnedEventCreditsWithPartners(db, event.id);
  if (ownedCredits === null) {
    return NextResponse.json(
      { success: false, error: 'Failed to load this Draft\'s Event Credits.' },
      { status: 500 }
    );
  }
  const eventCredits = projectPublicEventCredits(ownedCredits);

  const renderRow: EventRow = canonicalRecordToWeddingTemplateRenderRow(
    {
      id: event.id,
      studioId: event.studio_id,
      slug: event.slug,
      eventType: (event.event_type || 'Wedding') as 'Wedding',
      groomName: event.groom_name || '',
      brideName: event.bride_name || '',
      scheduledStartAt: event.scheduled_start_at,
      venueName: event.venue_name || '',
      venueMapLink: event.venue_map_link,
      templateId: event.template_id,
      guestPhotoWallEnabled: event.guest_photo_wall_enabled !== false,
      thumbnailUrl: event.thumbnail_url,
      customTopTitle: event.custom_top_title,
    },
    eventCredits
  );

  const html = renderEvent(
    templateHtml,
    renderRow,
    primaryPublicEventCreditToPhotographerRow(eventCredits),
    event.slug,
    {
      SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    },
    'Unknown',
    req.headers.get('host') ?? 'eventcast.pro',
    /* hasLivePlayback */ false // Draft preview never activates SRS/Media Agent playback.
  );

  return NextResponse.json({ success: true, html });
}
