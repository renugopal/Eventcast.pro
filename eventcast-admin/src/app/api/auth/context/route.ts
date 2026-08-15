import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'edge';

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({
    success: true,
    context: {
      userId: auth.userId,
      studioId: auth.studioId,
      studioSlug: auth.studioSlug,
      studioMemberRole: auth.studioMemberRole,
      platformRole: auth.platformRole,
      isSuperAdmin: auth.isSuperAdmin,
      phone: auth.phone,
      phoneVerified: auth.phoneVerified,
    },
  });
}
