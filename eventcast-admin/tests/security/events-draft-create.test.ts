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
  const mod = await import('@/app/api/events/draft/route');
  return mod.POST;
}

function makeRequest(body: unknown): Request {
  return new Request('http://test.local/api/events/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  eventType: 'Wedding',
  groomName: 'Raj',
  brideName: 'Priya',
  scheduledStartAtLocal: '2026-12-01T18:30',
  venueName: 'Taj Krishna',
  slug: 'raj-priya-wedding',
  templateId: 'wedding-template-01',
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess());
});

describe('POST /api/events/draft — Draft-safe creation', () => {
  it('rejects an unsupported event type before any database call', async () => {
    const POST = await loadRoute();
    const res = await POST(makeRequest({ ...VALID_BODY, eventType: 'Birthday' }));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.field).toBe('eventType');
  });

  it('rejects an unresolvable template instead of silently falling back', async () => {
    const POST = await loadRoute();
    const res = await POST(makeRequest({ ...VALID_BODY, templateId: 'does-not-exist' }));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.field).toBe('templateId');
  });

  it('rejects a missing groom name before any database call', async () => {
    const POST = await loadRoute();
    const res = await POST(makeRequest({ ...VALID_BODY, groomName: '  ' }));

    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('groomName');
  });

  it('rejects a slug already used by the same studio (tenant-scoped uniqueness)', async () => {
    mockDb.from = createFromMock({
      events: [{ data: [{ id: 'evt-existing' }], error: null }],
    });

    const POST = await loadRoute();
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.field).toBe('slug');

    const slugCheckCall = mockDb.from.mock.results[0].value;
    expect(slugCheckCall.eq.mock.calls).toEqual([
      ['studio_id', 'studio-a'],
      ['slug', 'raj-priya-wedding'],
    ]);
  });

  it('inserts a non-public Draft owned by the authenticated studio, with no billing/YouTube/media side effects', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: [], error: null }, // slug availability check
        { data: { id: 'evt-new-1' }, error: null }, // insert
      ],
    });

    const POST = await loadRoute();
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ success: true, id: 'evt-new-1', slug: 'raj-priya-wedding' });

    // Only the events table is ever touched by this route — no wallet,
    // transactions, YouTube, media-agent, or Restreamer calls exist to make.
    expect(mockDb.from).toHaveBeenCalledTimes(2);
    expect(mockDb.from).toHaveBeenCalledWith('events');

    const insertCall = mockDb.from.mock.results[1].value;
    expect(insertCall.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        studio_id: 'studio-a',
        event_type: 'Wedding',
        groom_name: 'Raj',
        bride_name: 'Priya',
        venue_name: 'Taj Krishna',
        slug: 'raj-priya-wedding',
        template_id: 'wedding-template-01',
        template_version: '1.0.0',
        scheduled_start_at: '2026-12-01T18:30:00+05:30',
        event_date: '2026-12-01',
        page_state: 'draft',
        event_visibility: 'unlisted',
      }),
    ]);

    // The Draft-safety mechanism for this slice is page_state — a Draft is
    // never publicly renderable regardless of visibility. event_visibility
    // is still explicitly written as a persistence-owned 'unlisted' default
    // (Visibility Foundation Gate), never left to the raw DB column default
    // and never accepted from client input.
    const insertedPayload = insertCall.insert.mock.calls[0][0][0];
    expect(insertedPayload.event_visibility).toBe('unlisted');
    expect(insertedPayload).not.toHaveProperty('visibility');
    expect(insertedPayload).not.toHaveProperty('deployment_status');
    expect(insertedPayload).not.toHaveProperty('youtube_broadcast_id');
    expect(insertedPayload).not.toHaveProperty('restreamer_ingest_url');
  });

  it('ignores any client-supplied event_visibility and always writes the persistence-owned unlisted default', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: [], error: null }, // slug availability check
        { data: { id: 'evt-new-2' }, error: null }, // insert
      ],
    });

    const POST = await loadRoute();
    const res = await POST(
      makeRequest({ ...VALID_BODY, slug: 'client-supplied-visibility', eventVisibility: 'public', event_visibility: 'public' })
    );

    expect(res.status).toBe(200);
    const insertCall = mockDb.from.mock.results[1].value;
    const insertedPayload = insertCall.insert.mock.calls[0][0][0];
    expect(insertedPayload.event_visibility).toBe('unlisted');
  });
});
