import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';
import { invitationVideoDbValueToFormString } from '@/lib/eventContract';

/**
 * GET /api/media
 *
 * Provider-level global Media Library (Baseline MED-001: "the provider
 * receives a global Media Library and an event-scoped Media tab").
 * Read-only aggregation, studio-scoped via auth.studioId — never a
 * client-supplied studio id. Reuses the existing per-event media columns
 * (`thumbnail_url`, `invitation_video_url`, `gallery_urls`) rather than
 * introducing a second media-metadata table; each row links back to the
 * owning event's real Media tab, where the actual upload/assign/remove
 * mutations already live (this route performs no mutation and no upload).
 *
 * Recordings and replay assets (also named in MED-002) are Livestream/VOD
 * lifecycle concepts not implemented yet in this package (see Milestone H/N)
 * — this route reports `recordingsAvailable: false` rather than fabricating
 * any recording data, per the "no fabricated stats" rule.
 */

const db = supabaseAdmin || supabase;

interface MediaLibraryEventRow {
  id: string;
  groom_name: string | null;
  bride_name: string | null;
  slug: string | null;
  page_state: string | null;
  thumbnail_url: string | null;
  invitation_video_url: string | string[] | null;
  gallery_urls: string[] | null;
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await db
    .from('events')
    .select('id, groom_name, bride_name, slug, page_state, thumbnail_url, invitation_video_url, gallery_urls')
    .eq('studio_id', auth.studioId)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to load Media Library: ' + error.message }, { status: 500 });
  }

  const rows = (data ?? []) as MediaLibraryEventRow[];

  const items = rows.map((row) => {
    const slideshowImages = Array.isArray(row.gallery_urls) ? row.gallery_urls : [];
    const invitationVideoUrl = invitationVideoDbValueToFormString(row.invitation_video_url) || null;
    return {
      eventId: row.id,
      eventName: [row.groom_name, row.bride_name].filter(Boolean).join(' & ') || 'Untitled event',
      slug: row.slug,
      pageState: row.page_state,
      thumbnailUrl: row.thumbnail_url,
      hasInvitationVideo: Boolean(invitationVideoUrl),
      slideshowImageCount: slideshowImages.length,
    };
  });

  const totals = {
    eventsWithThumbnail: items.filter((i) => Boolean(i.thumbnailUrl)).length,
    eventsWithInvitationVideo: items.filter((i) => i.hasInvitationVideo).length,
    totalSlideshowImages: items.reduce((sum, i) => sum + i.slideshowImageCount, 0),
    recordingsAvailable: false,
  };

  return NextResponse.json({ success: true, items, totals });
}
