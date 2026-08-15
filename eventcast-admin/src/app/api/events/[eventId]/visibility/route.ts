import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { getOwnedEventById, isOwnershipError } from '@/lib/ownership';
import type { EventPublicVisibility } from '@/lib/eventContract';

/**
 * PATCH /api/events/[eventId]/visibility
 *
 * Owner-only post-Publish Public/Unlisted visibility change (Visibility
 * Foundation Gate). Deliberately separate from `POST /api/events/[eventId]/publish`
 * (the one-shot Draft -> Published transition, which requires its own
 * explicit visibility choice) and from `PATCH /api/events/draft/[eventId]`
 * (Draft-only, 409s once published) — this route does the opposite: it only
 * ever acts on an already-Published Event, writes nothing but
 * `event_visibility`, and never touches `published_credits` or `page_state`.
 * A Published Event may therefore switch Public -> Unlisted or Unlisted ->
 * Public without changing its frozen Event Credit snapshot.
 */

export const runtime = 'edge';

const db = supabaseAdmin || supabase;

// The only two canonical values this route may write. Legacy `private`/
// `synthetic` are deliberately never selectable through this endpoint.
const CANONICAL_VISIBILITIES: readonly EventPublicVisibility[] = ['public', 'unlisted'];

function isValidVisibility(value: unknown): value is EventPublicVisibility {
  return typeof value === 'string' && (CANONICAL_VISIBILITIES as readonly string[]).includes(value);
}

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

interface VisibilityEventRow {
  id: string;
  page_state: string | null;
}

interface VisibilityRequestBody {
  visibility?: unknown;
}

function notPublishedResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: "Only a Published event's visibility can be changed through this endpoint." },
    { status: 409 }
  );
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;
  const ownership = await getOwnedEventById<VisibilityEventRow>(db, eventId, auth.studioId, 'id, page_state');
  if (isOwnershipError(ownership)) return ownership.error;
  const existing = ownership.event;

  // A Draft's visibility is persistence-owned and has no public effect yet
  // (see POST /api/events/draft) — this endpoint only ever changes an
  // already-Published Event's live visibility.
  if (existing.page_state !== 'published') {
    return notPublishedResponse();
  }

  let body: VisibilityRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!isValidVisibility(body.visibility)) {
    return NextResponse.json(
      { success: false, error: 'visibility must be "public" or "unlisted".', field: 'visibility' },
      { status: 400 }
    );
  }
  const visibility = body.visibility;

  // Scoped by id, studio ownership, AND the expected Published state, so a
  // concurrent Draft-state change cannot be raced past — the same pattern
  // the Publish route uses for its own guarded update.
  const { data, error: updateError } = await db
    .from('events')
    .update({ event_visibility: visibility })
    .eq('id', existing.id)
    .eq('studio_id', auth.studioId)
    .eq('page_state', 'published')
    .select('id, event_visibility')
    .maybeSingle();

  if (updateError) {
    return NextResponse.json(
      { success: false, error: 'Visibility update failed: ' + updateError.message },
      { status: 500 }
    );
  }

  if (!data) {
    return notPublishedResponse();
  }

  return NextResponse.json({ success: true, id: existing.id, visibility });
}
