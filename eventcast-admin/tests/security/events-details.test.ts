import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createFromMock, authSuccess, type MockQueryBuilder, type AuthResult, type AuthSuccess } from './support/mocks';
import type { StudioMemberRole } from '@/lib/auth';

// Owner/admin-only mutation gate — same local-extension pattern as every
// other event-mutation test file (events-visibility.test.ts, events-draft-id.test.ts).
type DetailsAuth = AuthSuccess & { studioMemberRole: StudioMemberRole };
function detailsAuth(overrides: Partial<DetailsAuth> = {}): DetailsAuth {
  return { ...authSuccess(), studioMemberRole: 'owner', ...overrides };
}

const { mockDb, mockRequireAdmin } = vi.hoisted(() => {
  return {
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
    },
    mockRequireAdmin: vi.fn(async (): Promise<AuthResult> => ({} as AuthResult)),
  };
});

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, requireAdmin: mockRequireAdmin };
});
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadRoute() {
  const mod = await import('@/app/api/events/[eventId]/details/route');
  return { PATCH: mod.PATCH };
}

function makeRequest(body: unknown): Request {
  return new Request('http://test.local/api/events/event-1/details', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const routeParams = { params: Promise.resolve({ eventId: 'event-1' }) };

const PUBLISHED_ROW = {
  id: 'event-1',
  event_type: 'Wedding',
  groom_name: 'Raj',
  bride_name: 'Priya',
  venue_name: 'Taj Krishna',
  venue_map_link: null,
  slug: 'raj-priya-wedding',
  template_id: 'wedding-template-01',
  template_version: '1.0.0',
  // Stored as read back from Supabase — normalized to +00:00 regardless of
  // the offset it was written with (see eventContract.ts's own doc comment).
  scheduled_start_at: '2026-12-01T13:00:00+00:00',
  page_state: 'published',
  guest_photo_wall_enabled: true,
  thumbnail_url: null,
  event_visibility: 'public',
  archived_at: null,
  custom_top_title: null,
};

const VALID_EDIT_BODY = {
  groomName: 'Raj',
  brideName: 'Priya',
  scheduledStartAtLocal: '2026-12-01T18:30', // same instant as PUBLISHED_ROW's +00:00 value
  venueName: 'Taj Krishna',
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(detailsAuth());
});

describe('PATCH /api/events/[eventId]/details — auth and ownership', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));

    const { PATCH } = await loadRoute();
    const res = await PATCH(makeRequest(VALID_EDIT_BODY), routeParams);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a member-role studio user before any database access', async () => {
    mockRequireAdmin.mockResolvedValue(detailsAuth({ studioMemberRole: 'member' }));

    const { PATCH } = await loadRoute();
    const res = await PATCH(makeRequest(VALID_EDIT_BODY), routeParams);

    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent event with the existing generic non-enumerating 404, before any write', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const { PATCH } = await loadRoute();
    const res = await PATCH(makeRequest(VALID_EDIT_BODY), routeParams);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('scopes the ownership read to both the event id and the authenticated studio id', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const { PATCH } = await loadRoute();
    await PATCH(makeRequest(VALID_EDIT_BODY), routeParams);

    const ownershipBuilder = mockDb.from.mock.results[0].value;
    expect(ownershipBuilder.eq).toHaveBeenNthCalledWith(1, 'id', 'event-1');
    expect(ownershipBuilder.eq).toHaveBeenNthCalledWith(2, 'studio_id', 'studio-a');
  });
});

describe('PATCH /api/events/[eventId]/details — state gating', () => {
  it('refuses to edit a Draft event through this endpoint, without writing', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { ...PUBLISHED_ROW, page_state: 'draft' }, error: null }],
    });

    const { PATCH } = await loadRoute();
    const res = await PATCH(makeRequest(VALID_EDIT_BODY), routeParams);

    expect(res.status).toBe(409);
    expect((await res.json()).success).toBe(false);
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('refuses to edit an archived event even if its page_state is published, without writing', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { ...PUBLISHED_ROW, archived_at: '2026-09-01T00:00:00+00:00' }, error: null }],
    });

    const { PATCH } = await loadRoute();
    const res = await PATCH(makeRequest(VALID_EDIT_BODY), routeParams);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/archived/i);
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('takes the archived response over the not-published response when both conditions hold', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { ...PUBLISHED_ROW, page_state: 'draft', archived_at: '2026-09-01T00:00:00+00:00' }, error: null }],
    });

    const { PATCH } = await loadRoute();
    const res = await PATCH(makeRequest(VALID_EDIT_BODY), routeParams);

    const body = await res.json();
    expect(body.error).toMatch(/archived/i);
  });
});

