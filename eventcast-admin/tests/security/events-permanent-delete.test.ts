import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFromMock, authSuccess, type MockQueryBuilder, type AuthSuccess } from './support/mocks';
import type { StudioMemberRole } from '@/lib/auth';

type PermDeleteAuth = AuthSuccess & { studioMemberRole: StudioMemberRole };
function pdAuth(overrides: Partial<PermDeleteAuth> = {}): PermDeleteAuth {
  return { ...authSuccess(), studioMemberRole: 'owner', ...overrides };
}

const { mockDb, mockRequireAdmin, defaultFrom, mockDeleteFromR2, mockR2KeyFromPublicUrl } = vi.hoisted(() => {
  const defaultFrom = vi.fn((table: string): MockQueryBuilder => {
    throw new Error(`mockDb.from not configured for table '${table}' in this test`);
  });
  return {
    mockDb: { from: defaultFrom },
    mockRequireAdmin: vi.fn(async () => ({} as PermDeleteAuth | NextResponse)),
    defaultFrom,
    mockDeleteFromR2: vi.fn(async (_r2Key: string) => {}),
    mockR2KeyFromPublicUrl: vi.fn((_url: string | null | undefined): string | null => null),
  };
});

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, requireAdmin: mockRequireAdmin };
});
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));
vi.mock('@/lib/r2Delete', () => ({ deleteFromR2: mockDeleteFromR2, r2KeyFromPublicUrl: mockR2KeyFromPublicUrl }));

async function loadRoute() {
  const mod = await import('@/app/api/events/[eventId]/permanent-delete/route');
  return mod.POST;
}

function makeRequest(body: unknown): Request {
  return new Request('http://test.local/api/events/evt-1/permanent-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const routeParams = { params: Promise.resolve({ eventId: 'evt-1' }) };

/** A full row satisfying both the route's ownership select and the function's own internal select — mock data ignores unrequested columns. */
function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    studio_id: 'studio-a',
    slug: 'evt-1-slug',
    page_state: 'draft',
    archived_at: '2026-08-01T00:00:00Z',
    thumbnail_url: null,
    invitation_video_url: null,
    gallery_urls: null,
    ...overrides,
  };
}

/** Finds the `.from(table)` call whose returned builder actually had `.delete()` invoked on it — robust regardless of how many non-delete calls to the same table preceded it. */
function findDeleteCallResult(table: string): MockQueryBuilder {
  const matches = mockDb.from.mock.calls
    .map((call, i) => ({ table: call[0], result: mockDb.from.mock.results[i]?.value as MockQueryBuilder | undefined }))
    .filter((entry) => entry.table === table && entry.result?.delete.mock.calls.length);
  if (matches.length === 0) throw new Error(`No delete() call found for table '${table}'`);
  return matches[matches.length - 1].result!;
}

/** Finds the first `.from(table)` call's builder — for tables called at most once (e.g. platform_audit_log). */
function findFromCallResult(table: string): MockQueryBuilder {
  const idx = mockDb.from.mock.calls.findIndex((call) => call[0] === table);
  if (idx === -1) throw new Error(`from('${table}') was never called`);
  return mockDb.from.mock.results[idx].value as MockQueryBuilder;
}

/** Full guard-chain queue for a ROUTE-level test: route's own ownership fetch, then the function's own fetch, then the final delete. */
function configureFullChain(opts: {
  row?: Record<string, unknown>;
  assignment?: { data: unknown; error: unknown };
  recording?: { data: unknown; error: unknown };
  guestPhotos?: { data: unknown; error: unknown };
  deleteResult?: { data: unknown; error: unknown };
  audit?: { data: unknown; error: unknown };
} = {}) {
  const row = baseRow(opts.row);
  mockDb.from = createFromMock({
    events: [
      { data: row, error: null }, // route's getOwnedEventById
      { data: row, error: null }, // function's own fetch
      opts.deleteResult ?? { data: [{ id: 'evt-1' }], error: null }, // final delete
    ],
    media_event_assignments: [opts.assignment ?? { data: { enabled: false }, error: null }],
    event_recordings: [opts.recording ?? { data: null, error: null }],
    guest_photos: [opts.guestPhotos ?? { data: [], error: null }],
    platform_audit_log: [opts.audit ?? { data: { id: 'audit-1' }, error: null }],
  });
}

