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

async function loadPublishRoute() {
  const mod = await import('@/app/api/events/[eventId]/publish/route');
  return { POST: mod.POST };
}

function makePublishRequest(body?: unknown): Request {
  return new Request('http://test.local/api/events/event-1/publish', {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

const routeParams = { params: Promise.resolve({ eventId: 'event-1' }) };

const OWNED_DRAFT_ROW = { id: 'event-1', page_state: 'draft', published_credits: null };
const OWNED_PUBLISHED_ROW = {
  id: 'event-1',
  page_state: 'published',
  published_credits: [
    {
      businessName: 'Historical Studio',
      roleLabel: 'photographer',
      isPrimary: true,
      logoUrl: null,
      websiteUrl: null,
      instagramUrl: null,
      facebookUrl: null,
      youtubeUrl: null,
    },
  ],
};
const OWNED_PRE_FROZEN_DRAFT_ROW = {
  id: 'event-1',
  page_state: 'draft',
  published_credits: OWNED_PUBLISHED_ROW.published_credits,
};

// The join row shape `loadOwnedEventCreditsWithPartners` maps. The extra
// `phone`/`contact_person`/`internal_notes` keys are deliberately present
// here even though the loader's column list never requests them — they prove
// the projection, not just the SQL select list, keeps private Partner fields
// out of the frozen snapshot.
const PRIMARY_CREDIT_ROW = {
  role_label: 'photographer',
  is_primary: true,
  partners: {
    business_name: 'Primary Studio',
    logo_url: 'https://cdn.example.com/logo.png',
    website_url: 'https://primary.example.com',
    instagram_url: 'https://instagram.com/primary',
    facebook_url: null,
    youtube_url: null,
    contact_person: 'Private Person',
    phone: '+91 90000 00000',
    whatsapp: '+91 90000 00000',
    city: 'Hyderabad',
    internal_notes: 'Pays late',
  },
};

const ADDITIONAL_CREDIT_ROW = {
  role_label: 'venue',
  is_primary: false,
  partners: {
    business_name: 'Additional Venue',
    logo_url: null,
    website_url: null,
    instagram_url: null,
    facebook_url: null,
    youtube_url: null,
  },
};

const PUBLISH_UPDATE_OK = { data: { id: 'event-1', page_state: 'published' }, error: null };

const PUBLIC_CREDIT_KEYS = [
  'businessName',
  'roleLabel',
  'isPrimary',
  'logoUrl',
  'websiteUrl',
  'instagramUrl',
  'facebookUrl',
  'youtubeUrl',
].sort();

/** The `.from('events')` builder used for the Publish write (the second one). */
function publishWriteBuilder(): MockQueryBuilder {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromMock = mockDb.from as any;
  const eventsCallIndexes: number[] = fromMock.mock.calls
    .map((args: unknown[], i: number) => (args[0] === 'events' ? i : -1))
    .filter((i: number) => i !== -1);
  expect(eventsCallIndexes).toHaveLength(2);
  return fromMock.mock.results[eventsCallIndexes[1]].value as MockQueryBuilder;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess());
});

describe('POST /api/events/[eventId]/publish — access control', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));

    const { POST } = await loadPublishRoute();
    const res = await POST(makePublishRequest(), routeParams);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a cross-tenant or nonexistent event with the generic 404, before any credit read or write', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const { POST } = await loadPublishRoute();
    const res = await POST(makePublishRequest(), routeParams);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
    expect(mockDb.from).not.toHaveBeenCalledWith('event_credits');
  });

  it('scopes the ownership read to both the event id and the authenticated studio id', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const { POST } = await loadPublishRoute();
    await POST(makePublishRequest(), routeParams);

    const ownershipBuilder = mockDb.from.mock.results[0].value;
    expect(ownershipBuilder.eq).toHaveBeenNthCalledWith(1, 'id', 'event-1');
    expect(ownershipBuilder.eq).toHaveBeenNthCalledWith(2, 'studio_id', 'studio-a');
  });
});

