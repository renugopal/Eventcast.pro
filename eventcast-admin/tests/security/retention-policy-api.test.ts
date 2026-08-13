import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const { mockRequireSuperAdmin, mockFrom, mockRpc } = vi.hoisted(() => ({
  mockRequireSuperAdmin: vi.fn(),
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock('@/lib/superAdmin', () => ({ requireSuperAdmin: mockRequireSuperAdmin }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

function makeGetRequest(): Request {
  return new Request('http://test.local/api/platform/retention-policy');
}

function makePatchRequest(body: unknown): Request {
  return new Request('http://test.local/api/platform/retention-policy', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/platform/retention-policy', () => {
  beforeEach(() => {
    mockRequireSuperAdmin.mockReset();
    mockFrom.mockReset();
    mockRpc.mockReset();
  });

  it('GET rejects before any DB call when not a super admin', async () => {
    mockRequireSuperAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { GET } = await import('@/app/api/platform/retention-policy/route');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('GET returns the current global default', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { default_retention_days: 90, updated_at: '2026-08-01T00:00:00Z' }, error: null }),
    });
    const { GET } = await import('@/app/api/platform/retention-policy/route');
    const res = await GET(makeGetRequest());
    const json = await res.json();
    expect(json.defaultRetentionDays).toBe(90);
  });

  it('PATCH rejects a non-positive value before calling the RPC', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    const { PATCH } = await import('@/app/api/platform/retention-policy/route');
    const res = await PATCH(makePatchRequest({ defaultRetentionDays: 0 }));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('PATCH calls the atomic RPC with the actor and new value — the update and its audit row succeed or fail together', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    mockRpc.mockResolvedValue({
      data: { default_retention_days: 120, updated_at: '2026-08-13T00:00:00Z' },
      error: null,
    });
    const { PATCH } = await import('@/app/api/platform/retention-policy/route');
    const res = await PATCH(makePatchRequest({ defaultRetentionDays: 120 }));
    const json = await res.json();

    expect(mockRpc).toHaveBeenCalledWith('apply_platform_retention_policy_update', {
      p_new_default_days: 120,
      p_actor: 'super-1',
    });
    expect(json.defaultRetentionDays).toBe(120);
  });

  it('PATCH surfaces an RPC failure (e.g. audit insert failed inside the transaction) as a rejection, not a partial success', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'transaction rolled back' } });
    const { PATCH } = await import('@/app/api/platform/retention-policy/route');
    const res = await PATCH(makePatchRequest({ defaultRetentionDays: 120 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});
