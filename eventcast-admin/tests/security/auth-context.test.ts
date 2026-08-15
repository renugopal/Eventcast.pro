import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { authSuccess, type AuthSuccess } from './support/mocks';
import type { AdminAuthContextValue } from '@/app/(admin-v2)/_lib/useAdminAuth';

/**
 * Focused coverage for the sanitized Admin V2 auth context after
 * `studioMemberRole` was threaded through it, plus the pure role rule that
 * Partner mutations depend on.
 */

type StudioMemberRole = 'owner' | 'admin' | 'member';
type ContextAuthSuccess = AuthSuccess & {
  studioMemberRole: StudioMemberRole;
  phone: string | null;
  phoneVerified: boolean;
};

function contextAuth(studioMemberRole: StudioMemberRole = 'owner'): ContextAuthSuccess {
  return { ...authSuccess(), studioMemberRole, phone: null, phoneVerified: false };
}

const { mockRequireAdmin } = vi.hoisted(() => ({
  mockRequireAdmin: vi.fn(async (): Promise<ContextAuthSuccess | NextResponse> => {
    throw new Error('mockRequireAdmin not configured for this test');
  }),
}));

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireAdmin: mockRequireAdmin };
});
vi.mock('@/lib/supabase', () => ({ supabase: {}, supabaseAdmin: {} }));

async function loadContextRoute() {
  const mod = await import('@/app/api/auth/context/route');
  return { GET: mod.GET };
}

function makeRequest(): Request {
  return new Request('http://test.local/api/auth/context', { method: 'GET' });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(contextAuth('owner'));
});

describe('GET /api/auth/context', () => {
  it('returns the studio-member role alongside the existing context fields', async () => {
    mockRequireAdmin.mockResolvedValue(contextAuth('member'));

    const { GET } = await loadContextRoute();
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      context: {
        userId: 'user-1',
        studioId: 'studio-a',
        studioSlug: 'studio-a-slug',
        studioMemberRole: 'member',
        platformRole: 'live_streamer',
        isSuperAdmin: false,
        phone: null,
        phoneVerified: false,
      },
    });
  });

  it('passes through a captured-but-unverified phone (Baseline AUTH-001/AUTH-008 preparation)', async () => {
    mockRequireAdmin.mockResolvedValue({ ...contextAuth('owner'), phone: '+919876543210', phoneVerified: false });

    const { GET } = await loadContextRoute();
    const body = await (await GET(makeRequest())).json();

    expect(body.context.phone).toBe('+919876543210');
    expect(body.context.phoneVerified).toBe(false);
  });

  it.each(['owner', 'admin', 'member'] as const)('passes through the %s role verbatim', async (role) => {
    mockRequireAdmin.mockResolvedValue(contextAuth(role));

    const { GET } = await loadContextRoute();
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.context.studioMemberRole).toBe(role);
  });

  it('leaves platformRole and isSuperAdmin semantics unchanged', async () => {
    mockRequireAdmin.mockResolvedValue({
      ...contextAuth('owner'),
      platformRole: 'super_admin',
      isSuperAdmin: true,
    });

    const { GET } = await loadContextRoute();
    const body = await (await GET(makeRequest())).json();

    expect(body.context.platformRole).toBe('super_admin');
    expect(body.context.isSuperAdmin).toBe(true);
    // Platform role and studio-member role remain independent dimensions:
    // a super admin is not implicitly an owner/admin of the studio.
    expect(body.context.studioMemberRole).toBe('owner');
  });

  it('exposes no membership data beyond the sanitized field set', async () => {
    const { GET } = await loadContextRoute();
    const body = await (await GET(makeRequest())).json();

    expect(Object.keys(body.context).sort()).toEqual([
      'isSuperAdmin',
      'phone',
      'phoneVerified',
      'platformRole',
      'studioId',
      'studioMemberRole',
      'studioSlug',
      'userId',
    ]);
  });

  it('propagates an unauthenticated rejection unchanged', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));

    const { GET } = await loadContextRoute();
    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
  });
});

describe('canMutateStudioResources — mirrors migration 0030 write policies', () => {
  it('permits owner and admin', async () => {
    const { canMutateStudioResources } = await import('@/lib/auth');

    expect(canMutateStudioResources('owner')).toBe(true);
    expect(canMutateStudioResources('admin')).toBe(true);
  });

  it('denies member', async () => {
    const { canMutateStudioResources } = await import('@/lib/auth');

    expect(canMutateStudioResources('member')).toBe(false);
  });

  it('fails closed on an unrecognised role', async () => {
    const { canMutateStudioResources } = await import('@/lib/auth');

    expect(canMutateStudioResources('viewer' as StudioMemberRole)).toBe(false);
    expect(canMutateStudioResources('' as StudioMemberRole)).toBe(false);
  });
});

describe('Admin V2 client auth context type', () => {
  it('carries studioMemberRole', () => {
    const context: AdminAuthContextValue = {
      userId: 'user-1',
      studioId: 'studio-a',
      studioSlug: 'studio-a-slug',
      studioMemberRole: 'member',
      platformRole: 'live_streamer',
      isSuperAdmin: false,
      phone: null,
      phoneVerified: false,
    };

    expect(context.studioMemberRole).toBe('member');
  });
});
