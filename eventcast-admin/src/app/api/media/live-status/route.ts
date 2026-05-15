import { NextResponse } from 'next/server';
import { RestreamerClient } from '@/lib/restreamer';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'edge';

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const restreamer = new RestreamerClient({
      url: process.env.RESTREAMER_URL || 'https://media.eventcast.pro',
      username: process.env.RESTREAMER_USERNAME || 'admin',
      password: process.env.RESTREAMER_PASSWORD
    });

    const activeProcesses = await restreamer.getAllProcesses();
    return NextResponse.json({ success: true, activeProcesses });
  } catch (err: any) {
    console.error('Fetch Live Status Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
