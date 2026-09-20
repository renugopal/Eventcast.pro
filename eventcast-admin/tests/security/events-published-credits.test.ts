import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createFromMock, authSuccess, type MockQueryBuilder, type AuthResult, type AuthSuccess } from './support/mocks';
import type { StudioMemberRole } from '@/lib/auth';

// Owner/admin-only mutation gate — same local-extension pattern as every
// other event-mutation test file (events-publish.test.ts, events-details.test.ts).
type PcAuth = AuthSuccess & { studioMemberRole: StudioMemberRole };
function pcAuth(overrides: Partial<PcAuth> = {}): PcAuth {
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
  const mod = await import('@/app/api/events/[eventId]/published-credits/route');
  return { GET: mod.GET, POST: mod.POST };
}

function postRequest(body?: unknown): Request {
  return new Request('http://test.local/api/events/event-1/published-credits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function getRequest(): Request {
  return new Request('http://test.local/api/events/event-1/published-credits', { method: 'GET' });
}

const routeParams = { params: Promise.resolve({ eventId: 'event-1' }) };

// The join row shape `loadOwnedEventCreditsWithPartners` maps. Private
// Partner keys are deliberately present so the test proves the projection
// keeps them out of the written snapshot.
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

const PROJECTED_PRIMARY = {
  businessName: 'Primary Studio',
  roleLabel: 'photographer',
  isPrimary: true,
  logoUrl: 'https://cdn.example.com/logo.png',
  websiteUrl: 'https://primary.example.com',
  instagramUrl: 'https://instagram.com/primary',
  facebookUrl: null,
  youtubeUrl: null,
};

const PROJECTED_ADDITIONAL = {
  businessName: 'Additional Venue',
  roleLabel: 'venue',
  isPrimary: false,
  logoUrl: null,
  websiteUrl: null,
  instagramUrl: null,
  facebookUrl: null,
  youtubeUrl: null,
};

const PUBLISHED_ROW = {
  id: 'event-1',
  page_state: 'published',
  archived_at: null,
  // Stale snapshot: only the primary credit was frozen at Publish time.
  published_credits: [PROJECTED_PRIMARY],
};

const UPDATE_OK = { data: { id: 'event-1' }, error: null };

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

/** The `.from('events')` builder used for the write (the second `events` call). */
function writeBuilder(): MockQueryBuilder {
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
  mockRequireAdmin.mockResolvedValue(pcAuth());
});

describe('POST /api/events/[eventId]/published-credits — access control', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));

    const { POST } = await loadRoute();
    const res = await POST(postRequest(), routeParams);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a member-role studio user before any database access', async () => {
    mockRequireAdmin.mockResolvedValue(pcAuth({ studioMemberRole: 'member' }));

    const { POST } = await loadRoute();
    const res = await POST(postRequest(), routeParams);

    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('allows the admin studio role', async () => {
    mockRequireAdmin.mockResolvedValue(pcAuth({ studioMemberRole: 'admin' }));
    mockDb.from = createFromMock({
      events: [{ data: PUBLISHED_ROW, error: null }, UPDATE_OK],
      event_credits: [{ data: [PRIMARY_CREDIT_ROW], error: null }],
    });

    const { POST } = await loadRoute();
    const res = await POST(postRequest(), routeParams);

    expect(res.status).toBe(200);
  });

  it('returns the generic non-enumerating 404 for a cross-tenant or nonexistent event, without reading credits or writing', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const { POST } = await loadRoute();
    const res = await POST(postRequest(), routeParams);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
    expect(mockDb.from).not.toHaveBeenCalledWith('event_credits');
  });

  it('scopes the ownership read to both the event id and the authenticated studio id', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const { POST } = await loadRoute();
    await POST(postRequest(), routeParams);

    const ownershipBuilder = mockDb.from.mock.results[0].value;
    expect(ownershipBuilder.eq).toHaveBeenNthCalledWith(1, 'id', 'event-1');
    expect(ownershipBuilder.eq).toHaveBeenNthCalledWith(2, 'studio_id', 'studio-a');
  });
});

describe('POST /api/events/[eventId]/published-credits — state gating', () => {
  it('refuses a Draft event (nothing frozen to update) without reading credits or writing', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { ...PUBLISHED_ROW, page_state: 'draft', published_credits: null }, error: null }],
    });

    const { POST } = await loadRoute();
    const res = await POST(postRequest(), routeParams);

    expect(res.status).toBe(409);
    expect((await res.json()).success).toBe(false);
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('refuses an archived event even when published, with a distinct "restore first" 409, without writing', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { ...PUBLISHED_ROW, archived_at: '2026-09-01T00:00:00+00:00' }, error: null }],
    });

    const { POST } = await loadRoute();
    const res = await POST(postRequest(), routeParams);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/archived/i);
    expect(body.error).toMatch(/restore/i);
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('archive takes precedence over the not-published check', async () => {
    mockDb.from = createFromMock({
      events: [
        { data: { ...PUBLISHED_ROW, page_state: 'draft', archived_at: '2026-09-01T00:00:00+00:00' }, error: null },
      ],
    });

    const { POST } = await loadRoute();
    const res = await POST(postRequest(), routeParams);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/archived/i);
  });
});