describe('POST /api/events/[eventId]/publish — state guards', () => {
  it('refuses to republish an already-published event, without reading credits or writing', async () => {
    mockDb.from = createFromMock({ events: [{ data: OWNED_PUBLISHED_ROW, error: null }] });

    const { POST } = await loadPublishRoute();
    const res = await POST(makePublishRequest(), routeParams);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, error: 'Only Draft events can be published.' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
    expect(mockDb.from).not.toHaveBeenCalledWith('event_credits');
  });

  it('fails closed on a Draft that already carries a frozen snapshot, overwriting neither it nor the page state', async () => {
    mockDb.from = createFromMock({ events: [{ data: OWNED_PRE_FROZEN_DRAFT_ROW, error: null }] });

    const { POST } = await loadPublishRoute();
    const res = await POST(makePublishRequest(), routeParams);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/frozen public credit snapshot/i);
    // Ownership read only — no credit query and, critically, no update.
    expect(mockDb.from).toHaveBeenCalledTimes(1);
    expect(mockDb.from).not.toHaveBeenCalledWith('event_credits');
  });

  it('does not publish when the Event Credit query fails', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_DRAFT_ROW, error: null }],
      event_credits: [{ data: null, error: { message: 'boom' } }],
    });

    const { POST } = await loadPublishRoute();
    const res = await POST(makePublishRequest({ visibility: 'public' }), routeParams);

    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
    // Ownership read + credit read only: the events queue was never consumed
    // a second time, so no update was attempted.
    expect(mockDb.from).toHaveBeenCalledTimes(2);
  });
});

describe('POST /api/events/[eventId]/publish — snapshot content', () => {
  it('freezes the current credits through the existing public-safe projection, primary first, with no private Partner fields', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_DRAFT_ROW, error: null }, PUBLISH_UPDATE_OK],
      event_credits: [{ data: [ADDITIONAL_CREDIT_ROW, PRIMARY_CREDIT_ROW], error: null }],
    });

    const { POST } = await loadPublishRoute();
    const res = await POST(makePublishRequest({ visibility: 'public' }), routeParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.publishedCredits).toEqual([
      {
        businessName: 'Primary Studio',
        roleLabel: 'photographer',
        isPrimary: true,
        logoUrl: 'https://cdn.example.com/logo.png',
        websiteUrl: 'https://primary.example.com',
        instagramUrl: 'https://instagram.com/primary',
        facebookUrl: null,
        youtubeUrl: null,
      },
      {
        businessName: 'Additional Venue',
        roleLabel: 'venue',
        isPrimary: false,
        logoUrl: null,
        websiteUrl: null,
        instagramUrl: null,
        facebookUrl: null,
        youtubeUrl: null,
      },
    ]);

    const writeBuilder = publishWriteBuilder();
    const written = writeBuilder.update.mock.calls[0][0] as { published_credits: Record<string, unknown>[] };
    expect(written.published_credits[0].isPrimary).toBe(true);
    for (const credit of written.published_credits) {
      expect(Object.keys(credit).sort()).toEqual(PUBLIC_CREDIT_KEYS);
    }
    const serialized = JSON.stringify(written.published_credits);
    expect(serialized).not.toMatch(/Private Person|90000|Hyderabad|Pays late/);
  });

  it('publishes a no-credit event with an empty snapshot rather than null', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_DRAFT_ROW, error: null }, PUBLISH_UPDATE_OK],
      event_credits: [{ data: [], error: null }],
    });

    const { POST } = await loadPublishRoute();
    const res = await POST(makePublishRequest({ visibility: 'public' }), routeParams);

    expect(res.status).toBe(200);
    expect((await res.json()).publishedCredits).toEqual([]);
    expect(publishWriteBuilder().update).toHaveBeenCalledWith({
      published_credits: [],
      page_state: 'published',
      event_visibility: 'public',
    });
  });

  it('ignores any client-supplied snapshot in the request body', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_DRAFT_ROW, error: null }, PUBLISH_UPDATE_OK],
      event_credits: [{ data: [PRIMARY_CREDIT_ROW], error: null }],
    });

    const { POST } = await loadPublishRoute();
    const res = await POST(
      makePublishRequest({
        visibility: 'public',
        published_credits: [{ businessName: 'Injected Studio', isPrimary: true }],
        publishedCredits: [{ businessName: 'Injected Studio', isPrimary: true }],
        page_state: 'published',
        studioId: 'studio-b',
        event_visibility: 'private',
      }),
      routeParams
    );

    expect(res.status).toBe(200);
    const written = publishWriteBuilder().update.mock.calls[0][0] as {
      published_credits: { businessName: string }[];
    };
    expect(written.published_credits).toHaveLength(1);
    expect(written.published_credits[0].businessName).toBe('Primary Studio');
    expect(JSON.stringify(written)).not.toContain('Injected Studio');
  });
});

