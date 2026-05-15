import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from './supabase';

/**
 * Server-side admin authentication guard.
 *
 * Reads the Bearer token from the Authorization header and validates it
 * against Supabase Auth. Returns the authenticated user ID on success, or
 * a 401 NextResponse on any failure.
 *
 * Usage — add this at the top of every protected API route handler:
 *
 *   const auth = await requireAdmin(req);
 *   if (auth instanceof NextResponse) return auth;
 *   // auth.userId is now available
 */
export async function requireAdmin(
  req: Request
): Promise<{ userId: string } | NextResponse> {
  const authHeader = req.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Unauthorized: No session token provided' },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7);

  // Both the admin and anon clients can verify a Supabase user JWT via the
  // auth/v1/user endpoint — no special service-role key needed for verification.
  const client = supabaseAdmin ?? supabase;

  try {
    const {
      data: { user },
      error,
    } = await client.auth.getUser(token);

    if (error || !user) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or expired session' },
        { status: 401 }
      );
    }

    return { userId: user.id };
  } catch {
    return NextResponse.json(
      { error: 'Unauthorized: Token verification failed' },
      { status: 401 }
    );
  }
}
