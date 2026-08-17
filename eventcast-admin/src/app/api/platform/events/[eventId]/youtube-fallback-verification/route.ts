import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdmin';
import { verifyYoutubeFallback } from '@/lib/eventRecording';
import { isValidYoutubeWatchUrl } from '@/lib/youtubeUrl';

/**
 * POST /api/platform/events/[eventId]/youtube-fallback-verification
 *
 * Narrow Milestone N completion carve-out — NOT part of the Super Admin
 * Operations Console (Milestone M), which remains unstarted. Scope is
 * strictly limited to this one action: manually attesting that a single
 * event's YouTube replay fallback (Baseline STO-005/YTB-008) is genuine and
 * currently accessible, so `event_recordings.youtube_fallback_verified` can
 * become true. `requireSuperAdmin`-gated. Never calls or simulates the
 * YouTube API — this is a human attestation, not an automated check.
 *
 * Delegates entirely to `apply_youtube_fallback_verification()` (migration
 * `0037`, local design only): the RPC itself re-verifies the caller is
 * `super_admin`, requires `youtubeUrl` to equal the event's current
 * provider-supplied `events.youtube_url`, and writes the recording update
 * together with a `platform_audit_log` row in one atomic transaction. This
 * route performs no separate write and accepts no client-supplied
 * `verified` value of any kind — verification is implicit in successfully
 * calling this exact endpoint as an authorized Super Admin.
 */

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

interface PostBody {
  youtubeUrl?: unknown;
}

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;

  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.youtubeUrl !== 'string' || !isValidYoutubeWatchUrl(body.youtubeUrl)) {
    return NextResponse.json(
      { success: false, error: 'youtubeUrl must be a valid youtube.com/youtu.be link', field: 'youtubeUrl' },
      { status: 400 }
    );
  }

  const result = await verifyYoutubeFallback(eventId, body.youtubeUrl, auth.userId);

  if (result.status === 'rejected') {
    return NextResponse.json({ success: false, error: result.message }, { status: 409 });
  }

  return NextResponse.json({
    success: true,
    eventId,
    youtubeFallbackUrl: result.recording.youtube_fallback_url,
    youtubeFallbackVerified: result.recording.youtube_fallback_verified,
  });
}
