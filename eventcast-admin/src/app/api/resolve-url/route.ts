import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { assertPublicHttpUrl } from '@/lib/ssrf';

export const runtime = 'edge';

// Exact-host allowlist for the sole caller (venue-map short-link resolution).
// Google Maps + Google short-link domains only. Subdomain matching is done
// safely (exact host, or a dot-anchored `.google.com` suffix) — never a loose
// substring/suffix test.
const EXACT_ALLOWED_HOSTS = new Set([
  'google.com',
  'www.google.com',
  'maps.google.com',
  'maps.app.goo.gl',
  'goo.gl',
  'g.co',
  'g.page',
]);

function isAllowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (EXACT_ALLOWED_HOSTS.has(h)) return true;
  // Safe subdomain match for google.com only (dot-anchored — not a substring test).
  if (h === 'google.com' || h.endsWith('.google.com')) return true;
  return false;
}

// Validate a single hop: SSRF guard (scheme/creds/private-IP) THEN allowlist.
function validateHop(raw: string): URL {
  const url = assertPublicHttpUrl(raw);
  if (!isAllowedHost(url.hostname)) {
    throw new Error('Destination host is not on the allowlist');
  }
  return url;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { url } = await req.json();
    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    let currentUrl: string;
    try {
      currentUrl = validateHop(url).href;
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }

    for (let i = 0; i < 5; i++) {
      const res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      if (![301, 302, 307, 308].includes(res.status)) break;

      const location = res.headers.get('location');
      if (!location) break;

      const nextUrl = location.startsWith('http') ? location : new URL(location, currentUrl).href;
      // Re-validate every redirect target BEFORE following it.
      try {
        currentUrl = validateHop(nextUrl).href;
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
      }
    }

    return NextResponse.json({ resolvedUrl: currentUrl, title: 'Venue Map' });

  } catch (error) {
    console.error('URL Resolution Error:', error);
    return NextResponse.json({ error: 'Failed to resolve URL' }, { status: 500 });
  }
}
