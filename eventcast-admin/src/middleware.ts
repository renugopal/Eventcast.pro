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
  '/api/guest-photos/upload',    // Guest Photo Wall — guests upload without login
  '/api/local-sync',             // Local template builder sync — no login required
];

// ─── Media Agent internal control-plane bypass ───────────────────────────────
// Matches ONLY the exact assignments endpoint shape the Media Agent Go
// client calls — e.g. `/internal/media/nodes/gcp-asia-south1-01/assignments`.
// That route (`src/app/internal/media/nodes/[node_id]/assignments/route.ts`)
// authenticates itself via its own bearer-token machine-auth scheme
// (`@/lib/media-agent/nodeAuth`), not a studio user's Supabase session JWT,
// so it must bypass the JWT check below. Every other path — near-misses,
// sibling actions, malformed node ids, and any future route under
// `/internal/media/nodes/` — is deliberately NOT matched here, so it falls
// through to normal studio-JWT authentication instead of being silently
// left unprotected.
const MEDIA_AGENT_ASSIGNMENTS_PATH = /^\/internal\/media\/nodes\/[A-Za-z0-9._-]{1,128}\/assignments\/?$/;

// Same node machine-auth scheme, for the node-originated recording-state
// report route (`src/app/internal/media/nodes/[node_id]/recordings/[event_id]/route.ts`).
// It authenticates itself via `@/lib/media-agent/nodeAuth` exactly like the
// assignments endpoint above — not a studio user's Supabase session JWT —
// and additionally requires an activation-history row binding the node to
// the event before it will touch recording state. Matched as its own exact
// two-segment shape rather than by broadening the `/internal/media/nodes/`
// prefix, so every other path under that prefix still falls through to
// normal studio-JWT authentication instead of being silently unprotected.
const MEDIA_AGENT_RECORDING_REPORT_PATH =
  /^\/internal\/media\/nodes\/[A-Za-z0-9._-]{1,128}\/recordings\/[A-Za-z0-9._-]{1,128}\/?$/;

// ─── Media Agent operator-only provisioning bypass ───────────────────────────
// Matches ONLY the exact node-registration and credential-issuance route
// shapes (`src/app/internal/media/nodes/provision/route.ts` and
// `src/app/internal/media/nodes/[node_id]/credentials/route.ts`). Both
// authenticate themselves via `MEDIA_NODE_PROVISIONING_SECRET`
// (`Authorization: Bearer <secret>`), not a studio user's Supabase session
// JWT, so they must bypass the JWT check below — same rationale as
// `MEDIA_AGENT_ASSIGNMENTS_PATH` above, for a different, operator-only
// auth scheme. Every other path — near-misses, sibling actions, malformed
// node ids, and any future route under `/internal/media/nodes/` — is
// deliberately NOT matched here, so it falls through to normal studio-JWT
// authentication instead of being silently left unprotected.
const MEDIA_AGENT_NODE_PROVISIONING_PATH = /^\/internal\/media\/nodes\/provision\/?$/;
const MEDIA_AGENT_NODE_CREDENTIALS_PATH = /^\/internal\/media\/nodes\/[A-Za-z0-9._-]{1,128}\/credentials\/?$/;

// Same operator-only scheme, for the node lifecycle transition route
// (`src/app/internal/media/nodes/[node_id]/mark-healthy/route.ts`, Slice 6).
const MEDIA_AGENT_NODE_MARK_HEALTHY_PATH =
  /^\/internal\/media\/nodes\/[A-Za-z0-9._-]{1,128}\/mark-healthy\/?$/;

// ─── Media Agent operator-only assignment-activation bypass ──────────────────
// Matches ONLY the exact assignment-activation route shape
// (`src/app/internal/media/assignments/[event_id]/activate/route.ts`).
// Authenticates itself via `MEDIA_NODE_PROVISIONING_SECRET`
// (`Authorization: Bearer <secret>`), the same operator-only scheme as the
// node-provisioning routes above — not a studio user's Supabase session
// JWT, and deliberately not reachable by one: this route returns a raw
// publish secret that must never reach a browser. Every other path —
// near-misses, sibling actions, malformed event ids, and any future route
// under `/internal/media/assignments/` — is deliberately NOT matched here,
// so it falls through to normal studio-JWT authentication instead of being
// silently left unprotected.
const MEDIA_AGENT_ASSIGNMENT_ACTIVATION_PATH =
  /^\/internal\/media\/assignments\/[A-Za-z0-9._-]{1,128}\/activate\/?$/;

// Same operator-only scheme, for the capacity-release counterpart
// (`src/app/internal/media/assignments/[event_id]/deactivate/route.ts`,
// migration 0026). Idempotent and secret-free on every branch, but still
// must not be reachable via a studio session — no studio-facing
// counterpart exists or is planned. Every other path — near-misses,
// sibling actions, malformed event ids, and any future route under
// `/internal/media/assignments/` — is deliberately NOT matched here, same
// rationale as `MEDIA_AGENT_ASSIGNMENT_ACTIVATION_PATH` above.
const MEDIA_AGENT_ASSIGNMENT_DEACTIVATION_PATH =
  /^\/internal\/media\/assignments\/[A-Za-z0-9._-]{1,128}\/deactivate\/?$/;

// Same operator-only scheme, for the secret-free assignment-status
// retrieval route (`src/app/internal/media/assignments/[event_id]/status/route.ts`,
// Slice 6). Unlike activation, this route carries no secret and is safe to
// call repeatedly — but it still must not be reachable via a studio
// session, since no studio-facing counterpart exists or is planned.
const MEDIA_AGENT_ASSIGNMENT_STATUS_PATH =
  /^\/internal\/media\/assignments\/[A-Za-z0-9._-]{1,128}\/status\/?$/;

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

  // The exact Media Agent assignments endpoint authenticates itself and
  // must bypass studio-JWT middleware entirely — checked before anything
  // else, ahead of the general /api//internal prefix guard below.
  if (
    MEDIA_AGENT_ASSIGNMENTS_PATH.test(pathname) ||
    MEDIA_AGENT_RECORDING_REPORT_PATH.test(pathname) ||
    MEDIA_AGENT_NODE_PROVISIONING_PATH.test(pathname) ||
    MEDIA_AGENT_NODE_CREDENTIALS_PATH.test(pathname) ||
    MEDIA_AGENT_NODE_MARK_HEALTHY_PATH.test(pathname) ||
    MEDIA_AGENT_ASSIGNMENT_ACTIVATION_PATH.test(pathname) ||
    MEDIA_AGENT_ASSIGNMENT_DEACTIVATION_PATH.test(pathname) ||
    MEDIA_AGENT_ASSIGNMENT_STATUS_PATH.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Only protect /api/* and /internal/* routes — let all page routes through
  if (!pathname.startsWith('/api/') && !pathname.startsWith('/internal/')) {
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
  // Run on all API routes plus the Media Agent internal control-plane
  // routes. Cloudflare Edge runtime supports this.
  matcher: ['/api/:path*', '/internal/:path*'],
};
