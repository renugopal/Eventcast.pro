import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFromMock, type MockQueryBuilder } from './support/mocks';

type Result = { data: unknown; error: unknown };

const { mockDb, defaultFrom, mockPermanentlyDeleteEvent } = vi.hoisted(() => {
  const defaultFrom = vi.fn((table: string): MockQueryBuilder => {
    throw new Error(`mockDb.from not configured for table '${table}' in this test`);
  });
  return {
    mockDb: { from: defaultFrom },
    defaultFrom,
    mockPermanentlyDeleteEvent: vi.fn(),
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));
vi.mock('@/lib/eventPermanentDelete', () => ({ permanentlyDeleteEvent: mockPermanentlyDeleteEvent }));

async function loadRoute() {
  const mod = await import('@/app/api/cron/event-lifecycle-sweep/route');
  return mod.GET;
}

function makeRequest(secret?: string): Request {
  const url = new URL('http://test.local/api/cron/event-lifecycle-sweep');
  if (secret !== undefined) url.searchParams.set('secret', secret);
  return new Request(url);
}

/**
 * Configures the 'events' table queue for one sweep run. Consumption order
 * exactly matches the route's own call order: the Sweep-1 candidate SELECT,
 * then one UPDATE per Sweep-1 candidate (in the order `archiveUpdates` is
 * given), then the Sweep-2 candidate SELECT. `permanentlyDeleteEvent()` is
 * fully mocked in this file, so none of ITS internal 'events' calls are
 * real — only the sweep route's own two SELECTs and any Sweep-1 UPDATEs
 * appear in this queue.
 */
function configureSweep(opts: {
  archiveSelect?: Result;
  archiveUpdates?: Result[];
  deleteSelect?: Result;
}) {
  const events: Result[] = [
    opts.archiveSelect ?? { data: [], error: null },
    ...(opts.archiveUpdates ?? []),
    opts.deleteSelect ?? { data: [], error: null },
  ];
  mockDb.from = createFromMock({ events });
}

const originalCronSecret = process.env.CRON_SECRET;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockDb.from = defaultFrom;
  defaultFrom.mockClear();
  // clearAllMocks() resets call history but not a previously-configured
  // mockResolvedValue/mockImplementation — reset it explicitly so no test's
  // permanentlyDeleteEvent() behavior can leak into the next one.
  mockPermanentlyDeleteEvent.mockReset();
  process.env.CRON_SECRET = 'test-secret';
});

afterEach(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
});

