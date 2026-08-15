import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createFromMock, authSuccess, type MockQueryBuilder, type AuthSuccess } from './support/mocks';

type StudioMemberRole = 'owner' | 'admin' | 'member';
type PartnerAuthSuccess = AuthSuccess & { studioMemberRole: StudioMemberRole };
type PartnerAuthResult = PartnerAuthSuccess | NextResponse;

/**
 * The shared `authSuccess()` helper predates `studioMemberRole`; this file
 * extends it locally rather than changing the shape every other security
 * suite depends on. Defaults to `owner` so the pre-existing cases keep
 * exercising an authorized caller.
 */
function partnerAuth(studioMemberRole: StudioMemberRole = 'owner'): PartnerAuthSuccess {
  return { ...authSuccess(), studioMemberRole };
}

const { mockDb, mockRequireAdmin } = vi.hoisted(() => {
  return {
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
    },
    mockRequireAdmin: vi.fn(async (): Promise<PartnerAuthResult> => {
      throw new Error('mockRequireAdmin not configured for this test');
    }),
  };
});

// Only requireAdmin is replaced — canMutateStudioResources stays real so these
// tests exercise the actual role rule rather than a restatement of it.
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return { ...actual, requireAdmin: mockRequireAdmin };
});
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadCollectionRoute() {
  const mod = await import('@/app/api/partners/route');
  return { GET: mod.GET, POST: mod.POST };
}

async function loadItemRoute() {
  const mod = await import('@/app/api/partners/[partnerId]/route');
  return { PATCH: mod.PATCH, DELETE: mod.DELETE };
}

function makeGetRequest(): Request {
  return new Request('http://test.local/api/partners', { method: 'GET' });
}

function makePostRequest(body: unknown): Request {
  return new Request('http://test.local/api/partners', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(body: unknown): Request {
  return new Request('http://test.local/api/partners/partner-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(): Request {
  return new Request('http://test.local/api/partners/partner-1', { method: 'DELETE' });
}

const routeParams = { params: Promise.resolve({ partnerId: 'partner-1' }) };

const OWNED_ROW = { id: 'partner-1' };

const FULL_PARTNER_ROW = {
  id: 'partner-1',
  studio_id: 'studio-a',
  partner_type: 'photographer',
  business_name: 'Studio Light Photography',
  contact_person: null,
  phone: null,
  whatsapp: null,
  city: null,
  instagram_url: null,
  facebook_url: null,
  youtube_url: null,
  website_url: null,
  logo_url: null,
  internal_notes: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(partnerAuth('owner'));
});

describe('GET /api/partners — list scoped to the authenticated studio', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));

    const { GET } = await loadCollectionRoute();
    const res = await GET(makeGetRequest());

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it("queries only the caller's own studio_id, never a client-supplied one", async () => {
    mockDb.from = createFromMock({ partners: [{ data: [FULL_PARTNER_ROW], error: null }] });

    const { GET } = await loadCollectionRoute();
    const res = await GET(makeGetRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, partners: [FULL_PARTNER_ROW] });

    const queryCall = mockDb.from.mock.results[0].value;
    expect(queryCall.eq).toHaveBeenCalledWith('studio_id', 'studio-a');
  });
});

describe('POST /api/partners — create under the authenticated studio only', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));

    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ partnerType: 'venue', businessName: 'Grand Hall' }));

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects an invalid partnerType', async () => {
    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ partnerType: 'not-a-real-type', businessName: 'Grand Hall' }));

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('partnerType');
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a missing businessName', async () => {
    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ partnerType: 'venue', businessName: '   ' }));

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('businessName');
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied studio_id/studioId and always inserts the caller's own studio_id", async () => {
    mockDb.from = createFromMock({ partners: [{ data: FULL_PARTNER_ROW, error: null }] });

    const { POST } = await loadCollectionRoute();
    const res = await POST(
      makePostRequest({
        partnerType: 'photographer',
        businessName: 'Studio Light Photography',
        studioId: 'studio-b',
        studio_id: 'studio-b',
      })
    );

    expect(res.status).toBe(200);

    const insertCall = mockDb.from.mock.results[0].value;
    const insertedPayload = insertCall.insert.mock.calls[0][0][0];
    expect(insertedPayload.studio_id).toBe('studio-a');
    expect(insertedPayload).not.toHaveProperty('studioId');
  });

  it('creates a partner with optional fields defaulted to null when omitted', async () => {
    mockDb.from = createFromMock({ partners: [{ data: FULL_PARTNER_ROW, error: null }] });

    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ partnerType: 'photographer', businessName: 'Studio Light Photography' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, partner: FULL_PARTNER_ROW });

    const insertCall = mockDb.from.mock.results[0].value;
    const insertedPayload = insertCall.insert.mock.calls[0][0][0];
    expect(insertedPayload).toEqual({
      studio_id: 'studio-a',
      partner_type: 'photographer',
      business_name: 'Studio Light Photography',
      contact_person: null,
      phone: null,
      whatsapp: null,
      city: null,
      instagram_url: null,
      facebook_url: null,
      youtube_url: null,
      website_url: null,
      logo_url: null,
      internal_notes: null,
    });
  });
});

