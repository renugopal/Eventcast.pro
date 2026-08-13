import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getProviderSafeRecordingViewForOwnedEvent } from '@/lib/eventRecording';

/**
 * GET /api/events/[eventId]/recording — provider-scoped (not
 * platform-wide) recording/replay state for an owned event.
 *
 * `requireAdmin()` + ownership proof, then returns only
 * `toProviderSafeRecordingView()`'s sanitized shape: replay availability,
 * processing state, retention expiry, and safe fallback availability.
 * Never `b2_object_key`, `b2_bucket`, `integrity_verified_at`,
 * `local_finalized_at`, `finalization_failure_reason`, or any other
 * infrastructure/storage-internal field — none of those are secrets, but
 * they are never returned to a normal provider anyway.
 */
export const runtime = 'edge';

interface RouteParams {
  params: Promise<{ eventId: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { eventId } = await params;

  const result = await getProviderSafeRecordingViewForOwnedEvent(eventId, auth.studioId);
  if (!result.ok) {
    return NextResponse.json({ success: false, error: 'Event not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, recording: result.view });
}
