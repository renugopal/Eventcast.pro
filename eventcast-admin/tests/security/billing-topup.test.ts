import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { authSuccess, type MockQueryBuilder, type AuthResult } from './support/mocks';

const { mockDb, mockRequireAdmin } = vi.hoisted(() => {
  return {
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
    },
    mockRequireAdmin: vi.fn(async (): Promise<AuthResult> => authSuccess()),
  };
});

vi.mock('@/lib/auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadRoute() {
  const mod = await import('@/app/api/billing/topup/route');
  return mod.POST;
}

function makeRequest(body: unknown = {}): Request {
  return new Request('http://test.local/api/billing/topup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess());
});

describe('POST /api/billing/topup — fail closed', () => {
  it('always returns 503 for an authenticated request and performs zero database writes', async () => {
    const POST = await loadRoute();
    const res = await POST(
      makeRequest({
        amount_paise: 50000,
        payment_id: 'pay_attacker_supplied',
        order_id: 'order_attacker_supplied',
      })
    );

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'Wallet top-ups are temporarily unavailable while secure payment verification is being implemented.',
    });
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('returns the requireAdmin response as-is for an unauthenticated request, before the 503 body is ever produced', async () => {
    const unauthorized = NextResponse.json(
      { error: 'Unauthorized: No session token provided' },
      { status: 401 }
    );
    mockRequireAdmin.mockResolvedValue(unauthorized);

    const POST = await loadRoute();
    const res = await POST(makeRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized: No session token provided' });
    expect(mockDb.from).not.toHaveBeenCalled();
  });
});
