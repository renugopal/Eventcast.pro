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
 * Renders an owned Draft through the exact canonical `wedding-template-01`
 * (= TLF-001) renderer the public Worker uses (baseline TPL-003/CRT-011
 * preview parity foundation). Deliberately read-only and side-effect-free:
 * no write to `events`, no SRS/Media Agent lookup, no YouTube/media/billing
 * call — the Draft stays exactly as it was before this request.
 *
 * The template markup comes from `@/lib/canonicalWeddingTemplateHtml`, an
 * embedded copy of the Worker's template asset, because this route runs on the
 * Edge Runtime where there is no filesystem to read that asset from. The two
 * cannot drift: `tests/contract/canonicalWeddingTemplateHtml.test.ts` fails if
 * the embedded copy stops matching the Worker template file.
 */

export const runtime = 'edge';

const db = supabaseAdmin || supabase;

const PREVIEW_COLUMNS =
  'id, event_type, groom_name, bride_name, venue_name, slug, template_id, scheduled_start_at, guest_photo_wall_enabled, studio_id, thumbnail_url';

interface DraftPreviewRow {
  id: string;
  event_type: string | null;
  groom_name: string | null;
  bride_name: string | null;
  venue_name: string | null;
  slug: string | null;
  template_id: string | null;
  scheduled_start_at: string | null;
  guest_photo_wall_enabled: boolean | null;
  studio_id: string;
  thumbnail_url: string | null;
}

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

// The Draft slice supports exactly one template — no silent fallback to a
// different template's markup (baseline CRT-003) if this ever drifts.
const SUPPORTED_TEMPLATE_ID = 'wedding-template-01';

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;
  const ownership = await getOwnedEventById<DraftPreviewRow>(db, eventId, auth.studioId, PREVIEW_COLUMNS);
  if (isOwnershipError(ownership)) return ownership.error;
  const event = ownership.event;

  if (event.template_id !== SUPPORTED_TEMPLATE_ID) {
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

  const templateHtml = CANONICAL_WEDDING_TEMPLATE_01_HTML;

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
      templateId: event.template_id,
      guestPhotoWallEnabled: event.guest_photo_wall_enabled !== false,
      thumbnailUrl: event.thumbnail_url,
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
