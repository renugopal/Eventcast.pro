import { NextResponse } from 'next/server';
import { RestreamerClient } from '@/lib/restreamer';

export const runtime = 'edge';

export async function POST(req: Request) {
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

    const success = await restreamer.restartChannel(slug);

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