describe('PATCH /api/events/[eventId]/details — slug is locked', () => {
  it('rejects a request that includes slug, before any write', async () => {
    mockDb.from = createFromMock({ events: [{ data: PUBLISHED_ROW, error: null }] });

    const { PATCH } = await loadRoute();
    const res = await PATCH(makeRequest({ ...VALID_EDIT_BODY, slug: 'a-new-slug' }), routeParams);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.field).toBe('slug');
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH /api/events/[eventId]/details — field validation', () => {
  it('rejects a missing venue before any write', async () => {
    mockDb.from = createFromMock({ events: [{ data: PUBLISHED_ROW, error: null }] });

    const { PATCH } = await loadRoute();
    const res = await PATCH(makeRequest({ ...VALID_EDIT_BODY, venueName: '   ' }), routeParams);

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('venueName');
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-http(s) venue map link, before any write', async () => {
    mockDb.from = createFromMock({ events: [{ data: PUBLISHED_ROW, error: null }] });

    const { PATCH } = await loadRoute();
    const res = await PATCH(makeRequest({ ...VALID_EDIT_BODY, venueMapLink: 'javascript:alert(1)' }), routeParams);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.field).toBe('venueMapLink');
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('accepts a valid https venue map link', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: PUBLISHED_ROW, error: null },
        { data: { id: 'event-1' }, error: null },
      ],
    });

    const { PATCH } = await loadRoute();
    const res = await PATCH(makeRequest({ ...VALID_EDIT_BODY, venueMapLink: 'https://maps.google.com/?q=x' }), routeParams);

    expect(res.status).toBe(200);
  });

  it('accepts a blank venue map link (clears the field)', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: { ...PUBLISHED_ROW, venue_map_link: 'https://maps.google.com/old' }, error: null },
        { data: { id: 'event-1' }, error: null },
      ],
    });

    const { PATCH } = await loadRoute();
    const res = await PATCH(makeRequest({ ...VALID_EDIT_BODY, venueMapLink: '' }), routeParams);

    expect(res.status).toBe(200);
    const updateCall = mockDb.from.mock.results[1].value;
    expect(updateCall.update).toHaveBeenCalledWith(expect.objectContaining({ venue_map_link: null }));
  });
});

describe('PATCH /api/events/[eventId]/details — successful edit', () => {
  it('writes only the editable core-details fields, scoped by id, studio, published state, and not-archived', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: PUBLISHED_ROW, error: null }, // ownership
        { data: { id: 'event-1' }, error: null }, // update
      ],
    });

    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makeRequest({
        groomName: 'Raj Updated',
        brideName: 'Priya',
        scheduledStartAtLocal: '2026-12-05T09:00',
        venueName: 'New Venue',
        venueMapLink: 'https://maps.google.com/?q=new',
        customTopTitle: 'Welcome!',
        guestPhotoWallEnabled: false,
      }),
      routeParams
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, id: 'event-1', scheduleChanged: true });

    const updateCall = mockDb.from.mock.results[1].value;
    expect(updateCall.update).toHaveBeenCalledWith({
      groom_name: 'Raj Updated',
      bride_name: 'Priya',
      venue_name: 'New Venue',
      venue_map_link: 'https://maps.google.com/?q=new',
      scheduled_start_at: '2026-12-05T09:00:00+05:30',
      event_date: '2026-12-05',
      event_time: '9:00 AM',
      timer_target_time: '09:00',
      guest_photo_wall_enabled: false,
      custom_top_title: 'Welcome!',
    });

    const written = updateCall.update.mock.calls[0][0];
    expect(written).not.toHaveProperty('slug');
    expect(written).not.toHaveProperty('template_id');
    expect(written).not.toHaveProperty('template_version');
    expect(written).not.toHaveProperty('page_state');
    expect(written).not.toHaveProperty('event_visibility');
    expect(written).not.toHaveProperty('published_credits');
    expect(written).not.toHaveProperty('thumbnail_url');
    expect(written).not.toHaveProperty('studio_id');
    expect(written).not.toHaveProperty('draft_last_activity_at');

    expect(updateCall.eq.mock.calls).toEqual([
      ['id', 'event-1'],
      ['studio_id', 'studio-a'],
      ['page_state', 'published'],
    ]);
    expect(updateCall.is).toHaveBeenCalledWith('archived_at', null);
  });

  it('reports scheduleChanged: false when the new local time resolves to the same instant as the stored (offset-normalized) value', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: PUBLISHED_ROW, error: null }, // scheduled_start_at: 2026-12-01T13:00:00+00:00 == 2026-12-01T18:30 IST
        { data: { id: 'event-1' }, error: null },
      ],
    });

    const { PATCH } = await loadRoute();
    const res = await PATCH(makeRequest(VALID_EDIT_BODY), routeParams);

    expect(res.status).toBe(200);
    expect((await res.json()).scheduleChanged).toBe(false);
  });

  it('reports scheduleChanged: true when the new local time resolves to a different instant', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: PUBLISHED_ROW, error: null },
        { data: { id: 'event-1' }, error: null },
      ],
    });

    const { PATCH } = await loadRoute();
    const res = await PATCH(makeRequest({ ...VALID_EDIT_BODY, scheduledStartAtLocal: '2026-12-02T09:00' }), routeParams);

    expect(res.status).toBe(200);
    expect((await res.json()).scheduleChanged).toBe(true);
  });

  it('reports a lost race (event no longer matches the guarded filter by write time) as a conflict, not success', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: PUBLISHED_ROW, error: null }, // ownership
        { data: null, error: null }, // update matched no row
      ],
    });

    const { PATCH } = await loadRoute();
    const res = await PATCH(makeRequest(VALID_EDIT_BODY), routeParams);

    expect(res.status).toBe(409);
    expect((await res.json()).success).toBe(false);
  });

  it('surfaces a database update failure instead of reporting success', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: PUBLISHED_ROW, error: null },
        { data: null, error: { message: 'connection reset' } },
      ],
    });

    const { PATCH } = await loadRoute();
    const res = await PATCH(makeRequest(VALID_EDIT_BODY), routeParams);

    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });
});
