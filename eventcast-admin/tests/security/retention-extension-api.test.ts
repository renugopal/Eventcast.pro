import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

const { mockRequireSuperAdmin, mockRpc } = vi.hoisted(() => ({
  mockRequireSuperAdmin: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock('@/lib/superAdmin', () => ({ requireSuperAdmin: mockRequireSuperAdmin }));
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: mockRpc },
  supabaseAdmin: { rpc: mockRpc },
}));

function makeRequest(body: unknown): Request {
  return new Request('http://test.local/api/platform/events/event-1/retention-extension', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function callRoute(body: unknown) {
  const { POST } = await import('@/app/api/platform/events/[eventId]/retention-extension/route');
  return POST(makeRequest(body), { params: Promise.resolve({ eventId: 'event-1' }) });
}

describe('POST /api/platform/events/[eventId]/retention-extension', () => {
  beforeEach(() => {
    mockRequireSuperAdmin.mockReset();
    mockRpc.mockReset();
  });

  it('rejects before calling the RPC when not a super admin', async () => {
    mockRequireSuperAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await callRoute({ newExpiresAt: '2027-01-01T00:00:00Z', reason: 'legal hold' });
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects a missing reason before calling the RPC', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    const res = await callRoute({ newExpiresAt: '2027-01-01T00:00:00Z', reason: '   ' });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('calls the atomic extension RPC with the actor, new expiry, and reason', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    mockRpc.mockResolvedValue({
      data: { event_id: 'event-1', retention_expires_at: '2027-01-01T00:00:00.000Z' },
      error: null,
    });

    const res = await callRoute({ newExpiresAt: '2027-01-01T00:00:00Z', reason: 'legal hold' });
    const json = await res.json();

    expect(mockRpc).toHaveBeenCalledWith('apply_event_retention_extension', {
      p_event_id: 'event-1',
      p_new_expires_at: '2027-01-01T00:00:00.000Z',
      p_reason: 'legal hold',
      p_actor: 'super-1',
    });
    expect(json.success).toBe(true);
  });

  it('surfaces RPC rejection (e.g. retention not yet frozen, or new expiry not strictly later) as a 409, never a partial success', async () => {
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'event event-1 retention is not frozen yet; cannot extend' },
    });

    const res = await callRoute({ newExpiresAt: '2027-01-01T00:00:00Z', reason: 'legal hold' });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.success).toBe(false);
  });
});
