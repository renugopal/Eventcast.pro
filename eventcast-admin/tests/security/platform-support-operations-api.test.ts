import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

/**
 * ADM-007 / ADM-008 in practice for the Platform Support surface.
 *
 * Two properties are proven here:
 *  - private support content cannot be read without a stated reason, and the
 *    audit row is written *before* any message body is returned, so a failed
 *    audit write means no disclosure;
 *  - a status change records the real before-state read from the database,
 *    never a client-supplied one.
 */

const { mockRequireSuperAdmin, mockWriteAuditLog, tableResults, mockFrom, updatePayloads } = vi.hoisted(() => {
  const tableResults = new Map<string, { data: unknown; error: unknown }>();
  const updatePayloads: unknown[] = [];

  function makeBuilder(table: string) {
    const key = { current: table };
    const result = () => tableResults.get(key.current) ?? { data: [], error: null };
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'range', 'limit']) {
      builder[method] = () => builder;
    }
    builder.update = (payload: unknown) => {
      updatePayloads.push(payload);
      key.current = `${table}:updated`;
      return builder;
    };
    for (const method of ['maybeSingle', 'single']) {
      builder[method] = () => {
        const value = result();
        const data = Array.isArray(value.data) ? (value.data[0] ?? null) : value.data;
        return Promise.resolve({ ...value, data });
      };
    }
    builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return builder;
  }

  return {
    tableResults,
    updatePayloads,
    mockRequireSuperAdmin: vi.fn(),
    mockWriteAuditLog: vi.fn(),
    mockFrom: vi.fn((table: string) => makeBuilder(table)),
  };
});

vi.mock('@/lib/superAdmin', () => ({ requireSuperAdmin: mockRequireSuperAdmin }));
vi.mock('@/lib/platformAudit', () => ({ writeAuditLog: mockWriteAuditLog }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom },
  supabaseAdmin: { from: mockFrom },
}));

const TICKET = {
  id: 'ticket-1',
  studio_id: 'studio-1',
  event_id: null,
  subject: 'Stream keeps dropping',
  category: 'urgent_live',
  status: 'open',
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  closed_at: null,
};

const PRIVATE_BODY = 'our client shared a private phone number in this thread';

async function callAccess(body: unknown) {
  const { POST } = await import('@/app/api/platform/support/[ticketId]/access/route');
  return POST(
    new Request('http://t.local/api/platform/support/ticket-1/access', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ ticketId: 'ticket-1' }) }
  );
}

async function callPatch(body: unknown) {
  const { PATCH } = await import('@/app/api/platform/support/[ticketId]/route');
  return PATCH(
    new Request('http://t.local/api/platform/support/ticket-1', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ ticketId: 'ticket-1' }) }
  );
}

describe('POST /api/platform/support/[ticketId]/access', () => {
  beforeEach(() => {
    tableResults.clear();
    updatePayloads.length = 0;
    mockFrom.mockClear();
    mockRequireSuperAdmin.mockReset();
    mockWriteAuditLog.mockReset();
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    mockWriteAuditLog.mockResolvedValue({ error: null });
    tableResults.set('support_tickets', { data: [TICKET], error: null });
    tableResults.set('support_ticket_messages', {
      data: [{ id: 'msg-1', author_user_id: 'user-1', body: PRIVATE_BODY, created_at: '2026-07-01T00:05:00.000Z' }],
      error: null,
    });
  });

  it('refuses to disclose any content without a reason, and writes no audit row', async () => {
    const res = await callAccess({ reason: '   ' });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(JSON.stringify(json)).not.toContain(PRIVATE_BODY);
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it('records the audit entry with the reason, and only then returns the thread', async () => {
    const res = await callAccess({ reason: 'investigating a reported outage' });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.accessRecorded).toBe(true);
    expect(json.messages[0].body).toBe(PRIVATE_BODY);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'support_thread_accessed',
        actorUserId: 'super-1',
        targetType: 'support_ticket',
        targetId: 'ticket-1',
        reason: 'investigating a reported outage',
      })
    );
  });

  it('never writes a message body into the audit entry', async () => {
    await callAccess({ reason: 'investigating a reported outage' });

    const entry = mockWriteAuditLog.mock.calls[0][0];
    expect(JSON.stringify(entry)).not.toContain(PRIVATE_BODY);
    expect(entry.after).toEqual({ studioId: 'studio-1', messageCount: 1 });
  });

  it('discloses nothing when the audit entry cannot be recorded', async () => {
    mockWriteAuditLog.mockResolvedValue({ error: 'audit log unavailable' });

    const res = await callAccess({ reason: 'investigating a reported outage' });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.stringify(json)).not.toContain(PRIVATE_BODY);
  });

  it('denies a non-super-admin before reading the ticket at all', async () => {
    mockRequireSuperAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));

    const res = await callAccess({ reason: 'investigating a reported outage' });

    expect(res.status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/platform/support/[ticketId]', () => {
  beforeEach(() => {
    tableResults.clear();
    updatePayloads.length = 0;
    mockFrom.mockClear();
    mockRequireSuperAdmin.mockReset();
    mockWriteAuditLog.mockReset();
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
    mockWriteAuditLog.mockResolvedValue({ error: null });
    tableResults.set('support_tickets', { data: [TICKET], error: null });
    tableResults.set('support_tickets:updated', { data: [{ ...TICKET, status: 'closed', closed_at: 'now' }], error: null });
  });

  it('requires a reason before touching the ticket', async () => {
    const res = await callPatch({ status: 'closed', reason: '  ' });

    expect(res.status).toBe(400);
    expect(updatePayloads).toEqual([]);
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it('rejects an unknown status value', async () => {
    const res = await callPatch({ status: 'escalated', reason: 'triage' });

    expect(res.status).toBe(400);
    expect(updatePayloads).toEqual([]);
  });

  it('audits the real before-state read from the database, not a client-supplied one', async () => {
    const res = await callPatch({ status: 'closed', reason: 'resolved with the provider' });

    expect(res.status).toBe(200);
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'support_ticket_status_changed',
        before: { status: 'open' },
        after: { status: 'closed' },
        reason: 'resolved with the provider',
      })
    );
  });

  it('clears closed_at when reopening rather than leaving a stale close timestamp', async () => {
    tableResults.set('support_tickets', { data: [{ ...TICKET, status: 'closed' }], error: null });
    tableResults.set('support_tickets:updated', { data: [{ ...TICKET, status: 'open' }], error: null });

    await callPatch({ status: 'open', reason: 'customer replied' });

    expect(updatePayloads[0]).toMatchObject({ status: 'open', closed_at: null });
  });

  it('exposes no reply/message-creation verb on the platform support surface', async () => {
    const routeModule = await import('@/app/api/platform/support/[ticketId]/route');
    expect(routeModule).not.toHaveProperty('POST');
  });
});