describe('PATCH /api/partners/[partnerId] — cross-tenant isolation and ownership', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));

    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ businessName: 'New Name' }), routeParams);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant or nonexistent partner with the generic 404, before any update", async () => {
    mockDb.from = createFromMock({ partners: [{ data: null, error: null }] });

    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ businessName: "Studio B's Partner Renamed" }), routeParams);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Partner not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid partnerType on update', async () => {
    mockDb.from = createFromMock({ partners: [{ data: OWNED_ROW, error: null }] });

    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ partnerType: 'bogus' }), routeParams);

    expect(res.status).toBe(400);
    expect(mockDb.from).toHaveBeenCalledTimes(1); // ownership only, no update
  });

  it('rejects clearing businessName to empty', async () => {
    mockDb.from = createFromMock({ partners: [{ data: OWNED_ROW, error: null }] });

    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ businessName: '   ' }), routeParams);

    expect(res.status).toBe(400);
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('applies only the fields provided, scoped by both id and studio_id, and stamps updated_at', async () => {
    mockDb.from = createFromMock({
      partners: [
        { data: OWNED_ROW, error: null }, // ownership
        { data: { ...FULL_PARTNER_ROW, business_name: 'Renamed Studio' }, error: null }, // update
      ],
    });

    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ businessName: 'Renamed Studio' }), routeParams);

    expect(res.status).toBe(200);

    const updateCall = mockDb.from.mock.results[1].value;
    const updatedPayload = updateCall.update.mock.calls[0][0];
    expect(updatedPayload.business_name).toBe('Renamed Studio');
    expect(updatedPayload).toHaveProperty('updated_at');
    expect(updatedPayload).not.toHaveProperty('partner_type');
    expect(updatedPayload).not.toHaveProperty('studio_id');

    expect(updateCall.eq.mock.calls).toEqual([
      ['id', 'partner-1'],
      ['studio_id', 'studio-a'],
    ]);
  });
});

describe('DELETE /api/partners/[partnerId] — cross-tenant isolation and ownership', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));

    const { DELETE } = await loadItemRoute();
    const res = await DELETE(makeDeleteRequest(), routeParams);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent partner with the generic 404, before any delete', async () => {
    mockDb.from = createFromMock({ partners: [{ data: null, error: null }] });

    const { DELETE } = await loadItemRoute();
    const res = await DELETE(makeDeleteRequest(), routeParams);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Partner not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('deletes only the owned row, scoped by both id and studio_id', async () => {
    mockDb.from = createFromMock({
      partners: [
        { data: OWNED_ROW, error: null }, // ownership
        { data: null, error: null }, // delete
      ],
    });

    const { DELETE } = await loadItemRoute();
    const res = await DELETE(makeDeleteRequest(), routeParams);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    const deleteCall = mockDb.from.mock.results[1].value;
    expect(deleteCall.delete).toHaveBeenCalled();
    expect(deleteCall.eq.mock.calls).toEqual([
      ['id', 'partner-1'],
      ['studio_id', 'studio-a'],
    ]);
  });

  it('returns a friendly 409 when the partner is still credited on an event (FK violation)', async () => {
    mockDb.from = createFromMock({
      partners: [
        { data: OWNED_ROW, error: null }, // ownership
        { data: null, error: { message: 'update or delete on table "partners" violates foreign key constraint', code: '23503' } }, // delete
      ],
    });

    const { DELETE } = await loadItemRoute();
    const res = await DELETE(makeDeleteRequest(), routeParams);

    expect(res.status).toBe(409);
    expect((await res.json()).success).toBe(false);
  });
});

