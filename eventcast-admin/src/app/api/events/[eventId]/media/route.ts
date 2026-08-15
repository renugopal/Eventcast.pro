import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin, canMutateStudioResources } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';
import { invitationVideoUrlsToDbValue, invitationVideoDbValueToFormString } from '@/lib/eventContract';

/**
 * GET/PATCH /api/events/[eventId]/media
 *
 * Event-scoped Invitation Video and Photo Slideshow management (Baseline
 * V2.1 MED-001/MED-002, CRT-009 optional modules). Deliberately separate
 * from the Draft-only /api/events/draft/[eventId] route — like the
 * thumbnail route, these optional modules must remain assignable after
 * Publish, so this route is never restricted to page_state = 'draft'.
 *
 * Reuses the existing scalar `invitation_video_url` text column (newline-
 * joined, via the already-existing eventContract helpers) and the existing
 * `gallery_urls` text[] column — both already read by the shared
 * `renderEvent()` and rendered on the public page — no migration is
 * required for either module.
 *
 * The client must upload each file first via the existing
 * POST /api/r2-upload (purpose: 'video' for the invitation video, purpose:
 * 'gallery' for slideshow images) and pass the returned URL(s) here. This
 * route never talks to R2 itself — it only validates and assigns/reorders.
 */

export const runtime = 'edge';

const db = supabaseAdmin || supabase;

const MEDIA_COLUMNS = 'id, invitation_video_url, gallery_urls';

interface MediaEventRow {
  id: string;
  invitation_video_url: string | string[] | null;
  gallery_urls: string[] | null;
}

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

const MAX_SLIDESHOW_IMAGES = 30;

/**
 * Validates a submitted R2 URL is an object this studio itself uploaded
 * through /api/r2-upload under the given purpose — same exact-origin +
 * studio-scoped-path-prefix check as the thumbnail route.
 */
function isValidStudioR2Url(rawUrl: string, studioId: string, purpose: string): boolean {
  const r2PublicUrl = process.env.R2_PUBLIC_URL;
  if (!r2PublicUrl) return false;

  let submitted: URL;
  let expected: URL;
  try {
    submitted = new URL(rawUrl);
    expected = new URL(r2PublicUrl);
  } catch {
    return false;
  }

  if (submitted.origin !== expected.origin) return false;

  const expectedPrefix = `/studios/${studioId}/${purpose}/`;
  return submitted.pathname.startsWith(expectedPrefix);
}

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;
  const ownership = await getOwnedEventById<MediaEventRow>(db, eventId, auth.studioId, MEDIA_COLUMNS);
  if (isOwnershipError(ownership)) return ownership.error;
  const event = ownership.event;

  return NextResponse.json({
    success: true,
    invitationVideoUrl: invitationVideoDbValueToFormString(event.invitation_video_url) || null,
    slideshowImages: Array.isArray(event.gallery_urls) ? event.gallery_urls : [],
  });
}

interface MediaUpdateBody {
  invitationVideoUrl?: unknown;
  slideshowImages?: unknown;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  if (!canMutateStudioResources(auth.studioMemberRole)) {
    return NextResponse.json({ success: false, error: 'Forbidden: read-only studio role' }, { status: 403 });
  }

  const { eventId } = await params;
  const ownership = await getOwnedEventById<MediaEventRow>(db, eventId, auth.studioId, 'id');
  if (isOwnershipError(ownership)) return ownership.error;
  const existing = ownership.event;

  let body: MediaUpdateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const update: { invitation_video_url?: string | null; gallery_urls?: string[] } = {};

  if ('invitationVideoUrl' in body) {
    if (body.invitationVideoUrl === null) {
      update.invitation_video_url = null;
    } else if (typeof body.invitationVideoUrl === 'string' && body.invitationVideoUrl) {
      if (!isValidStudioR2Url(body.invitationVideoUrl, auth.studioId, 'video')) {
        return NextResponse.json({ success: false, error: 'Invalid invitation video URL' }, { status: 400 });
      }
      update.invitation_video_url = invitationVideoUrlsToDbValue(body.invitationVideoUrl);
    } else {
      return NextResponse.json(
        { success: false, error: 'invitationVideoUrl must be a URL string or null' },
        { status: 400 }
      );
    }
  }

  if ('slideshowImages' in body) {
    if (!Array.isArray(body.slideshowImages) || body.slideshowImages.some((u) => typeof u !== 'string')) {
      return NextResponse.json(
        { success: false, error: 'slideshowImages must be an array of URL strings' },
        { status: 400 }
      );
    }
    const images = body.slideshowImages as string[];
    if (images.length > MAX_SLIDESHOW_IMAGES) {
      return NextResponse.json(
        { success: false, error: `A slideshow may have at most ${MAX_SLIDESHOW_IMAGES} images.` },
        { status: 400 }
      );
    }
    for (const url of images) {
      if (!isValidStudioR2Url(url, auth.studioId, 'gallery')) {
        return NextResponse.json({ success: false, error: `Invalid slideshow image URL: ${url}` }, { status: 400 });
      }
    }
    // Array order IS the display order — the shared renderer emits
    // `gallery_urls` verbatim into `window.WEDDING_CONFIG.gallery`, so no
    // separate ordering field is needed.
    update.gallery_urls = images;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ success: false, error: 'No recognized fields to update' }, { status: 400 });
  }

  const { error: updateError } = await db
    .from('events')
    .update(update)
    .eq('id', existing.id)
    .eq('studio_id', auth.studioId);

  if (updateError) {
    return NextResponse.json({ success: false, error: 'Media update failed: ' + updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
