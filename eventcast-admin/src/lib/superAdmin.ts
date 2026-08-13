import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from './supabase';

/**
 * Server-side Platform Operations authorization guard.
 *
 * Deliberately independent of `requireAdmin()`: that helper 403s with
 * "No studio association found" before it ever checks `platform_users` if
 * the caller has no `studio_members` row (see auth.ts) — which would
 * incorrectly block a platform-only Super Admin who belongs to no studio.
 * This function repeats only the session-verification primitive
 * (`client.auth.getUser(token)` off the `Authorization: Bearer` header, the
 * same pattern `requireAdmin()` uses), then authorizes purely on
 * `platform_users.platform_role = 'super_admin'` — never on studio
 * membership, and never on the `studioSlug === 'eventcast'` compatibility
 * fallback that `requireAdmin()` uses elsewhere (left untouched there).
 *
 * A third, independent authorization dimension from both `requireAdmin()`
 * (studio-membership concept) and `canMutateStudioResources()`
 * (studio-role concept).
 *
 * Usage — add this at the top of every Platform Operations route handler:
 *
 *   const auth = await requireSuperAdmin(req);
 *   if (auth instanceof NextResponse) return auth;
 *   // auth.userId
 */
export async function requireSuperAdmin(
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

    const { data: platformUser, error: platformError } = await client
      .from('platform_users')
      .select('platform_role')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (platformError || !platformUser || platformUser.platform_role !== 'super_admin') {
      return NextResponse.json(
        { error: 'Forbidden: Platform Operations access requires super_admin' },
        { status: 403 }
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
