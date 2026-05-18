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
    const { slug } = await req.json();

    if (!slug) {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400 });
    }

    const restreamer = new RestreamerClient({
      url: process.env.RESTREAMER_URL || 'https://media.eventcast.pro',
      username: process.env.RESTREAMER_USERNAME || 'admin',
      password: process.env.RESTREAMER_PASSWORD
    });

    // 1. Try to restart the channel
    let success = await restreamer.restartChannel(slug);

    // 2. If it fails, the process might not exist in Restreamer. Self-heal by recreating it!
    if (!success) {
      console.log(`Channel ${slug} restart failed, attempting auto-recreation/self-healing...`);
      const { data: event, error: dbError } = await supabase
        .from('events')
        .select('youtube_stream_key')
        .eq('slug', slug)
        .single();

      if (!dbError && event) {
        console.log(`Re-creating Restreamer channel config for ${slug} with YouTube key...`);
        await restreamer.setupChannel(slug, event.youtube_stream_key);
        // Try starting it again
        success = await restreamer.restartChannel(slug);
      }
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
