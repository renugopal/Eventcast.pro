import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';
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
 * call — the Draft stays exactly as it was before this request. This route
 * needs the Node.js runtime (not `edge`, unlike the other Draft routes) to
 * read the canonical template HTML file from disk.
 */

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

function readCanonicalTemplateHtml(): string | null {
  try {
    // The exact template asset the public Worker deploys from — reading it
    // here (rather than keeping a second copy) is what keeps this a single
    // canonical template source (baseline TPL-002) instead of a second,
    // divergent TLF-001 implementation.
    const templatePath = path.join(
      process.cwd(),
      '..',
      'workers',
      'render-event-page',
      'templates',
      'wedding-template-01',
      'index.html'
    );
    return fs.readFileSync(templatePath, 'utf-8');
  } catch {
    return null;
  }
}

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

  const templateHtml = readCanonicalTemplateHtml();
  if (!templateHtml) {
    return NextResponse.json(
      { success: false, error: 'The canonical template asset is unavailable.' },
      { status: 500 }
    );
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
