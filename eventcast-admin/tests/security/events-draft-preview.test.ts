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
  const mod = await import('@/app/api/events/draft/[eventId]/preview/route');
  return { GET: mod.GET };
}

function makeGetRequest(): Request {
  return new Request('http://test.local/api/events/draft/evt-1/preview', { method: 'GET' });
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
  scheduled_start_at: '2026-12-01T18:30:00+05:30',
  guest_photo_wall_enabled: true,
  studio_id: 'studio-a',
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess());
});

describe('GET /api/events/draft/[eventId]/preview — read-only canonical renderer preview', () => {
  it('rejects a cross-tenant or nonexistent event with a generic 404, before any rendering is attempted', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), routeParams);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    // Only the ownership-scoped lookup happened — no other table access.
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('renders the owned Draft and returns success — no write to the events or event_credits table occurs', async () => {
    mockDb.from = createFromMock({
      events: [{ data: DRAFT_ROW, error: null }],
      event_credits: [{ data: [], error: null }],
    });

    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), routeParams);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(typeof data.html).toBe('string');
    expect(data.html).toContain('window.WEDDING_CONFIG');
    expect(data.html).toContain('groom: "Raj"');
    // No credits attached yet — a no-credit Draft still renders correctly.
    expect(data.html).toContain('eventCredits: []');
    expect(data.html).toContain('photographer: null');

    // Read-only: neither query builder's mutating methods were ever called.
    for (const call of mockDb.from.mock.results) {
      expect(call.value.insert).not.toHaveBeenCalled();
      expect(call.value.update).not.toHaveBeenCalled();
      expect(call.value.delete).not.toHaveBeenCalled();
    }
    // Exactly two read-only DB calls total (owned Draft + its Event Credits)
    // — no SRS/Media Agent assignment lookup, no other query of any kind.
    expect(mockDb.from).toHaveBeenCalledTimes(2);
    expect(mockDb.from).toHaveBeenNthCalledWith(1, 'events');
    expect(mockDb.from).toHaveBeenNthCalledWith(2, 'event_credits');
  });

  it('projects the Draft\'s current editable Event Credits into the rendered preview — primary credit reuses the footer studio-name/logo slot, additional credits are threaded through in order', async () => {
    mockDb.from = createFromMock({
      events: [{ data: DRAFT_ROW, error: null }],
      event_credits: [
        {
          data: [
            {
              role_label: 'venue',
              is_primary: false,
              partners: { business_name: 'Grand Venue', logo_url: null, website_url: null, instagram_url: null, facebook_url: null, youtube_url: null },
            },
            {
              role_label: 'photographer',
              is_primary: true,
              partners: { business_name: 'Dream Captures', logo_url: 'https://r2.example/logo.png', website_url: null, instagram_url: 'https://instagram.com/dreamcaptures', facebook_url: null, youtube_url: null },
            },
          ],
          error: null,
        },
      ],
    });

    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), routeParams);

    expect(res.status).toBe(200);
    const data = await res.json();
    // Primary-first ordering, regardless of the order the DB rows arrived in.
    expect(data.html).toContain(
      'eventCredits: [{"businessName":"Dream Captures","roleLabel":"photographer","isPrimary":true,"logoUrl":"https://r2.example/logo.png","websiteUrl":null,"instagramUrl":"https://instagram.com/dreamcaptures","facebookUrl":null,"youtubeUrl":null},{"businessName":"Grand Venue","roleLabel":"venue","isPrimary":false,"logoUrl":null,"websiteUrl":null,"instagramUrl":null,"facebookUrl":null,"youtubeUrl":null}]'
    );
    expect(data.html).toContain('"studio_name":"Dream Captures"');
    // The public projection never carries a phone number.
    expect(data.html).not.toContain('phone_number');
  });

  it('fails the preview with a 500 rather than silently rendering with no credits when the Event Credit query itself fails', async () => {
    mockDb.from = createFromMock({
      events: [{ data: DRAFT_ROW, error: null }],
      event_credits: [{ data: null, error: { message: 'connection error' } }],
    });

    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), routeParams);

    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });

  it('rejects an unsupported template_id instead of silently rendering the wrong markup', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { ...DRAFT_ROW, template_id: 'half-saree-template-01' }, error: null }],
    });

    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), routeParams);

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/half-saree-template-01/);
  });

  it('threads an assigned thumbnail_url through to og:image/twitter:image in the rendered preview', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { ...DRAFT_ROW, thumbnail_url: 'https://r2.example/thumb.jpg' }, error: null }],
      event_credits: [{ data: [], error: null }],
    });

    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), routeParams);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.html).toMatch(/<meta property="og:image" content="https:\/\/r2\.example\/thumb\.jpg\?v=\d+">/);
    expect(data.html).toMatch(/<meta name="twitter:image" content="https:\/\/r2\.example\/thumb\.jpg\?v=\d+">/);
  });

  it('rejects a Draft missing a scheduled start time', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { ...DRAFT_ROW, scheduled_start_at: null }, error: null }],
    });

    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), routeParams);

    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
  });
});
