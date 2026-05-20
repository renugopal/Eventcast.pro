import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ─── IP Hashing for Rate Limiting (Privacy First) ────────────────────────────
async function hashIp(ip: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(ip);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function getClientIp(req: NextRequest): string {
  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;
  const xForwardedFor = req.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    const ips = xForwardedFor.split(',');
    return ips[0].trim();
  }
  const xRealIp = req.headers.get('x-real-ip');
  if (xRealIp) return xRealIp;
  return '127.0.0.1';
}

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

  // ── Rate Limiting for Public Endpoints ─────────────────────────────────────
  // Specifically protect the sales bot from being spammed (Gemini API costs)
  if (pathname.startsWith('/api/ai/sales-chat') && req.method === 'POST') {
    try {
      const ip = getClientIp(req);
      const ipHash = await hashIp(ip);
      
      const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      // Limit: 10 requests per 60 seconds
      const { data: isAllowed, error: rateLimitError } = await supabaseAdmin.rpc('check_rate_limit', {
        p_ip_hash: ipHash,
        p_endpoint: '/api/ai/sales-chat',
        p_limit: 10,
        p_window_seconds: 60
      });

      if (rateLimitError) {
        console.error('Rate limit RPC error:', rateLimitError);
        // Fail open if DB has an issue, so we don't break the bot completely
      } else if (!isAllowed) {
        console.warn(`Rate limit exceeded for IP Hash: ${ipHash}`);
        return NextResponse.json(
          { error: 'Too many requests. Please try again later.' },
          { status: 429, headers: { 'Access-Control-Allow-Origin': '*' } }
        );
      }
    } catch (err) {
      console.error('Rate limiting error:', err);
    }
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