describe('GET /api/cron/event-lifecycle-sweep — authorization', () => {
  it('rejects a missing secret', async () => {
    const GET = await loadRoute();
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('rejects an incorrect secret', async () => {
    const GET = await loadRoute();
    const res = await GET(makeRequest('wrong-secret'));
    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/event-lifecycle-sweep — Sweep 1: 7-day Draft inactivity auto-archive', () => {
  it('auto-archives an inactive Draft candidate, re-applying the SAME cutoff on the UPDATE as the SELECT', async () => {
    configureSweep({
      archiveSelect: { data: [{ id: 'evt-1' }], error: null },
      archiveUpdates: [{ data: [{ id: 'evt-1' }], error: null }],
    });

    const GET = await loadRoute();
    const res = await GET(makeRequest('test-secret'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.autoArchive.results).toEqual([{ id: 'evt-1', status: 'archived' }]);

    const selectBuilder = mockDb.from.mock.results[0].value as MockQueryBuilder;
    expect(selectBuilder.eq.mock.calls).toEqual([['page_state', 'draft']]);
    expect(selectBuilder.is.mock.calls).toEqual([['archived_at', null]]);
    expect(selectBuilder.lt.mock.calls.length).toBe(1);
    expect(selectBuilder.lt.mock.calls[0][0]).toBe('draft_last_activity_at');
    const archiveCutoff = selectBuilder.lt.mock.calls[0][1];

    const updateBuilder = mockDb.from.mock.results[1].value as MockQueryBuilder;
    expect(updateBuilder.eq.mock.calls).toEqual(
      expect.arrayContaining([['id', 'evt-1'], ['page_state', 'draft']])
    );
    expect(updateBuilder.is.mock.calls).toEqual([['archived_at', null]]);
    // The UPDATE must re-apply the exact same cutoff the SELECT used to
    // pick this candidate — not merely id-scope it.
    expect(updateBuilder.lt.mock.calls).toEqual([['draft_last_activity_at', archiveCutoff]]);
  });

  it('does not archive a Draft edited within the 7-day window (excluded by the SELECT itself)', async () => {
    configureSweep({ archiveSelect: { data: [], error: null } });

    const GET = await loadRoute();
    const res = await GET(makeRequest('test-secret'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.autoArchive.processed).toBe(0);
    // No UPDATE call was made at all — the queue only had the select + the
    // (empty) sweep-2 select configured; consuming a third 'events' entry
    // would throw.
    expect(mockDb.from).toHaveBeenCalledTimes(2);
  });

  it('reports a race (zero-row UPDATE) as skipped, not archived or error', async () => {
    configureSweep({
      archiveSelect: { data: [{ id: 'evt-1' }], error: null },
      archiveUpdates: [{ data: [], error: null }],
    });

    const GET = await loadRoute();
    const res = await GET(makeRequest('test-secret'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.autoArchive.results).toEqual([{ id: 'evt-1', status: 'skipped' }]);
  });

  it('a Sweep-1 candidate-fetch error is reported as degraded, HTTP 500', async () => {
    configureSweep({ archiveSelect: { data: null, error: { message: 'db down' } } });

    const GET = await loadRoute();
    const res = await GET(makeRequest('test-secret'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.autoArchive.fetchError).toMatch(/db down/);
  });
});

describe('GET /api/cron/event-lifecycle-sweep — query scoping (page_state=draft only)', () => {
  it("both sweeps' candidate queries are scoped to page_state='draft'", async () => {
    configureSweep({
      archiveSelect: { data: [], error: null },
      deleteSelect: { data: [], error: null },
    });

    const GET = await loadRoute();
    await GET(makeRequest('test-secret'));

    const archiveSelectBuilder = mockDb.from.mock.results[0].value as MockQueryBuilder;
    const deleteSelectBuilder = mockDb.from.mock.results[1].value as MockQueryBuilder;
    expect(archiveSelectBuilder.eq.mock.calls).toContainEqual(['page_state', 'draft']);
    expect(deleteSelectBuilder.eq.mock.calls).toContainEqual(['page_state', 'draft']);
    // A Published/Live/Completed/VOD event can never appear in either
    // candidate set — it is structurally excluded by this exact filter,
    // regardless of its archived_at value.
    expect(deleteSelectBuilder.not.mock.calls).toEqual([['archived_at', 'is', null]]);
  });
});

describe('GET /api/cron/event-lifecycle-sweep — Sweep 2: 30-day Archived-Draft auto-permanent-delete', () => {
  it('calls the shared guarded permanentlyDeleteEvent() with the SAME cutoff the candidate query used', async () => {
    configureSweep({ deleteSelect: { data: [{ id: 'evt-1', studio_id: 'studio-a' }], error: null } });
    mockPermanentlyDeleteEvent.mockResolvedValue({ status: 'deleted', eventId: 'evt-1', warnings: [] });

    const GET = await loadRoute();
    const res = await GET(makeRequest('test-secret'));
    const body = await res.json();

    expect(res.status).toBe(200);

    // [0] is the Sweep-1 candidate SELECT (empty, default), [1] is the
    // Sweep-2 candidate SELECT — no Sweep-1 UPDATEs occur in this scenario.
    const deleteSelectBuilder = mockDb.from.mock.results[1].value as MockQueryBuilder;
    expect(deleteSelectBuilder.lt.mock.calls.length).toBe(1);
    expect(deleteSelectBuilder.lt.mock.calls[0][0]).toBe('archived_at');
    const deleteCutoff = deleteSelectBuilder.lt.mock.calls[0][1];

    expect(mockPermanentlyDeleteEvent).toHaveBeenCalledWith(
      'evt-1',
      'studio-a',
      { type: 'cron', requireDraft: true, archivedBefore: deleteCutoff }
    );
    expect(body.autoDelete.results).toEqual([
      expect.objectContaining({ id: 'evt-1', status: 'deleted' }),
    ]);
  });

  it('reports a skipped result (restored/re-archived/state-changed) safely, without failing the cron', async () => {
    configureSweep({ deleteSelect: { data: [{ id: 'evt-1', studio_id: 'studio-a' }], error: null } });
    mockPermanentlyDeleteEvent.mockResolvedValue({ status: 'skipped', message: 'no longer eligible' });

    const GET = await loadRoute();
    const res = await GET(makeRequest('test-secret'));
    const body = await res.json();

    expect(body.autoDelete.results).toEqual([{ id: 'evt-1', status: 'skipped', detail: 'no longer eligible' }]);
    expect(body.success).toBe(true);
    expect(res.status).toBe(200);
  });

  it('a blocked safety-guard result does not fail the cron', async () => {
    configureSweep({ deleteSelect: { data: [{ id: 'evt-1', studio_id: 'studio-a' }], error: null } });
    mockPermanentlyDeleteEvent.mockResolvedValue({
      status: 'blocked',
      reason: 'recording_in_progress',
      message: 'still recording',
    });

    const GET = await loadRoute();
    const res = await GET(makeRequest('test-secret'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.autoDelete.results).toEqual([{ id: 'evt-1', status: 'blocked', detail: 'recording_in_progress' }]);
  });

  it('a per-item error is reported and marks the whole run degraded (HTTP 500)', async () => {
    configureSweep({
      deleteSelect: {
        data: [
          { id: 'evt-1', studio_id: 'studio-a' },
          { id: 'evt-2', studio_id: 'studio-a' },
        ],
        error: null,
      },
    });
    mockPermanentlyDeleteEvent.mockImplementation(async (eventId: string) => {
      if (eventId === 'evt-1') throw new Error('unexpected failure');
      return { status: 'deleted', eventId, warnings: [] };
    });

    const GET = await loadRoute();
    const res = await GET(makeRequest('test-secret'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.autoDelete.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'evt-1', status: 'error' }),
        expect.objectContaining({ id: 'evt-2', status: 'deleted' }),
      ])
    );
  });

  it('a Sweep-2 candidate-fetch error is reported as degraded, HTTP 500, and never calls permanentlyDeleteEvent', async () => {
    configureSweep({
      archiveSelect: { data: [], error: null },
      deleteSelect: { data: null, error: { message: 'db down' } },
    });

    const GET = await loadRoute();
    const res = await GET(makeRequest('test-secret'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.autoDelete.fetchError).toMatch(/db down/);
    expect(mockPermanentlyDeleteEvent).not.toHaveBeenCalled();
  });
});
