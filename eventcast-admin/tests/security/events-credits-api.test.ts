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
    mockRequireAdmin: vi.fn(async (): Promise<AuthResult> => authSuccess()),
  };
});

vi.mock('@/lib/auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadCollectionRoute() {
  const mod = await import('@/app/api/events/[eventId]/credits/route');
  return { GET: mod.GET, POST: mod.POST };
}

async function loadItemRoute() {
  const mod = await import('@/app/api/events/[eventId]/credits/[creditId]/route');
  return { PATCH: mod.PATCH, DELETE: mod.DELETE };
}

function makeGetRequest(): Request {
  return new Request('http://test.local/api/events/event-1/credits', { method: 'GET' });
}

function makePostRequest(body: unknown): Request {
  return new Request('http://test.local/api/events/event-1/credits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(body: unknown): Request {
  return new Request('http://test.local/api/events/event-1/credits/credit-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(): Request {
  return new Request('http://test.local/api/events/event-1/credits/credit-1', { method: 'DELETE' });
}

const routeParamsEvent = { params: Promise.resolve({ eventId: 'event-1' }) };
const routeParamsCredit = { params: Promise.resolve({ eventId: 'event-1', creditId: 'credit-1' }) };

const OWNED_EVENT_ROW = { id: 'event-1' };
const OWNED_PARTNER_ROW = { id: 'partner-1' };
const OWNED_CREDIT_ROW = { id: 'credit-1' };

const FULL_CREDIT_ROW = {
  id: 'credit-1',
  event_id: 'event-1',
  partner_id: 'partner-1',
  role_label: 'photographer',
  is_primary: false,
  created_at: '2026-08-01T00:00:00Z',
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess());
});

describe('GET /api/events/[eventId]/credits — same-tenant list', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));

    const { GET } = await loadCollectionRoute();
    const res = await GET(makeGetRequest(), routeParamsEvent);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent event with the generic 404, before any credit read', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const { GET } = await loadCollectionRoute();
    const res = await GET(makeGetRequest(), routeParamsEvent);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('returns the owned event\'s credits', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_EVENT_ROW, error: null }],
      event_credits: [{ data: [FULL_CREDIT_ROW], error: null }],
    });

    const { GET } = await loadCollectionRoute();
    const res = await GET(makeGetRequest(), routeParamsEvent);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, credits: [FULL_CREDIT_ROW] });

    const listCall = mockDb.from.mock.results[1].value;
    expect(listCall.eq).toHaveBeenCalledWith('event_id', 'event-1');
  });
});

describe('POST /api/events/[eventId]/credits — attach an existing Partner', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));

    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ partnerId: 'partner-1', roleLabel: 'photographer' }), routeParamsEvent);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent event with the generic 404, before any mutation', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ partnerId: 'partner-1', roleLabel: 'photographer' }), routeParamsEvent);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing partnerId before any partner/credit lookup', async () => {
    mockDb.from = createFromMock({ events: [{ data: OWNED_EVENT_ROW, error: null }] });

    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ roleLabel: 'photographer' }), routeParamsEvent);

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('partnerId');
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid roleLabel before any partner/credit lookup', async () => {
    mockDb.from = createFromMock({ events: [{ data: OWNED_EVENT_ROW, error: null }] });

    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ partnerId: 'partner-1', roleLabel: 'not-a-real-role' }), routeParamsEvent);

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('roleLabel');
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('rejects attaching a nonexistent partner with the generic 404, before any insert', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_EVENT_ROW, error: null }],
      partners: [{ data: null, error: null }],
    });

    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ partnerId: 'partner-1', roleLabel: 'photographer' }), routeParamsEvent);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Partner not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(2);
  });

  it('rejects attaching another studio\'s partner with the same generic 404 (cross-tenant partner attach)', async () => {
    // getOwnedPartnerById scopes by studio_id too, so a foreign partner
    // resolves the same way as a nonexistent one — the mock only needs to
    // simulate the not-found result the ownership query would return.
    mockDb.from = createFromMock({
      events: [{ data: OWNED_EVENT_ROW, error: null }],
      partners: [{ data: null, error: null }],
    });

    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ partnerId: 'foreign-partner', roleLabel: 'photographer' }), routeParamsEvent);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Partner not found' });

    const partnerCall = mockDb.from.mock.results[1].value;
    expect(partnerCall.eq).toHaveBeenCalledWith('studio_id', 'studio-a');
  });

  it('creates the credit for a same-tenant partner, scoped to event_id/partner_id/role_label', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_EVENT_ROW, error: null }],
      partners: [{ data: OWNED_PARTNER_ROW, error: null }],
      event_credits: [{ data: FULL_CREDIT_ROW, error: null }],
    });

    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ partnerId: 'partner-1', roleLabel: 'photographer' }), routeParamsEvent);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, credit: FULL_CREDIT_ROW });

    const insertCall = mockDb.from.mock.results[2].value;
    const insertedPayload = insertCall.insert.mock.calls[0][0][0];
    expect(insertedPayload).toEqual({
      event_id: 'event-1',
      partner_id: 'partner-1',
      role_label: 'photographer',
      is_primary: false,
    });
  });

  it('returns a friendly 409 for a duplicate (event_id, partner_id, role_label) credit', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_EVENT_ROW, error: null }],
      partners: [{ data: OWNED_PARTNER_ROW, error: null }],
      event_credits: [
        {
          data: null,
          error: {
            code: '23505',
            message:
              'duplicate key value violates unique constraint "event_credits_unique_event_partner_role"',
          },
        },
      ],
    });

    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ partnerId: 'partner-1', roleLabel: 'photographer' }), routeParamsEvent);

    expect(res.status).toBe(409);
    expect((await res.json()).success).toBe(false);
  });

  it('returns a friendly 409 when a second primary credit is attempted', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_EVENT_ROW, error: null }],
      partners: [{ data: OWNED_PARTNER_ROW, error: null }],
      event_credits: [
        {
          data: null,
          error: {
            code: '23505',
            message: 'duplicate key value violates unique constraint "event_credits_one_primary_per_event"',
          },
        },
      ],
    });

    const { POST } = await loadCollectionRoute();
    const res = await POST(
      makePostRequest({ partnerId: 'partner-1', roleLabel: 'venue', isPrimary: true }),
      routeParamsEvent
    );

    expect(res.status).toBe(409);
    expect((await res.json()).success).toBe(false);
  });
});

