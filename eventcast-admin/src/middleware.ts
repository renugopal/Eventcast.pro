import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ─── Routes that bypass JWT auth ─────────────────────────────────────────────
// These are either public-facing or use their own secret-based auth.
const PUBLIC_PREFIXES = [
  '/api/ai/sales-chat',          // Marketing page AI bot — no login required
  '/api/cron/',                  // Cron jobs use CRON_SECRET query param
  '/api/resolve-url',            // Cloudflare Worker domain resolver
  '/api/billing/webhook',        // Payment provider webhooks (use own signature)
];

// ─── Routes that are fully public (non-API) ───────────────────────────────────
const ALWAYS_PUBLIC_PREFIXES = [
  '/_next/',
  '/favicon',
  '/login',
  '/signup',
];

function isPublicRoute(pathname: string): boolean {
  return (
    ALWAYS_PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only protect /api/* routes — let all page routes through
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Allow explicitly public API routes
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // ── Extract the JWT ──────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : req.cookies.get('sb-access-token')?.value ?? null;

  if (!token) {
    return NextResponse.json(
      { error: 'Unauthorized — no session token provided' },
      { status: 401 }
    );
  }

  // ── Validate with Supabase ───────────────────────────────────────────────
  // We use getUser() (not getSession()) because it does a server-side
  // verification against the Supabase auth server — it cannot be spoofed.
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return NextResponse.json(
        { error: 'Unauthorized — invalid or expired session' },
        { status: 401 }
      );
    }

    // Attach verified user id to a request header so API routes can read it
    // without re-validating (supabaseAdmin uses service key anyway)
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-user-id', user.id);
    requestHeaders.set('x-user-email', user.email ?? '');

    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    return NextResponse.json(
      { error: 'Internal auth error' },
      { status: 500 }
    );
  }
}

export const config = {
  // Run on all API routes. Cloudflare Edge runtime supports this.
  matcher: ['/api/:path*'],
};
