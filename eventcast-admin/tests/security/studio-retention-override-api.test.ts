import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const { mockRequireSuperAdmin, mockRpc } = vi.hoisted(() => ({
  mockRequireSuperAdmin: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock('@/lib/superAdmin', () => ({ requireSuperAdmin: mockRequireSuperAdmin }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mockRpc }, supabaseAdmin: { rpc: mockRpc } }));

async function loadRoute() {
  return import('@/app/api/platform/studios/[studioId]/retention-override/route');
}

function params() {
  return { params: Promise.resolve({ studioId: 'studio-a' }) };
}

describe('/api/platform/studios/[studioId]/retention-override', () => {
  beforeEach(() => {
    mockRequireSuperAdmin.mockReset();
    mockRpc.mockReset();
  });

  it('PUT rejects before calling the RPC when not a super admin', async () => {
    mockRequireSuperAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const { PUT } = await loadRoute();
    const req = new Request('http://test.local', { method: 'PUT', body: JSON.stringify({ retentionDays: 30 }) });
    const res = await PUT(req, params());
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('PUT sets the override atomically with its audit entry via the RPC', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    mockRpc.mockResolvedValue({
      data: { studioId: 'studio-a', retentionDays: 30, action: 'studio_retention_override_set' },
      error: null,
    });
    const { PUT } = await loadRoute();
    const req = new Request('http://test.local', { method: 'PUT', body: JSON.stringify({ retentionDays: 30 }) });
    const res = await PUT(req, params());
    const json = await res.json();

    expect(mockRpc).toHaveBeenCalledWith('apply_studio_retention_override', {
      p_studio_id: 'studio-a',
      p_retention_days: 30,
      p_actor: 'super-1',
    });
    expect(json.success).toBe(true);
    expect(json.action).toBe('studio_retention_override_set');
  });

  it('DELETE clears the override atomically with its audit entry via the RPC (p_retention_days: null)', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    mockRpc.mockResolvedValue({
      data: { studioId: 'studio-a', retentionDays: null, action: 'studio_retention_override_cleared' },
      error: null,
    });
    const { DELETE } = await loadRoute();
    const req = new Request('http://test.local', { method: 'DELETE' });
    const res = await DELETE(req, params());
    const json = await res.json();

    expect(mockRpc).toHaveBeenCalledWith('apply_studio_retention_override', {
      p_studio_id: 'studio-a',
      p_retention_days: null,
      p_actor: 'super-1',
    });
    expect(json.action).toBe('studio_retention_override_cleared');
  });

  it('PUT rejects a non-positive retentionDays before calling the RPC', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    const { PUT } = await loadRoute();
    const req = new Request('http://test.local', { method: 'PUT', body: JSON.stringify({ retentionDays: 0 }) });
    const res = await PUT(req, params());
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
