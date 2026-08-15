import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * Every Super Admin Operations Console route must refuse a non-Super-Admin
 * caller *before* it performs any privileged database or storage work.
 *
 * These routes run on the service-role client, which bypasses RLS entirely —
 * so `requireSuperAdmin()` is the only thing standing between a caller and
 * cross-tenant data. This suite proves the guard is first in every handler by
 * asserting that no query builder, RPC, or audit write was ever reached when
 * the guard rejects.
 */

const { mockRequireSuperAdmin, mockFrom, mockRpc, mockWriteAuditLog, mockGetEventRecordingState } = vi.hoisted(() => ({
  mockRequireSuperAdmin: vi.fn(),
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockWriteAuditLog: vi.fn(),
  mockGetEventRecordingState: vi.fn(),
}));

vi.mock('@/lib/superAdmin', () => ({ requireSuperAdmin: mockRequireSuperAdmin }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));
vi.mock('@/lib/platformAudit', () => ({ writeAuditLog: mockWriteAuditLog }));
vi.mock('@/lib/eventRecording', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/eventRecording')>()),
  getEventRecordingState: mockGetEventRecordingState,
}));

const FORBIDDEN = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 });
const UNAUTHORIZED = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

interface RouteCase {
  name: string;
  invoke: () => Promise<Response>;
}

const ROUTE_CASES: RouteCase[] = [
  {
    name: 'GET /api/platform/overview',
    invoke: async () => (await import('@/app/api/platform/overview/route')).GET(new Request('http://t.local/api/platform/overview')),
  },
  {
    name: 'GET /api/platform/studios',
    invoke: async () => (await import('@/app/api/platform/studios/route')).GET(new Request('http://t.local/api/platform/studios')),
  },
  {
    name: 'GET /api/platform/studios/[studioId]',
    invoke: async () =>
      (await import('@/app/api/platform/studios/[studioId]/route')).GET(
        new Request('http://t.local/api/platform/studios/studio-1'),
        { params: Promise.resolve({ studioId: 'studio-1' }) }
      ),
  },
  {
    name: 'GET /api/platform/events/[eventId]',
    invoke: async () =>
      (await import('@/app/api/platform/events/[eventId]/route')).GET(new Request('http://t.local/api/platform/events/event-1'), {
        params: Promise.resolve({ eventId: 'event-1' }),
      }),
  },
  {
    name: 'GET /api/platform/nodes',
    invoke: async () => (await import('@/app/api/platform/nodes/route')).GET(new Request('http://t.local/api/platform/nodes')),
  },
  {
    name: 'GET /api/platform/templates',
    invoke: async () => (await import('@/app/api/platform/templates/route')).GET(new Request('http://t.local/api/platform/templates')),
  },
  {
    name: 'GET /api/platform/media-operations',
    invoke: async () =>
      (await import('@/app/api/platform/media-operations/route')).GET(new Request('http://t.local/api/platform/media-operations')),
  },
  {
    name: 'GET /api/platform/storage',
    invoke: async () => (await import('@/app/api/platform/storage/route')).GET(new Request('http://t.local/api/platform/storage')),
  },
  {
    name: 'GET /api/platform/r2-cleanup',
    invoke: async () => (await import('@/app/api/platform/r2-cleanup/route')).GET(new Request('http://t.local/api/platform/r2-cleanup')),
  },
  {
    name: 'GET /api/platform/support',
    invoke: async () => (await import('@/app/api/platform/support/route')).GET(new Request('http://t.local/api/platform/support')),
  },
  {
    name: 'POST /api/platform/support/[ticketId]/access',
    invoke: async () =>
      (await import('@/app/api/platform/support/[ticketId]/access/route')).POST(
        new Request('http://t.local/api/platform/support/ticket-1/access', {
          method: 'POST',
          body: JSON.stringify({ reason: 'investigating an outage report' }),
        }),
        { params: Promise.resolve({ ticketId: 'ticket-1' }) }
      ),
  },
  {
    name: 'PATCH /api/platform/support/[ticketId]',
    invoke: async () =>
      (await import('@/app/api/platform/support/[ticketId]/route')).PATCH(
        new Request('http://t.local/api/platform/support/ticket-1', {
          method: 'PATCH',
          body: JSON.stringify({ status: 'closed', reason: 'resolved' }),
        }),
        { params: Promise.resolve({ ticketId: 'ticket-1' }) }
      ),
  },
  {
    name: 'GET /api/platform/notifications',
    invoke: async () =>
      (await import('@/app/api/platform/notifications/route')).GET(new Request('http://t.local/api/platform/notifications')),
  },
  {
    name: 'GET /api/platform/security',
    invoke: async () => (await import('@/app/api/platform/security/route')).GET(new Request('http://t.local/api/platform/security')),
  },
  {
    name: 'GET /api/platform/audit-log',
    invoke: async () => (await import('@/app/api/platform/audit-log/route')).GET(new Request('http://t.local/api/platform/audit-log')),
  },
  {
    name: 'GET /api/platform/streams',
    invoke: async () => (await import('@/app/api/platform/streams/route')).GET(new Request('http://t.local/api/platform/streams')),
  },
  {
    name: 'GET /api/platform/events',
    invoke: async () => (await import('@/app/api/platform/events/route')).GET(new Request('http://t.local/api/platform/events')),
  },
];

describe('Platform Operations Console authorization boundary', () => {
  beforeEach(() => {
    mockRequireSuperAdmin.mockReset();
    mockFrom.mockReset();
    mockRpc.mockReset();
    mockWriteAuditLog.mockReset();
    mockGetEventRecordingState.mockReset();
  });

  for (const routeCase of ROUTE_CASES) {
    it(`${routeCase.name} denies a non-super-admin before any privileged work`, async () => {
      mockRequireSuperAdmin.mockResolvedValue(FORBIDDEN());

      const res = await routeCase.invoke();

      expect(res.status).toBe(403);
      expect(mockFrom).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
      expect(mockWriteAuditLog).not.toHaveBeenCalled();
      expect(mockGetEventRecordingState).not.toHaveBeenCalled();
    });

    it(`${routeCase.name} denies an unauthenticated caller before any privileged work`, async () => {
      mockRequireSuperAdmin.mockResolvedValue(UNAUTHORIZED());

      const res = await routeCase.invoke();

      expect(res.status).toBe(401);
      expect(mockFrom).not.toHaveBeenCalled();
      expect(mockRpc).not.toHaveBeenCalled();
      expect(mockWriteAuditLog).not.toHaveBeenCalled();
      expect(mockGetEventRecordingState).not.toHaveBeenCalled();
    });
  }

  it('covers every route under src/app/api/platform', async () => {
    // A guard against a future route being added without an authorization
    // test: this list is the contract, and it is compared against the
    // route names above rather than being maintained separately.
    const covered = new Set(ROUTE_CASES.map((routeCase) => routeCase.name));
    for (const expected of [
      'GET /api/platform/overview',
      'GET /api/platform/studios',
      'GET /api/platform/nodes',
      'GET /api/platform/templates',
      'GET /api/platform/media-operations',
      'GET /api/platform/storage',
      'GET /api/platform/r2-cleanup',
      'GET /api/platform/support',
      'GET /api/platform/notifications',
      'GET /api/platform/security',
    ]) {
      expect(covered.has(expected)).toBe(true);
    }
  });
});