describe('PATCH /api/events/[eventId]/credits/[creditId] — same-tenant update', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));

    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ roleLabel: 'venue' }), routeParamsCredit);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent event with the generic 404, before any credit lookup', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ roleLabel: 'venue' }), routeParamsCredit);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('rejects a cross-tenant or nonexistent credit with the generic 404, before any update', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_EVENT_ROW, error: null }],
      event_credits: [{ data: null, error: null }],
    });

    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ roleLabel: 'venue' }), routeParamsCredit);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event credit not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(2);
  });

  it('rejects an invalid roleLabel before any update', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_EVENT_ROW, error: null }],
      event_credits: [{ data: OWNED_CREDIT_ROW, error: null }],
    });

    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ roleLabel: 'bogus' }), routeParamsCredit);

    expect(res.status).toBe(400);
    expect(mockDb.from).toHaveBeenCalledTimes(2); // event + credit ownership only, no update
  });

  it('updates role_label for a same-tenant credit', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_EVENT_ROW, error: null }],
      event_credits: [
        { data: OWNED_CREDIT_ROW, error: null }, // ownership
        { data: { ...FULL_CREDIT_ROW, role_label: 'venue' }, error: null }, // update
      ],
    });

    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ roleLabel: 'venue' }), routeParamsCredit);

    expect(res.status).toBe(200);

    const updateCall = mockDb.from.mock.results[2].value;
    const updatedPayload = updateCall.update.mock.calls[0][0];
    expect(updatedPayload).toEqual({ role_label: 'venue' });
    expect(updateCall.eq.mock.calls).toEqual([
      ['id', 'credit-1'],
      ['event_id', 'event-1'],
    ]);
  });

  it('updates the primary-state where allowed', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_EVENT_ROW, error: null }],
      event_credits: [
        { data: OWNED_CREDIT_ROW, error: null },
        { data: { ...FULL_CREDIT_ROW, is_primary: true }, error: null },
      ],
    });

    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ isPrimary: true }), routeParamsCredit);

    expect(res.status).toBe(200);

    const updateCall = mockDb.from.mock.results[2].value;
    expect(updateCall.update.mock.calls[0][0]).toEqual({ is_primary: true });
  });

  it('returns a friendly 409 when the primary-state update conflicts with an existing primary', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_EVENT_ROW, error: null }],
      event_credits: [
        { data: OWNED_CREDIT_ROW, error: null },
        {
          data: null,
          error: {
            code: '23505',
            message: 'duplicate key value violates unique constraint "event_credits_one_primary_per_event"',
          },
        },
      ],
    });

    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ isPrimary: true }), routeParamsCredit);

    expect(res.status).toBe(409);
    expect((await res.json()).success).toBe(false);
  });
});

describe('DELETE /api/events/[eventId]/credits/[creditId] — same-tenant detach', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));

    const { DELETE } = await loadItemRoute();
    const res = await DELETE(makeDeleteRequest(), routeParamsCredit);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent event with the generic 404, before any delete', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const { DELETE } = await loadItemRoute();
    const res = await DELETE(makeDeleteRequest(), routeParamsCredit);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('rejects a cross-tenant or nonexistent credit with the generic 404, before any delete', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_EVENT_ROW, error: null }],
      event_credits: [{ data: null, error: null }],
    });

    const { DELETE } = await loadItemRoute();
    const res = await DELETE(makeDeleteRequest(), routeParamsCredit);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event credit not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(2);
  });

  it('deletes only the owned credit, scoped by both id and event_id', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_EVENT_ROW, error: null }],
      event_credits: [
        { data: OWNED_CREDIT_ROW, error: null }, // ownership
        { data: null, error: null }, // delete
      ],
    });

    const { DELETE } = await loadItemRoute();
    const res = await DELETE(makeDeleteRequest(), routeParamsCredit);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    const deleteCall = mockDb.from.mock.results[2].value;
    expect(deleteCall.delete).toHaveBeenCalled();
    expect(deleteCall.eq.mock.calls).toEqual([
      ['id', 'credit-1'],
      ['event_id', 'event-1'],
    ]);
  });
});
