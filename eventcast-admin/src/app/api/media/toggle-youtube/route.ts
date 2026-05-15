import { NextResponse } from 'next/server';
import { RestreamerClient } from '@/lib/restreamer';
import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export const runtime = 'edge';

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { slug, enabled, eventId } = await req.json();

    if (!slug || !eventId) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // 1. Get event details from DB to get the YouTube key
    const { data: event, error: dbError } = await supabase
      .from('events')
      .select('youtube_stream_key')
      .eq('id', eventId)
      .single();

    if (dbError || !event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const youtubeKey = event.youtube_stream_key;
    if (!youtubeKey) {
      return NextResponse.json({ error: 'No YouTube stream key found for this event' }, { status: 400 });
    }

    // 2. Setup Restreamer Client
    const restreamer = new RestreamerClient({
      url: process.env.RESTREAMER_URL || 'https://media.eventcast.pro',
      username: process.env.RESTREAMER_USERNAME || 'admin',
      password: process.env.RESTREAMER_PASSWORD
    });

    // 3. Toggle Output
    const outputConfig = {
      id: 'youtube',
      address: `rtmp://a.rtmp.youtube.com/live2/${youtubeKey}`,
      options: ["-c:v", "copy", "-c:a", "copy", "-f", "flv"]
    };

    const success = await restreamer.toggleOutput(slug, 'youtube', enabled, outputConfig);

    if (success) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: 'Failed to update media server' }, { status: 500 });
    }

  } catch (err: any) {
    console.error('Toggle YouTube Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
