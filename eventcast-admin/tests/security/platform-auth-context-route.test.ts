import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const { mockRequireSuperAdmin } = vi.hoisted(() => ({ mockRequireSuperAdmin: vi.fn() }));
vi.mock('@/lib/superAdmin', () => ({ requireSuperAdmin: mockRequireSuperAdmin }));

function makeRequest(): Request {
  return new Request('http://test.local/api/platform/auth/context');
}

describe('GET /api/platform/auth/context', () => {
  beforeEach(() => {
    mockRequireSuperAdmin.mockReset();
  });

  it('succeeds for a super_admin with no studio membership at all (requireSuperAdmin is the only guard)', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'platform-only-user' });
    const { GET } = await import('@/app/api/platform/auth/context/route');
    const res = await GET(makeRequest());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.context).toEqual({ userId: 'platform-only-user', isSuperAdmin: true });
  });

  it('rejects a studio member without the super_admin platform role', async () => {
    mockRequireSuperAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { GET } = await import('@/app/api/platform/auth/context/route');
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });
});
