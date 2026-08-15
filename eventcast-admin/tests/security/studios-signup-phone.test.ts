import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFromMock, type MockQueryBuilder } from './support/mocks';

/**
 * Focused coverage for the phone-first Auth preparation added to
 * `POST /api/studios/signup`: a supplied phone is normalized and stored
 * unconfirmed (`phone_confirm: false`) on the new Supabase Auth user — no
 * OTP is sent, and an invalid phone is rejected before any Auth/DB call.
 * Existing email/password-only signup (no phone) must keep working
 * unchanged.
 */

const { mockDb, mockCreateUser, mockDeleteUser } = vi.hoisted(() => {
  return {
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
      auth: {
        admin: {
          createUser: vi.fn(),
          deleteUser: vi.fn(),
        },
      },
    },
    mockCreateUser: vi.fn(),
    mockDeleteUser: vi.fn(),
  };
});

mockDb.auth.admin.createUser = mockCreateUser;
mockDb.auth.admin.deleteUser = mockDeleteUser;

vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadRoute() {
  const mod = await import('@/app/api/studios/signup/route');
  return { POST: mod.POST };
}

function makeRequest(body: unknown): Request {
  return new Request('http://test.local/api/studios/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_SIGNUP = {
  email: 'owner@example.com',
  password: 'secret123',
  studioName: 'Test Studio',
  slug: 'test-studio',
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('POST /api/studios/signup — phone-first Auth preparation', () => {
  it('rejects an invalid phone before any Auth or database call', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ ...VALID_SIGNUP, phone: '12345' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/valid.*Indian mobile/i);
    expect(mockDb.from).not.toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('creates the Auth user with a normalized, unconfirmed phone when one is supplied', async () => {
    mockDb.from = createFromMock({
      studios: [
        { data: null, error: null }, // slug availability check
        { data: { id: 'studio-1', slug: 'test-studio' }, error: null }, // studio insert
      ],
      studio_members: [{ data: null, error: null }],
    });
    mockCreateUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ ...VALID_SIGNUP, phone: '9876543210' }));

    expect(res.status).toBe(200);
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: VALID_SIGNUP.email,
        phone: '+919876543210',
        phone_confirm: false,
      })
    );
    // Never sends/claims verification.
    const call = mockCreateUser.mock.calls[0][0];
    expect(call.phone_confirm).toBe(false);
  });

  it('still creates the Auth user with no phone field at all when none is supplied', async () => {
    mockDb.from = createFromMock({
      studios: [
        { data: null, error: null },
        { data: { id: 'studio-1', slug: 'test-studio' }, error: null },
      ],
      studio_members: [{ data: null, error: null }],
    });
    mockCreateUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ ...VALID_SIGNUP }));

    expect(res.status).toBe(200);
    const call = mockCreateUser.mock.calls[0][0];
    expect(call).not.toHaveProperty('phone');
    expect(call).not.toHaveProperty('phone_confirm');
  });
});