describe('POST /api/events/[eventId]/published-credits — snapshot derivation and write', () => {
  it('fails closed on a credit-read failure: no write is attempted', async () => {
    mockDb.from = createFromMock({
      events: [{ data: PUBLISHED_ROW, error: null }],
      event_credits: [{ data: null, error: { message: 'boom' } }],
    });

    const { POST } = await loadRoute();
    const res = await POST(postRequest(), routeParams);

    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
    // Exactly one `events` call (the ownership read) — no update.
    const eventsCalls = mockDb.from.mock.calls.filter((args) => args[0] === 'events');
    expect(eventsCalls).toHaveLength(1);
  });

  it('writes the server-derived, public-safe, primary-first projection of the CURRENT credits', async () => {
    mockDb.from = createFromMock({
      events: [{ data: PUBLISHED_ROW, error: null }, UPDATE_OK],
      // Returned additional-first to prove the projection reorders primary-first.
      event_credits: [{ data: [ADDITIONAL_CREDIT_ROW, PRIMARY_CREDIT_ROW], error: null }],
    });

    const { POST } = await loadRoute();
    const res = await POST(postRequest(), routeParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.creditCount).toBe(2);
    expect(body.publishedCredits).toEqual([PROJECTED_PRIMARY, PROJECTED_ADDITIONAL]);

    const builder = writeBuilder();
    expect(builder.update).toHaveBeenCalledTimes(1);
    const payload = builder.update.mock.calls[0][0] as Record<string, unknown>;
    // Exactly one column — page_state / visibility / anything else is never touched.
    expect(Object.keys(payload)).toEqual(['published_credits']);
    const written = payload.published_credits as Record<string, unknown>[];
    expect(written).toEqual([PROJECTED_PRIMARY, PROJECTED_ADDITIONAL]);
    for (const credit of written) {
      expect(Object.keys(credit).sort()).toEqual(PUBLIC_CREDIT_KEYS);
      expect(credit).not.toHaveProperty('contact_person');
      expect(credit).not.toHaveProperty('phone');
      expect(credit).not.toHaveProperty('whatsapp');
      expect(credit).not.toHaveProperty('city');
      expect(credit).not.toHaveProperty('internal_notes');
    }
  });

  it('scopes the guarded update by id, studio, page_state=published and archived_at IS NULL', async () => {
    mockDb.from = createFromMock({
      events: [{ data: PUBLISHED_ROW, error: null }, UPDATE_OK],
      event_credits: [{ data: [PRIMARY_CREDIT_ROW], error: null }],
    });

    const { POST } = await loadRoute();
    await POST(postRequest(), routeParams);

    const builder = writeBuilder();
    expect(builder.eq).toHaveBeenCalledWith('id', 'event-1');
    expect(builder.eq).toHaveBeenCalledWith('studio_id', 'studio-a');
    expect(builder.eq).toHaveBeenCalledWith('page_state', 'published');
    expect(builder.is).toHaveBeenCalledWith('archived_at', null);
  });

  it('refreshes a credit-less event to a valid empty [] snapshot (same no-credit semantics as Publish)', async () => {
    mockDb.from = createFromMock({
      events: [{ data: PUBLISHED_ROW, error: null }, UPDATE_OK],
      event_credits: [{ data: [], error: null }],
    });

    const { POST } = await loadRoute();
    const res = await POST(postRequest(), routeParams);

    expect(res.status).toBe(200);
    expect((await res.json()).creditCount).toBe(0);
    const payload = writeBuilder().update.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.published_credits).toEqual([]);
  });

  it('surfaces a database write failure as 500 and never reports success', async () => {
    mockDb.from = createFromMock({
      events: [{ data: PUBLISHED_ROW, error: null }, { data: null, error: { message: 'write failed' } }],
      event_credits: [{ data: [PRIMARY_CREDIT_ROW], error: null }],
    });

    const { POST } = await loadRoute();
    const res = await POST(postRequest(), routeParams);

    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });

  it('reports a conflict when the guarded update matches no row (event left the Published state concurrently)', async () => {
    mockDb.from = createFromMock({
      events: [{ data: PUBLISHED_ROW, error: null }, { data: null, error: null }],
      event_credits: [{ data: [PRIMARY_CREDIT_ROW], error: null }],
    });

    const { POST } = await loadRoute();
    const res = await POST(postRequest(), routeParams);

    expect(res.status).toBe(409);
    expect((await res.json()).success).toBe(false);
  });

  it('ignores any client-supplied snapshot: the written value is always server-derived', async () => {
    mockDb.from = createFromMock({
      events: [{ data: PUBLISHED_ROW, error: null }, UPDATE_OK],
      event_credits: [{ data: [PRIMARY_CREDIT_ROW], error: null }],
    });

    const injected = [{ businessName: 'Injected Co', roleLabel: 'photographer', isPrimary: true, phone: '123' }];
    const { POST } = await loadRoute();
    const res = await POST(
      postRequest({ publishedCredits: injected, published_credits: injected, page_state: 'draft', event_visibility: 'private' }),
      routeParams
    );

    expect(res.status).toBe(200);
    const payload = writeBuilder().update.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['published_credits']);
    expect(payload.published_credits).toEqual([PROJECTED_PRIMARY]);
    expect(JSON.stringify(payload)).not.toContain('Injected Co');
  });
});