/**
 * Migration 0030 lets any studio member SELECT partners but restricts
 * INSERT/UPDATE/DELETE to `owner`/`admin`. These routes use the service-role
 * client, which bypasses RLS, so the application must enforce that itself.
 */
describe('studio-member role enforcement on Partner mutations', () => {
  it('allows an owner to create a partner', async () => {
    mockRequireAdmin.mockResolvedValue(partnerAuth('owner'));
    mockDb.from = createFromMock({ partners: [{ data: FULL_PARTNER_ROW, error: null }] });

    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ partnerType: 'venue', businessName: 'Grand Hall' }));

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('allows an admin to create a partner', async () => {
    mockRequireAdmin.mockResolvedValue(partnerAuth('admin'));
    mockDb.from = createFromMock({ partners: [{ data: FULL_PARTNER_ROW, error: null }] });

    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ partnerType: 'venue', businessName: 'Grand Hall' }));

    expect(res.status).toBe(200);
  });

  it('allows an admin to update a partner', async () => {
    mockRequireAdmin.mockResolvedValue(partnerAuth('admin'));
    mockDb.from = createFromMock({
      partners: [
        { data: OWNED_ROW, error: null }, // ownership
        { data: { ...FULL_PARTNER_ROW, business_name: 'Renamed' }, error: null }, // update
      ],
    });

    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ businessName: 'Renamed' }), routeParams);

    expect(res.status).toBe(200);
  });

  it('allows an admin to delete a partner', async () => {
    mockRequireAdmin.mockResolvedValue(partnerAuth('admin'));
    mockDb.from = createFromMock({
      partners: [
        { data: OWNED_ROW, error: null }, // ownership
        { data: null, error: null }, // delete
      ],
    });

    const { DELETE } = await loadItemRoute();
    const res = await DELETE(makeDeleteRequest(), routeParams);

    expect(res.status).toBe(200);
  });

  it('still lets a member list partners (read access is unrestricted by role)', async () => {
    mockRequireAdmin.mockResolvedValue(partnerAuth('member'));
    mockDb.from = createFromMock({ partners: [{ data: [FULL_PARTNER_ROW], error: null }] });

    const { GET } = await loadCollectionRoute();
    const res = await GET(makeGetRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, partners: [FULL_PARTNER_ROW] });
  });

  it('rejects a member POST with 403 before any database call', async () => {
    mockRequireAdmin.mockResolvedValue(partnerAuth('member'));

    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ partnerType: 'venue', businessName: 'Grand Hall' }));

    expect(res.status).toBe(403);
    expect((await res.json()).success).toBe(false);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a member PATCH with 403 before the ownership lookup or any update', async () => {
    mockRequireAdmin.mockResolvedValue(partnerAuth('member'));

    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ businessName: 'Renamed' }), routeParams);

    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a member DELETE with 403 before the ownership lookup or any delete', async () => {
    mockRequireAdmin.mockResolvedValue(partnerAuth('member'));

    const { DELETE } = await loadItemRoute();
    const res = await DELETE(makeDeleteRequest(), routeParams);

    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('reports a same-studio role failure as 403, not the generic cross-tenant 404', async () => {
    mockRequireAdmin.mockResolvedValue(partnerAuth('member'));

    const { DELETE } = await loadItemRoute();
    const res = await DELETE(makeDeleteRequest(), routeParams);

    expect(res.status).toBe(403);
    expect((await res.json()).error).not.toBe('Partner not found');
  });

  it('fails closed on an unrecognised role value', async () => {
    mockRequireAdmin.mockResolvedValue(partnerAuth('viewer' as StudioMemberRole));

    const { POST } = await loadCollectionRoute();
    const res = await POST(makePostRequest({ partnerType: 'venue', businessName: 'Grand Hall' }));

    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('keeps cross-tenant behavior unchanged for an authorized admin', async () => {
    mockRequireAdmin.mockResolvedValue(partnerAuth('admin'));
    mockDb.from = createFromMock({ partners: [{ data: null, error: null }] });

    const { PATCH } = await loadItemRoute();
    const res = await PATCH(makePatchRequest({ businessName: 'Renamed' }), routeParams);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Partner not found' });
  });
});
