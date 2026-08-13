import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom },
  supabaseAdmin: { auth: { getUser: mockGetUser }, from: mockFrom },
}));

function singleBuilder(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  };
}

function makeRequest(bearer?: string): Request {
  const headers: Record<string, string> = {};
  if (bearer !== undefined) headers['Authorization'] = bearer;
  return new Request('http://test.local/api/platform/overview', { headers });
}

describe('requireSuperAdmin', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetUser.mockReset();
    mockFrom.mockReset();
  });

  it('401s with no Authorization header', async () => {
    const { requireSuperAdmin } = await import('@/lib/superAdmin');
    const result = await requireSuperAdmin(makeRequest());
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it('401s on an invalid/expired session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    const { requireSuperAdmin } = await import('@/lib/superAdmin');
    const result = await requireSuperAdmin(makeRequest('Bearer bad-token'));
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it('403s a valid user with no platform_users row', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mockFrom.mockReturnValue(singleBuilder({ data: null, error: { message: 'no rows' } }));
    const { requireSuperAdmin } = await import('@/lib/superAdmin');
    const result = await requireSuperAdmin(makeRequest('Bearer good-token'));
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it('403s a studio member whose platform_role is not super_admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mockFrom.mockReturnValue(singleBuilder({ data: { platform_role: 'live_streamer' }, error: null }));
    const { requireSuperAdmin } = await import('@/lib/superAdmin');
    const result = await requireSuperAdmin(makeRequest('Bearer good-token'));
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it('succeeds for a platform_role=super_admin user who has NO studio_members row at all', async () => {
    // requireSuperAdmin never queries studio_members — only platform_users.
    // The mockFrom call below is the only DB call this guard makes.
    mockGetUser.mockResolvedValue({ data: { user: { id: 'super-user' } }, error: null });
    mockFrom.mockReturnValue(singleBuilder({ data: { platform_role: 'super_admin' }, error: null }));
    const { requireSuperAdmin } = await import('@/lib/superAdmin');
    const result = await requireSuperAdmin(makeRequest('Bearer good-token'));
    expect(result).not.toBeInstanceOf(NextResponse);
    expect((result as { userId: string }).userId).toBe('super-user');
    expect(mockFrom).toHaveBeenCalledWith('platform_users');
    expect(mockFrom).not.toHaveBeenCalledWith('studio_members');
  });
});
