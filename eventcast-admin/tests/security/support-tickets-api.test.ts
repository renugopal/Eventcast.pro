import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createFromMock, authSuccess, type MockQueryBuilder, type AuthResult } from './support/mocks';

const { mockDb, mockRequireAdmin } = vi.hoisted(() => {
  return {
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
    },
    mockRequireAdmin: vi.fn(async (): Promise<AuthResult> => {
      throw new Error('mockRequireAdmin not configured for this test');
    }),
  };
});

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireAdmin: mockRequireAdmin };
});
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadCollectionRoute() {
  const mod = await import('@/app/api/support/route');
  return { GET: mod.GET, POST: mod.POST };
}

async function loadItemRoute() {
  const mod = await import('@/app/api/support/[ticketId]/route');
  return { GET: mod.GET, PATCH: mod.PATCH };
}

async function loadMessagesRoute() {
  const mod = await import('@/app/api/support/[ticketId]/messages/route');
  return { POST: mod.POST };
}

function makeGetRequest(): Request {
  return new Request('http://test.local/api/support', { method: 'GET' });
}

function makePostRequest(body: unknown): Request {
  return new Request('http://test.local/api/support', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(body: unknown): Request {
  return new Request('http://test.local/api/support/ticket-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeMessagePostRequest(body: unknown): Request {
  return new Request('http://test.local/api/support/ticket-1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const routeParams = { params: Promise.resolve({ ticketId: 'ticket-1' }) };

const TICKET_ROW = {
  id: 'ticket-1',
  event_id: null,
  subject: 'Cannot publish my event',
  category: 'general',
  status: 'open',
  created_at: '2026-08-12T00:00:00Z',
  updated_at: '2026-08-12T00:00:00Z',
  closed_at: null,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess());
});

describe('GET /api/support', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));
    const { GET } = await loadCollectionRoute();
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it("lists only the caller's own studio_id", async () => {
    mockDb.from = createFromMock({ support_tickets: [{ data: [TICKET_ROW], error: null }] });
    const { GET } = await loadCollectionRoute();
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, tickets: [TICKET_ROW] });
    const call = mockDb.from.mock.results[0].value;
    expect(call.eq).toHaveBeenCalledWith('studio_id', 'studio-a');
  });
});

describe('POST /api/support', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));
    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ subject: 'x', message: 'y' }));
    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a missing subject', async () => {
    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ subject: '  ', message: 'help' }));
    expect(res.status).toBe(400);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a missing opening message', async () => {
    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ subject: 'Help', message: '' }));
    expect(res.status).toBe(400);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent eventId before creating a ticket', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });
    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ subject: 'Help', message: 'help', eventId: 'foreign-event' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('surfaces the database same-studio linkage rejection instead of reporting success', async () => {
    // Migration 0034's support_tickets_event_studio_match trigger is the
    // backstop underneath getOwnedEventById — it also covers the privileged
    // server client, which bypasses RLS. If it ever fires, the route must
    // fail loudly rather than pretend the ticket was created.
    mockDb.from = createFromMock({
      events: [{ data: { id: 'event-1' }, error: null }],
      support_tickets: [
        { data: null, error: { message: 'linked event must belong to the same studio' } },
      ],
    });
    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ subject: 'Help', message: 'help', eventId: 'event-1' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('linked event must belong to the same studio');
  });

  it("creates a ticket and its opening message, always under the caller's own studio_id", async () => {
    mockDb.from = createFromMock({
      support_tickets: [{ data: TICKET_ROW, error: null }],
      support_ticket_messages: [{ data: null, error: null }],
    });
    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ subject: 'Help', message: 'help', studioId: 'studio-b' }));
    expect(res.status).toBe(200);

    const ticketInsertCall = mockDb.from.mock.results[0].value;
    const insertedTicket = ticketInsertCall.insert.mock.calls[0][0];
    expect(insertedTicket.studio_id).toBe('studio-a');
    expect(insertedTicket).not.toHaveProperty('studioId');

    const messageInsertCall = mockDb.from.mock.results[1].value;
    const insertedMessage = messageInsertCall.insert.mock.calls[0][0];
    expect(insertedMessage).toEqual({ ticket_id: 'ticket-1', author_user_id: 'user-1', body: 'help' });
  });
});

