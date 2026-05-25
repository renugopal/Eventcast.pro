import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from './supabase';

/**
 * Server-side admin authentication guard.
 *
 * Reads the Bearer token from the Authorization header and validates it
 * against Supabase Auth. Returns the authenticated user ID, studio ID,
 * studio slug, and platform role on success, or a 401/403 NextResponse
 * on any failure.
 *
 * Usage — add this at the top of every protected API route handler:
 *
 *   const auth = await requireAdmin(req);
 *   if (auth instanceof NextResponse) return auth;
 *   // auth.userId, auth.studioId, auth.studioSlug, auth.isSuperAdmin
 */
export async function requireAdmin(
  req: Request
): Promise<{
  userId: string;
  studioId: string;
  studioSlug: string;
  platformRole: 'super_admin' | 'live_streamer' | 'reseller';
  isSuperAdmin: boolean;
} | NextResponse> {
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

    // Load the user's primary studio + slug
    const { data: memberData, error: memberError } = await client
      .from('studio_members')
      .select('studio_id, studios(slug)')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    if (memberError || !memberData) {
      return NextResponse.json(
        { error: 'Forbidden: No studio association found' },
        { status: 403 }
      );
    }

    const studioSlug = (memberData.studios as any)?.slug ?? '';

    // Load platform role from platform_users table
    const { data: platformUser } = await client
      .from('platform_users')
      .select('platform_role')
      .eq('user_id', user.id)
      .limit(1)
      .single();

    // Fallback: if no platform_users record yet, check if studioSlug === 'eventcast'
    // (for backward compatibility during migration)
    let platformRole: 'super_admin' | 'live_streamer' | 'reseller' = 'live_streamer';
    if (platformUser?.platform_role) {
      platformRole = platformUser.platform_role as typeof platformRole;
    } else if (studioSlug === 'eventcast') {
      platformRole = 'super_admin';
    }

    const isSuperAdmin = platformRole === 'super_admin';

    return {
      userId: user.id,
      studioId: memberData.studio_id,
      studioSlug,
      platformRole,
      isSuperAdmin,
    };
  } catch {
    return NextResponse.json(
      { error: 'Unauthorized: Token verification failed' },
      { status: 401 }
    );
  }
}
