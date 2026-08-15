import { NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from './supabase';

/**
 * Studio membership role (`member_role_enum`, migration 0001). This is a
 * separate authorization dimension from `platformRole` — the two are never
 * mapped onto each other.
 */
export type StudioMemberRole = 'owner' | 'admin' | 'member';

const MUTATING_STUDIO_ROLES: readonly StudioMemberRole[] = ['owner', 'admin'];

/**
 * Whether a studio-member role may mutate studio-owned resources.
 *
 * Mirrors the owner/admin write policies installed by migration 0030. Routes
 * that run through the service-role Supabase client bypass RLS entirely, so
 * this check is the only thing enforcing that rule for them — it is not
 * redundant with the database policy, it stands in for it.
 *
 * Allowlist-based on purpose: an unrecognised role fails closed.
 */
export function canMutateStudioResources(role: StudioMemberRole): boolean {
  return MUTATING_STUDIO_ROLES.includes(role);
}

/**
 * Server-side admin authentication guard.
 *
 * Reads the Bearer token from the Authorization header and validates it
 * against Supabase Auth. Returns the authenticated user ID, studio ID,
 * studio slug, studio-member role, and platform role on success, or a
 * 401/403 NextResponse on any failure.
 *
 * Note that this confirms *membership*, not write authority — a `member`-role
 * user authenticates successfully here. Routes that mutate studio-owned data
 * must additionally gate on `canMutateStudioResources(auth.studioMemberRole)`.
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
  studioMemberRole: StudioMemberRole;
  platformRole: 'super_admin' | 'live_streamer' | 'reseller';
  isSuperAdmin: boolean;
  /**
   * Sanitized phone-first Auth preparation (Baseline AUTH-001/AUTH-008).
   * Sourced directly from the Supabase Auth user object returned by
   * `auth.getUser()` — never a second, EventCast-owned verification
   * authority. `phoneVerified` reflects Supabase's own
   * `phone_confirmed_at`, which stays null until real OTP delivery is
   * configured and completed; no code path in this repository sets it any
   * other way.
   */
  phone: string | null;
  phoneVerified: boolean;
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

    // Load the user's primary studio + slug + membership role
    const { data: memberData, error: memberError } = await client
      .from('studio_members')
      .select('studio_id, role, studios(slug)')
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
      // `studio_members.role` is NOT NULL DEFAULT 'admin' (migration 0001), so
      // every row reaching this point carries a value. An unexpected value
      // still fails closed at canMutateStudioResources().
      studioMemberRole: memberData.role as StudioMemberRole,
      platformRole,
      isSuperAdmin,
      phone: user.phone ?? null,
      phoneVerified: !!user.phone_confirmed_at,
    };
  } catch {
    return NextResponse.json(
      { error: 'Unauthorized: Token verification failed' },
      { status: 401 }
    );
  }
}