describe('GET /api/support/[ticketId]', () => {
  it('rejects a cross-tenant or nonexistent ticket with the generic 404', async () => {
    mockDb.from = createFromMock({ support_tickets: [{ data: null, error: null }] });
    const { GET } = await loadItemRoute();
    const res = await GET(new Request('http://test.local/api/support/ticket-1'), routeParams);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Support ticket not found' });
  });

  it('returns ticket detail plus its full message history', async () => {
    mockDb.from = createFromMock({
      support_tickets: [{ data: TICKET_ROW, error: null }],
      support_ticket_messages: [{ data: [{ id: 'm1', author_user_id: 'user-1', body: 'help', created_at: '2026-08-12T00:00:00Z' }], error: null }],
    });
    const { GET } = await loadItemRoute();
    const res = await GET(new Request('http://test.local/api/support/ticket-1'), routeParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ticket).toEqual(TICKET_ROW);
    expect(body.messages).toHaveLength(1);
  });
});

describe('PATCH /api/support/[ticketId]', () => {
  it('rejects a cross-tenant or nonexistent ticket before any update', async () => {
    mockDb.from = createFromMock({ support_tickets: [{ data: null, error: null }] });
    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ status: 'closed' }), routeParams);
    expect(res.status).toBe(404);
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid status value', async () => {
    mockDb.from = createFromMock({ support_tickets: [{ data: { id: 'ticket-1' }, error: null }] });
    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ status: 'archived' }), routeParams);
    expect(res.status).toBe(400);
  });

  it('closes a ticket, scoped by both id and studio_id, stamping closed_at', async () => {
    mockDb.from = createFromMock({
      support_tickets: [
        { data: { id: 'ticket-1' }, error: null },
        { data: { ...TICKET_ROW, status: 'closed' }, error: null },
      ],
    });
    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ status: 'closed' }), routeParams);
    expect(res.status).toBe(200);

    const updateCall = mockDb.from.mock.results[1].value;
    const payload = updateCall.update.mock.calls[0][0];
    expect(payload.status).toBe('closed');
    expect(payload.closed_at).not.toBeNull();
    expect(updateCall.eq.mock.calls).toEqual([
      ['id', 'ticket-1'],
      ['studio_id', 'studio-a'],
    ]);
  });
});

describe('POST /api/support/[ticketId]/messages', () => {
  it('rejects a cross-tenant or nonexistent ticket before adding a message', async () => {
    mockDb.from = createFromMock({ support_tickets: [{ data: null, error: null }] });
    const { POST } = await loadMessagesRoute();
    const res = await POST(makeMessagePostRequest({ body: 'hello' }), routeParams);
    expect(res.status).toBe(404);
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty message body', async () => {
    mockDb.from = createFromMock({ support_tickets: [{ data: { id: 'ticket-1' }, error: null }] });
    const { POST } = await loadMessagesRoute();
    const res = await POST(makeMessagePostRequest({ body: '   ' }), routeParams);
    expect(res.status).toBe(400);
  });

  it('appends a message and bumps the ticket updated_at', async () => {
    mockDb.from = createFromMock({
      support_tickets: [
        { data: { id: 'ticket-1' }, error: null }, // ownership
        { data: null, error: null }, // updated_at bump
      ],
      support_ticket_messages: [
        { data: { id: 'm2', author_user_id: 'user-1', body: 'reply', created_at: '2026-08-12T01:00:00Z' }, error: null },
      ],
    });
    const { POST } = await loadMessagesRoute();
    const res = await POST(makeMessagePostRequest({ body: 'reply' }), routeParams);
    expect(res.status).toBe(200);

    const messageInsertCall = mockDb.from.mock.results[1].value;
    expect(messageInsertCall.insert).toHaveBeenCalledWith({ ticket_id: 'ticket-1', author_user_id: 'user-1', body: 'reply' });

    const bumpCall = mockDb.from.mock.results[2].value;
    expect(bumpCall.update).toHaveBeenCalled();
  });
});
