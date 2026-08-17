import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth';

/**
 * GET /api/notifications
 *
 * In-app Notification Center roster (Baseline V2.1 NOT-001), studio-scoped
 * via `auth.studioId`. Read-only listing — notifications are written only
 * by trusted server-side code via `src/lib/notifications.ts`'s
 * `createNotification()`, never through this route.
 */

const db = supabaseAdmin || supabase;

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { data, error } = await db
    .from('notifications')
    .select('id, event_id, severity, notification_type, title, body, read_at, created_at')
    .eq('studio_id', auth.studioId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ success: false, error: 'Failed to load notifications: ' + error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, notifications: data ?? [] });
}
