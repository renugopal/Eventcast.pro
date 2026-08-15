import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFromMock, authSuccess, type MockQueryBuilder } from './support/mocks';

const { mockDb, mockRequireAdmin } = vi.hoisted(() => {
  return {
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
    },
    mockRequireAdmin: vi.fn(async () => authSuccess()),
  };
});

vi.mock('@/lib/auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadRoute() {
  const mod = await import('@/app/api/events/draft/[eventId]/route');
  return { GET: mod.GET, PATCH: mod.PATCH };
}

function makeGetRequest(): Request {
  return new Request('http://test.local/api/events/draft/evt-1', { method: 'GET' });
}

function makePatchRequest(body: unknown): Request {
  return new Request('http://test.local/api/events/draft/evt-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const routeParams = { params: Promise.resolve({ eventId: 'evt-1' }) };

const DRAFT_ROW = {
  id: 'evt-1',
  event_type: 'Wedding',
  groom_name: 'Raj',
  bride_name: 'Priya',
  venue_name: 'Taj Krishna',
  slug: 'raj-priya-wedding',
  template_id: 'wedding-template-01',
  template_version: '1.0.0',
  scheduled_start_at: '2026-12-01T18:30:00+05:30',
  page_state: 'draft',
  guest_photo_wall_enabled: true,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess());
});

describe('GET /api/events/draft/[eventId] — reopen a Draft by stable UUID', () => {
  it('rejects a cross-tenant or nonexistent event with a generic 404', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), routeParams);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
  });

  it('returns the owned Draft scoped by both event id and studio id', async () => {
    mockDb.from = createFromMock({ events: [{ data: DRAFT_ROW, error: null }] });

    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), routeParams);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, event: DRAFT_ROW });

    const queryCall = mockDb.from.mock.results[0].value;
    expect(queryCall.eq.mock.calls).toEqual([
      ['id', 'evt-1'],
      ['studio_id', 'studio-a'],
    ]);
  });
});

describe('PATCH /api/events/draft/[eventId] — edit and save a Draft', () => {
  it('rejects a cross-tenant or nonexistent event before any update', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makePatchRequest({ groomName: 'Raj', brideName: 'Priya', scheduledStartAtLocal: '2026-12-01T18:30', venueName: 'Taj Krishna', slug: 'raj-priya-wedding' }),
      routeParams
    );

    expect(res.status).toBe(404);
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('refuses to edit a non-draft event through this endpoint', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { ...DRAFT_ROW, page_state: 'published' }, error: null }],
    });

    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makePatchRequest({ groomName: 'Raj', brideName: 'Priya', scheduledStartAtLocal: '2026-12-01T18:30', venueName: 'Taj Krishna', slug: 'raj-priya-wedding' }),
      routeParams
    );

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it('rejects a missing venue before any mutation', async () => {
    mockDb.from = createFromMock({ events: [{ data: DRAFT_ROW, error: null }] });

    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makePatchRequest({ groomName: 'Raj', brideName: 'Priya', scheduledStartAtLocal: '2026-12-01T18:30', venueName: '  ', slug: 'raj-priya-wedding' }),
      routeParams
    );

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('venueName');
  });

  it('re-checks tenant-scoped slug uniqueness (excluding itself) only when the slug actually changes', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: DRAFT_ROW, error: null }, // ownership
        { data: [{ id: 'evt-other' }], error: null }, // slug collision
      ],
    });

    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makePatchRequest({ groomName: 'Raj', brideName: 'Priya', scheduledStartAtLocal: '2026-12-01T18:30', venueName: 'Taj Krishna', slug: 'a-new-slug' }),
      routeParams
    );

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.field).toBe('slug');

    const slugCheckCall = mockDb.from.mock.results[1].value;
    expect(slugCheckCall.eq.mock.calls).toEqual([
      ['studio_id', 'studio-a'],
      ['slug', 'a-new-slug'],
    ]);
    expect(slugCheckCall.neq).toHaveBeenCalledWith('id', 'evt-1');
  });

  it('saves allowed Draft field edits without touching template, page_state, or studio ownership', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: DRAFT_ROW, error: null }, // ownership
        { data: null, error: null }, // update
      ],
    });

    const { PATCH } = await loadRoute();
    const res = await PATCH(
      makePatchRequest({
        groomName: 'Raj Updated',
        brideName: 'Priya',
        scheduledStartAtLocal: '2026-12-02T09:00',
        venueName: 'New Venue',
        slug: 'raj-priya-wedding',
      }),
      routeParams
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, id: 'evt-1', slug: 'raj-priya-wedding' });

    // Same slug — no collision re-check, straight to the update call.
    expect(mockDb.from).toHaveBeenCalledTimes(2);

    const updateCall = mockDb.from.mock.results[1].value;
    expect(updateCall.update).toHaveBeenCalledWith({
      groom_name: 'Raj Updated',
      bride_name: 'Priya',
      venue_name: 'New Venue',
      slug: 'raj-priya-wedding',
      scheduled_start_at: '2026-12-02T09:00:00+05:30',
      event_date: '2026-12-02',
      event_time: '9:00 AM',
      timer_target_time: '09:00',
    });
    expect(updateCall.eq.mock.calls).toEqual([
      ['id', 'evt-1'],
      ['studio_id', 'studio-a'],
    ]);

    const updatedPayload = updateCall.update.mock.calls[0][0];
    expect(updatedPayload).not.toHaveProperty('page_state');
    expect(updatedPayload).not.toHaveProperty('template_id');
    expect(updatedPayload).not.toHaveProperty('studio_id');
  });
});
