import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';

/**
 * PATCH /api/events/[eventId]/thumbnail
 *
 * Owner-only manual SEO/social thumbnail assignment (Baseline SEO-001).
 * Scoped by both event id and studio_id via getOwnedEventById before any
 * write. Deliberately NOT under /api/events/draft/... — the thumbnail is
 * event SEO metadata that must remain assignable after Publish, so this
 * route must not inherit the Draft-only page_state restriction that
 * /api/events/draft/[eventId] enforces.
 *
 * The client must upload the file first via the existing
 * POST /api/r2-upload (purpose: 'thumbnail') and pass the returned URL here.
 * This route never talks to R2 itself — it only validates and assigns.
 */

const db = supabaseAdmin || supabase;

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

interface ThumbnailEventRow {
  id: string;
}

interface ThumbnailBody {
  thumbnailUrl?: unknown;
}

// The submitted URL must be an object this studio itself uploaded through
// /api/r2-upload's 'thumbnail' purpose — exact origin match against the
// configured R2 public URL, plus a path prefix scoped to the caller's own
// studio id. Rejects malformed URLs, external origins, another studio's
// objects, and non-thumbnail R2 paths.
function isValidThumbnailUrl(rawUrl: string, studioId: string): boolean {
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

  const expectedPrefix = `/studios/${studioId}/thumbnail/`;
  return submitted.pathname.startsWith(expectedPrefix);
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;
  const ownership = await getOwnedEventById<ThumbnailEventRow>(db, eventId, auth.studioId, 'id');
  if (isOwnershipError(ownership)) return ownership.error;
  const existing = ownership.event;

  let body: ThumbnailBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.thumbnailUrl !== 'string' || !body.thumbnailUrl) {
    return NextResponse.json({ success: false, error: 'thumbnailUrl is required' }, { status: 400 });
  }

  if (!isValidThumbnailUrl(body.thumbnailUrl, auth.studioId)) {
    return NextResponse.json({ success: false, error: 'Invalid thumbnail URL' }, { status: 400 });
  }

  const { error: updateError } = await db
    .from('events')
    .update({ thumbnail_url: body.thumbnailUrl })
    .eq('id', existing.id)
    .eq('studio_id', auth.studioId);

  if (updateError) {
    return NextResponse.json(
      { success: false, error: 'Thumbnail update failed: ' + updateError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, thumbnailUrl: body.thumbnailUrl });
}
