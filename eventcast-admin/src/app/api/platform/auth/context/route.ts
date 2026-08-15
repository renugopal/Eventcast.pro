import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdmin';

/**
 * The Platform Console's own auth-context endpoint — deliberately separate
 * from `/api/auth/context`, which is gated by `requireAdmin()` and 403s any
 * user with no `studio_members` row before it ever checks `platform_users`.
 * A Super Admin with no studio membership must be able to load the Platform
 * Console, so this route (and the Platform Console shell that calls it)
 * never depends on studio membership at all.
 */
export const runtime = 'edge';

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({
    success: true,
    context: {
      userId: auth.userId,
      isSuperAdmin: true,
    },
  });
}
