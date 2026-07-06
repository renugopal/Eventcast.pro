import { NextResponse } from 'next/server';
import { RestreamerClient } from '@/lib/restreamer';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth';
import { getOwnedEventBySlug, isOwnershipError } from '@/lib/ownership';

interface RestartableEventRow {
  slug: string;
  youtube_stream_key: string | null;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export const runtime = 'edge';

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { slug } = await req.json();

    if (!slug) {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400 });
    }

    // Verify ownership before any Restreamer call. Cross-tenant and
    // nonexistent events return the same generic response, so resource
    // existence is never leaked.
    const ownership = await getOwnedEventBySlug<RestartableEventRow>(supabase, slug, auth.studioId, 'slug, youtube_stream_key');
    if (isOwnershipError(ownership)) return ownership.error;
    const event = ownership.event;

    const restreamer = new RestreamerClient({
      url: process.env.RESTREAMER_URL || 'https://media.eventcast.pro',
      username: process.env.RESTREAMER_USERNAME || 'admin',
      password: process.env.RESTREAMER_PASSWORD
    });

    // 1. Try to restart the channel
    let success = await restreamer.restartChannel(event.slug);

    // 2. If it fails, the process might not exist in Restreamer. Self-heal by recreating it!
    if (!success) {
      if (!event.youtube_stream_key) {
        return NextResponse.json({ error: 'No YouTube stream key found for this event' }, { status: 400 });
      }
      console.log(`Channel ${event.slug} restart failed, attempting auto-recreation/self-healing...`);
      console.log(`Re-creating Restreamer channel config for ${event.slug} with YouTube key...`);
      await restreamer.setupChannel(event.slug, event.youtube_stream_key);
      // Try starting it again
      success = await restreamer.restartChannel(event.slug);
    }

    if (success) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: 'Failed to restart media server process' }, { status: 500 });
    }

  } catch (err: any) {
    console.error('Restart Channel Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