/** Same guard-chain shape but for calling permanentlyDeleteEvent() DIRECTLY (no route-level ownership fetch precedes it). */
function configureFunctionChain(opts: {
  row?: Record<string, unknown>;
  assignment?: { data: unknown; error: unknown };
  recording?: { data: unknown; error: unknown };
  guestPhotos?: { data: unknown; error: unknown };
  deleteResult?: { data: unknown; error: unknown };
} = {}) {
  const row = baseRow(opts.row);
  mockDb.from = createFromMock({
    events: [
      { data: row, error: null }, // function's own fetch
      opts.deleteResult ?? { data: [{ id: 'evt-1' }], error: null }, // final delete
    ],
    media_event_assignments: [opts.assignment ?? { data: { enabled: false }, error: null }],
    event_recordings: [opts.recording ?? { data: null, error: null }],
    guest_photos: [opts.guestPhotos ?? { data: [], error: null }],
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockDb.from = defaultFrom;
  defaultFrom.mockClear();
  mockRequireAdmin.mockResolvedValue(pdAuth());
  mockR2KeyFromPublicUrl.mockReturnValue(null);
  delete process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
});

// ─── Route: authorization ───────────────────────────────────────────────────

describe('POST /api/events/[eventId]/permanent-delete — authorization', () => {
  it('rejects an unauthenticated request', async () => {
    mockRequireAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));

    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects a member-role studio user before any mutation', async () => {
    mockRequireAdmin.mockResolvedValue(pdAuth({ studioMemberRole: 'member' }));

    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);

    expect(res.status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('allows an owner to permanently delete', async () => {
    configureFullChain();
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('allows an admin to permanently delete', async () => {
    mockRequireAdmin.mockResolvedValue(pdAuth({ studioMemberRole: 'admin' }));
    configureFullChain();
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });
});

describe('POST /api/events/[eventId]/permanent-delete — ownership and confirmation', () => {
  it('rejects a cross-tenant or nonexistent event before any mutation', async () => {
    mockDb.from = createFromMock({ events: [{ data: null, error: null }] });

    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);

    expect(res.status).toBe(404);
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('rejects a confirmSlug that does not exactly match the event slug', async () => {
    configureFullChain();
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'wrong-slug' }), routeParams);

    expect(res.status).toBe(400);
    // Only the route's own ownership fetch happened — permanentlyDeleteEvent()
    // was never invoked.
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });
});

// ─── Route + real permanentlyDeleteEvent(): safety guards ─────────────────

describe('POST /api/events/[eventId]/permanent-delete — safety guards', () => {
  it('blocks a non-archived event', async () => {
    configureFullChain({ row: { archived_at: null } });
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('not_archived');
  });

  it('blocks when a livestream assignment is enabled', async () => {
    configureFullChain({ assignment: { data: { enabled: true }, error: null } });
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('live_assignment_enabled');
  });

  it('fails closed when the assignment lookup errors', async () => {
    configureFullChain({ assignment: { data: null, error: { message: 'db down' } } });
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('assignment_check_failed');
    // event_recordings/guest_photos/final delete must never have been reached.
    expect(mockDb.from).not.toHaveBeenCalledWith('event_recordings');
    expect(mockDb.from).not.toHaveBeenCalledWith('guest_photos');
  });

  it('fails closed when the recording lookup errors', async () => {
    configureFullChain({ recording: { data: null, error: { message: 'db down' } } });
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('recording_check_failed');
    expect(mockDb.from).not.toHaveBeenCalledWith('guest_photos');
  });

  it("blocks recording_state='recording'", async () => {
    configureFullChain({ recording: { data: { recording_state: 'recording', b2_object_key: null, retention_frozen_at: null, retention_expires_at: null }, error: null } });
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('recording_in_progress');
  });

  it("blocks recording_state='b2_finalizing'", async () => {
    configureFullChain({ recording: { data: { recording_state: 'b2_finalizing', b2_object_key: null, retention_frozen_at: null, retention_expires_at: null }, error: null } });
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('recording_in_progress');
  });

  it('blocks an unexpired retention window', async () => {
    configureFullChain({
      recording: {
        data: {
          recording_state: 'b2_finalized',
          b2_object_key: 'b2/archive/evt-1.mp4',
          retention_frozen_at: '2026-01-01T00:00:00Z',
          retention_expires_at: '2099-01-01T00:00:00Z',
        },
        error: null,
      },
    });
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('retention_not_expired');
  });

  it('fails closed when the guest-photo snapshot query errors', async () => {
    configureFullChain({ guestPhotos: { data: null, error: { message: 'db down' } } });
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('snapshot_failed');
    // Final delete must never have been attempted.
    expect(() => findDeleteCallResult('events')).toThrow();
  });
});

// ─── Route + real permanentlyDeleteEvent(): delete confirmation & cleanup ──

describe('POST /api/events/[eventId]/permanent-delete — delete confirmation and cleanup ordering', () => {
  it('scopes the successful delete by exactly the verified event id and studio id', async () => {
    configureFullChain();
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);
    expect(res.status).toBe(200);

    const deleteBuilder = findDeleteCallResult('events');
    expect(deleteBuilder.eq.mock.calls).toEqual([
      ['id', 'evt-1'],
      ['studio_id', 'studio-a'],
    ]);
  });

  it('maps a zero-row (race) delete result to 409, with no audit or external cleanup', async () => {
    configureFullChain({ deleteResult: { data: [], error: null } });
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);

    expect(res.status).toBe(409);
    expect(mockDeleteFromR2).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    // platform_audit_log was configured but must never have been reached.
    expect(mockDb.from).not.toHaveBeenCalledWith('platform_audit_log');
  });

  it('a database delete error surfaces as a failure with no R2/Cloudinary cleanup', async () => {
    configureFullChain({ deleteResult: { data: null, error: { message: 'db down' } } });
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);

    expect(res.status).toBe(500);
    expect(mockDeleteFromR2).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a confirmed one-row delete runs guest-photo R2 cleanup', async () => {
    configureFullChain({
      guestPhotos: { data: [{ id: 'gp-1', r2_key: 'studios/studio-a/guest-photos/x.jpg' }], error: null },
    });
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);

    expect(res.status).toBe(200);
    expect(mockDeleteFromR2).toHaveBeenCalledWith('studios/studio-a/guest-photos/x.jpg');
  });

  it('never passes the B2 object key to any delete helper', async () => {
    const b2Key = 'b2/archive/DO-NOT-DELETE.mp4';
    configureFullChain({
      recording: {
        data: {
          recording_state: 'b2_finalized',
          b2_object_key: b2Key,
          retention_frozen_at: '2020-01-01T00:00:00Z',
          retention_expires_at: '2020-02-01T00:00:00Z', // already expired — not blocked
        },
        error: null,
      },
      guestPhotos: { data: [{ id: 'gp-1', r2_key: 'studios/studio-a/guest-photos/x.jpg' }], error: null },
    });
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);

    expect(res.status).toBe(200);
    for (const call of mockDeleteFromR2.mock.calls) {
      expect(call[0]).not.toBe(b2Key);
    }
    for (const call of (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls) {
      expect(String(call[0])).not.toContain(b2Key);
    }
  });

  it('does not send an unrecognized external media URL to Cloudinary', async () => {
    configureFullChain({ row: { thumbnail_url: 'https://random-cdn.example/img.jpg' } });
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);

    expect(res.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.warnings.join(' ')).toMatch(/unrecognized external media URL/i);
  });

  it('cleans up positively-identified Cloudinary image and video URLs under their correct resource type', async () => {
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = 'ec-cloud';
    configureFullChain({
      row: {
        thumbnail_url: 'https://res.cloudinary.com/ec-cloud/image/upload/v1/thumb.jpg',
        invitation_video_url: 'https://res.cloudinary.com/ec-cloud/video/upload/v1/vid.mp4',
      },
    });

    const calledUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        calledUrls.push(String(input));
        return { ok: true, text: async () => '' } as unknown as Response;
      })
    );

    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);

    expect(res.status).toBe(200);
    expect(calledUrls.some((u) => u.includes('/image/destroy'))).toBe(true);
    expect(calledUrls.some((u) => u.includes('/video/destroy'))).toBe(true);
  });

  it('treats an audit-log write failure after a successful delete as a non-fatal warning', async () => {
    configureFullChain({ audit: { data: null, error: { message: 'audit table unavailable' } } });
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.warnings.join(' ')).toMatch(/audit log write failed/i);
  });

  it("writes the actor's real platformRole to the audit log, never studioMemberRole", async () => {
    mockRequireAdmin.mockResolvedValue(pdAuth({ studioMemberRole: 'owner', platformRole: 'reseller' }));
    configureFullChain();
    const POST = await loadRoute();
    const res = await POST(makeRequest({ confirmSlug: 'evt-1-slug' }), routeParams);

    expect(res.status).toBe(200);
    const auditBuilder = findFromCallResult('platform_audit_log');
    expect(auditBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ actor_platform_role: 'reseller' })
    );
    // The tenant mutation role must never leak into the platform-role field.
    const insertedPayload = auditBuilder.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedPayload.actor_platform_role).not.toBe('owner');
  });
});

