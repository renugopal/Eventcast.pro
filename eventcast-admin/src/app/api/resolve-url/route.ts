import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 });

    let currentUrl = url;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      if ([301, 302, 307, 308].includes(res.status)) {
        const location = res.headers.get('location');
        if (location) {
          currentUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
        } else {
          break;
        }
      } else {
        break;
      }
    }
    
    return NextResponse.json({ resolvedUrl: currentUrl, title: "Venue Map" });

  } catch (error) {
    console.error('URL Resolution Error:', error);
    return NextResponse.json({ error: 'Failed to resolve URL' }, { status: 500 });
  }
}
