/**
 * GET /api/guest-photos/list?event_id=<uuid>
 *
 * Protected — requires studio member JWT.
 * Returns ALL photos (approved + unapproved) for the given event.
 * Used by the Admin Moderation Panel.
 */
export const runtime = 'edge';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get('event_id')?.trim();

  if (!eventId) {
    return NextResponse.json({ success: false, error: 'event_id query param required' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Verify this event belongs to the requesting studio
  const { data: eventCheck } = await supabase
    .from('events')
    .select('id, guest_photo_limit')
    .eq('id', eventId)
    .eq('studio_id', auth.studioId)
    .maybeSingle();

  if (!eventCheck) {
    return NextResponse.json({ success: false, error: 'Event not found or access denied' }, { status: 404 });
  }

  const { data: photos, error } = await supabase
    .from('guest_photos')
    .select('id, photo_url, uploader_name, file_size_bytes, approved, created_at')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success:    true,
    photos:     photos ?? [],
    total:      photos?.length ?? 0,
    limit:      eventCheck.guest_photo_limit ?? 50,
  });
}