// ─── permanentlyDeleteEvent(): cron actor eligibility / race safety ───────

describe('permanentlyDeleteEvent() — cron eligibility and race safety', () => {
  it('skips a cron delete for a non-Draft row', async () => {
    const { permanentlyDeleteEvent } = await import('@/lib/eventPermanentDelete');
    mockDb.from = createFromMock({ events: [{ data: baseRow({ page_state: 'published' }), error: null }] });

    const result = await permanentlyDeleteEvent('evt-1', 'studio-a', {
      type: 'cron',
      requireDraft: true,
      archivedBefore: '2099-01-01T00:00:00Z',
    });

    expect(result.status).toBe('skipped');
    expect(mockDb.from).toHaveBeenCalledTimes(1);
  });

  it('skips a cron delete when archived_at is newer than the cutoff', async () => {
    const { permanentlyDeleteEvent } = await import('@/lib/eventPermanentDelete');
    mockDb.from = createFromMock({
      events: [{ data: baseRow({ archived_at: '2026-09-01T00:00:00Z' }), error: null }],
    });

    const result = await permanentlyDeleteEvent('evt-1', 'studio-a', {
      type: 'cron',
      requireDraft: true,
      archivedBefore: '2026-08-01T00:00:00Z',
    });

    expect(result.status).toBe('skipped');
  });

  it('skips a cron delete when archived_at exactly equals the cutoff (strict less-than)', async () => {
    const { permanentlyDeleteEvent } = await import('@/lib/eventPermanentDelete');
    const t = '2026-08-01T00:00:00Z';
    mockDb.from = createFromMock({ events: [{ data: baseRow({ archived_at: t }), error: null }] });

    const result = await permanentlyDeleteEvent('evt-1', 'studio-a', {
      type: 'cron',
      requireDraft: true,
      archivedBefore: t,
    });

    expect(result.status).toBe('skipped');
  });

  it('a cron delete matching zero rows is skipped, with no audit or external cleanup', async () => {
    const { permanentlyDeleteEvent } = await import('@/lib/eventPermanentDelete');
    configureFunctionChain({ deleteResult: { data: [], error: null } });

    const result = await permanentlyDeleteEvent('evt-1', 'studio-a', {
      type: 'cron',
      requireDraft: true,
      archivedBefore: '2099-01-01T00:00:00Z',
    });

    expect(result.status).toBe('skipped');
    expect(mockDeleteFromR2).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    // platform_audit_log was never even configured for this chain — reaching
    // it would throw, proving the cron path never attempts that insert.
  });

  it("a cron delete re-asserts page_state='draft' AND archived_at IS NOT NULL AND archived_at < cutoff on the DELETE itself", async () => {
    const { permanentlyDeleteEvent } = await import('@/lib/eventPermanentDelete');
    configureFunctionChain();
    const cutoff = '2099-01-01T00:00:00Z';

    await permanentlyDeleteEvent('evt-1', 'studio-a', { type: 'cron', requireDraft: true, archivedBefore: cutoff });

    const deleteBuilder = findDeleteCallResult('events');
    expect(deleteBuilder.eq.mock.calls).toEqual(
      expect.arrayContaining([
        ['id', 'evt-1'],
        ['studio_id', 'studio-a'],
        ['page_state', 'draft'],
      ])
    );
    expect(deleteBuilder.not.mock.calls).toEqual([['archived_at', 'is', null]]);
    expect(deleteBuilder.lt.mock.calls).toEqual([['archived_at', cutoff]]);
  });
});