describe('POST /api/events/[eventId]/publish — atomic transition', () => {
  it('writes the snapshot, page_state = published, and the chosen event_visibility in the same single event-row update', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_DRAFT_ROW, error: null }, PUBLISH_UPDATE_OK],
      event_credits: [{ data: [PRIMARY_CREDIT_ROW], error: null }],
    });

    const { POST } = await loadPublishRoute();
    const res = await POST(makePublishRequest({ visibility: 'unlisted' }), routeParams);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      id: 'event-1',
      pageState: 'published',
      visibility: 'unlisted',
    });

    const writeBuilder = publishWriteBuilder();
    expect(writeBuilder.update).toHaveBeenCalledTimes(1);
    const written = writeBuilder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(['event_visibility', 'page_state', 'published_credits']);
    expect(written.page_state).toBe('published');
    expect(written.event_visibility).toBe('unlisted');
    // Exactly three `.from()` calls total: ownership read, credit read, and
    // the one combined write — no separate freeze-then-transition pair.
    expect(mockDb.from).toHaveBeenCalledTimes(3);
  });

  it('rejects publishing without an explicit visibility choice, before any credit read or write', async () => {
    mockDb.from = createFromMock({ events: [{ data: OWNED_DRAFT_ROW, error: null }] });

    const { POST } = await loadPublishRoute();
    const res = await POST(makePublishRequest({}), routeParams);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.field).toBe('visibility');
    expect(mockDb.from).toHaveBeenCalledTimes(1);
    expect(mockDb.from).not.toHaveBeenCalledWith('event_credits');
  });

  it('rejects a non-canonical visibility value (e.g. legacy private/synthetic), before any credit read or write', async () => {
    for (const invalid of ['private', 'synthetic', 'PUBLIC', '']) {
      mockDb.from = createFromMock({ events: [{ data: OWNED_DRAFT_ROW, error: null }] });

      const { POST } = await loadPublishRoute();
      const res = await POST(makePublishRequest({ visibility: invalid }), routeParams);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.field).toBe('visibility');
      expect(mockDb.from).toHaveBeenCalledTimes(1);
      expect(mockDb.from).not.toHaveBeenCalledWith('event_credits');
    }
  });

  it('scopes the mutation by event id, studio ownership, and the expected Draft state', async () => {
    mockDb.from = createFromMock({
      events: [{ data: OWNED_DRAFT_ROW, error: null }, PUBLISH_UPDATE_OK],
      event_credits: [{ data: [PRIMARY_CREDIT_ROW], error: null }],
    });

    const { POST } = await loadPublishRoute();
    await POST(makePublishRequest({ visibility: 'public' }), routeParams);

    const writeBuilder = publishWriteBuilder();
    expect(writeBuilder.eq).toHaveBeenNthCalledWith(1, 'id', 'event-1');
    expect(writeBuilder.eq).toHaveBeenNthCalledWith(2, 'studio_id', 'studio-a');
    expect(writeBuilder.eq).toHaveBeenNthCalledWith(3, 'page_state', 'draft');
  });

  it('surfaces a database update failure instead of reporting a successful publish', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: OWNED_DRAFT_ROW, error: null },
        { data: null, error: { message: 'connection reset' } },
      ],
      event_credits: [{ data: [PRIMARY_CREDIT_ROW], error: null }],
    });

    const { POST } = await loadPublishRoute();
    const res = await POST(makePublishRequest({ visibility: 'public' }), routeParams);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/Publish failed/);
    expect(body.pageState).toBeUndefined();
  });

  it('reports a lost concurrent-publish race as a conflict instead of overwriting the already-transitioned row', async () => {
    // The Draft-scoped update matched no row: another request published this
    // event between the ownership read and this write.
    mockDb.from = createFromMock({
      events: [{ data: OWNED_DRAFT_ROW, error: null }, { data: null, error: null }],
      event_credits: [{ data: [PRIMARY_CREDIT_ROW], error: null }],
    });

    const { POST } = await loadPublishRoute();
    const res = await POST(makePublishRequest({ visibility: 'public' }), routeParams);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, error: 'Only Draft events can be published.' });
    // The losing request still filtered on `page_state = 'draft'`, so its
    // update could not have touched the winning row.
    expect(publishWriteBuilder().eq).toHaveBeenNthCalledWith(3, 'page_state', 'draft');
  });
});
