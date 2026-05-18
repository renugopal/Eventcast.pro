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
 *   // auth.userId and auth.studioId are now available
 */
export async function requireAdmin(
  req: Request
): Promise<{ userId: string; studioId: string } | NextResponse> {
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

    // Load the user's primary studio
    const { data: memberData, error: memberError } = await client
      .from('studio_members')
      .select('studio_id')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (memberError || !memberData) {
      return NextResponse.json(
        { error: 'Forbidden: No studio association found' },
        { status: 403 }
      );
    }

    return { userId: user.id, studioId: memberData.studio_id };
  } catch {
    return NextResponse.json(
      { error: 'Unauthorized: Token verification failed' },
      { status: 401 }
    );
  }
}