describe('GET /api/events/[eventId]/published-credits — status', () => {
  it('rejects an unauthenticated request before touching the database', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 401 }));

    const { GET } = await loadRoute();
    const res = await GET(getRequest(), routeParams);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('is readable by a member-role studio user (read-only status, like other event GETs)', async () => {
    mockRequireAdmin.mockResolvedValue(pcAuth({ studioMemberRole: 'member' }));
    mockDb.from = createFromMock({
      events: [{ data: PUBLISHED_ROW, error: null }],
      event_credits: [{ data: [PRIMARY_CREDIT_ROW], error: null }],
    });

    const { GET } = await loadRoute();
    const res = await GET(getRequest(), routeParams);

    expect(res.status).toBe(200);
  });

  it('returns the generic 404 for a cross-tenant or nonexistent event', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const { GET } = await loadRoute();
    const res = await GET(getRequest(), routeParams);

    expect(res.status).toBe(404);
    expect(mockDb.from).not.toHaveBeenCalledWith('event_credits');
  });

  it('reports needsUpdate=true when the current credits differ from the frozen snapshot, and never writes', async () => {
    mockDb.from = createFromMock({
      events: [{ data: PUBLISHED_ROW, error: null }],
      event_credits: [{ data: [PRIMARY_CREDIT_ROW, ADDITIONAL_CREDIT_ROW], error: null }],
    });

    const { GET } = await loadRoute();
    const res = await GET(getRequest(), routeParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      pageState: 'published',
      archived: false,
      needsUpdate: true,
      frozenCount: 1,
      currentCount: 2,
    });
    expect(body.frozenCredits).toEqual([PROJECTED_PRIMARY]);
    expect(body.currentCredits).toEqual([PROJECTED_PRIMARY, PROJECTED_ADDITIONAL]);
    const eventsCalls = mockDb.from.mock.calls.filter((args) => args[0] === 'events');
    expect(eventsCalls).toHaveLength(1);
    expect(mockDb.from.mock.results[0].value.update).not.toHaveBeenCalled();
  });

  it('reports needsUpdate=false when the snapshot already matches the current credits', async () => {
    mockDb.from = createFromMock({
      events: [{ data: PUBLISHED_ROW, error: null }],
      event_credits: [{ data: [PRIMARY_CREDIT_ROW], error: null }],
    });

    const { GET } = await loadRoute();
    const res = await GET(getRequest(), routeParams);

    const body = await res.json();
    expect(body.needsUpdate).toBe(false);
    expect(body.frozenCount).toBe(1);
    expect(body.currentCount).toBe(1);
  });

  it('never reports needsUpdate for a Draft (nothing is frozen yet)', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { ...PUBLISHED_ROW, page_state: 'draft', published_credits: null }, error: null }],
      event_credits: [{ data: [PRIMARY_CREDIT_ROW], error: null }],
    });

    const { GET } = await loadRoute();
    const body = await (await GET(getRequest(), routeParams)).json();

    expect(body.needsUpdate).toBe(false);
    expect(body.frozenCredits).toBeNull();
    expect(body.frozenCount).toBeNull();
  });

  it('never reports needsUpdate for an archived event, and flags it as archived', async () => {
    mockDb.from = createFromMock({
      events: [{ data: { ...PUBLISHED_ROW, archived_at: '2026-09-01T00:00:00+00:00' }, error: null }],
      event_credits: [{ data: [PRIMARY_CREDIT_ROW, ADDITIONAL_CREDIT_ROW], error: null }],
    });

    const { GET } = await loadRoute();
    const body = await (await GET(getRequest(), routeParams)).json();

    expect(body.archived).toBe(true);
    expect(body.needsUpdate).toBe(false);
  });

  it('fails closed (500) on a credit-read failure instead of claiming the page is up to date', async () => {
    mockDb.from = createFromMock({
      events: [{ data: PUBLISHED_ROW, error: null }],
      event_credits: [{ data: null, error: { message: 'boom' } }],
    });

    const { GET } = await loadRoute();
    const res = await GET(getRequest(), routeParams);

    expect(res.status).toBe(500);
  });
});
