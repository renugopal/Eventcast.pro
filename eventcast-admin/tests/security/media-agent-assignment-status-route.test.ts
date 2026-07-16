import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const PROVISIONING_SECRET = 'unit-test-provisioning-secret';
const EVENT_ID = 'event-uuid-1';

interface FakeResult {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}

function makeFakeDb(config: { select?: FakeResult[] }) {
  const queue = [...(config.select ?? [])];
  const eqCalls: unknown[][] = [];

  const from = vi.fn((_table: string) => ({
    select: (_columns: string) => ({
      eq: (...args: unknown[]) => {
        eqCalls.push(args);
        return {
          maybeSingle: async () => {
            const result = queue.shift();
            if (!result) throw new Error('FakeDb: no more select() results queued');
            return result;
          },
        };
      },
    }),
  }));

  return { from, eqCalls };
}

function draftRow(): FakeResult {
  return {
    data: {
      event_id: EVENT_ID,
      ingest_id: null,
      playback_id: null,
      enabled: false,
      publish_window_start_at: null,
      publish_window_end_at: null,
      config_version: 1,
      updated_at: '2026-01-01T00:00:00Z',
      youtube_enabled: false,
    },
    error: null,
  };
}

function activatedRow(): FakeResult {
  return {
    data: {
      event_id: EVENT_ID,
      ingest_id: 'a'.repeat(64),
      playback_id: 'b'.repeat(64),
      enabled: true,
      publish_window_start_at: '2026-01-01T00:00:00Z',
      publish_window_end_at: '2026-01-02T00:00:00Z',
      config_version: 2,
      updated_at: '2026-01-01T00:00:00Z',
      youtube_enabled: false,
    },
    error: null,
  };
}

interface FakeTableApi {
  select: (columns: string) => unknown;
}

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    from: vi.fn((table: string): FakeTableApi => {
      throw new Error(`mockDb.from not configured for table '${table}' in this test`);
    }),
  },
}));

vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.MEDIA_NODE_PROVISIONING_SECRET = PROVISIONING_SECRET;
});

function authedRequest(secret: string | null = PROVISIONING_SECRET): Request {
  const headers = new Headers();
  if (secret !== null) headers.set('authorization', `Bearer ${secret}`);
  return new Request(`http://test.local/internal/media/assignments/${EVENT_ID}/status`, {
    method: 'GET',
    headers,
  });
}

async function loadRoute() {
  const mod = await import('@/app/internal/media/assignments/[event_id]/status/route');
  return mod.GET;
}

function params() {
  return Promise.resolve({ event_id: EVENT_ID });
}

describe('GET /internal/media/assignments/{event_id}/status', () => {
  it('returns 200 with playback_id and safe state for an activated assignment', async () => {
    mockDb.from = makeFakeDb({ select: [activatedRow()] }).from;

    const GET = await loadRoute();
    const res = await GET(authedRequest(), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.eventId).toBe(EVENT_ID);
    expect(body.playbackId).toBe('b'.repeat(64));
    expect(body.ingestId).toBe('a'.repeat(64));
    expect(body.enabled).toBe(true);
  });

  it('returns 200 for a not-yet-activated draft, with empty-string placeholders rather than null', async () => {
    mockDb.from = makeFakeDb({ select: [draftRow()] }).from;

    const GET = await loadRoute();
    const res = await GET(authedRequest(), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.enabled).toBe(false);
    expect(body.playbackId).toBe('');
    expect(body.ingestId).toBe('');
  });

  it('returns 404 no_assignment when no draft or activated row exists for the event', async () => {
    mockDb.from = makeFakeDb({ select: [{ data: null, error: null }] }).from;

    const GET = await loadRoute();
    const res = await GET(authedRequest(), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'no_assignment' });
  });

  it('never exposes stream_secret_hash, tokens, credentials, node ids, or internal URLs — allowlist-only response', async () => {
    mockDb.from = makeFakeDb({ select: [activatedRow()] }).from;

    const GET = await loadRoute();
    const res = await GET(authedRequest(), { params: params() });
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(
      [
        'configVersion',
        'enabled',
        'eventId',
        'ingestId',
        'playbackId',
        'publishWindowEndAt',
        'publishWindowStartAt',
        'updatedAt',
        'youtubeEnabled',
      ].sort()
    );
    for (const forbidden of [
      'streamSecretHash',
      'stream_secret_hash',
      'token',
      'digest',
      'nodeId',
      'assignedMediaNodeId',
      'youtubeStreamKey',
      'youtubeSecretReference',
      'youtubeDestinationBaseUrl',
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it('the underlying query never selects a secret-bearing column', async () => {
    const { from } = makeFakeDb({ select: [activatedRow()] });
    mockDb.from = vi.fn((table: string) => {
      const api = from(table);
      const originalSelect = (api as { select: (columns: string) => unknown }).select;
      return {
        ...api,
        select: (columns: string) => {
          expect(columns).not.toMatch(/stream_secret_hash|youtube_secret_reference|youtube_destination_base_url/);
          return originalSelect(columns);
        },
      };
    });

    const GET = await loadRoute();
    await GET(authedRequest(), { params: params() });
  });

  it('returns 500 internal_error on a generic database failure, without leaking the message', async () => {
    mockDb.from = makeFakeDb({ select: [{ data: null, error: { message: 'connection reset to 10.0.0.5' } }] }).from;

    const GET = await loadRoute();
    const res = await GET(authedRequest(), { params: params() });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(body)).not.toContain('connection reset to 10.0.0.5');
  });

  describe('operator-secret gating (fail-closed, timing-safe)', () => {
    it('fails closed (401) when MEDIA_NODE_PROVISIONING_SECRET is unset, without touching the database', async () => {
      delete process.env.MEDIA_NODE_PROVISIONING_SECRET;
      const GET = await loadRoute();
      const res = await GET(authedRequest(), { params: params() });

      expect(res.status).toBe(401);
      expect(mockDb.from).not.toHaveBeenCalled();
    });

    it('fails closed (401) when no Authorization header is present', async () => {
      const GET = await loadRoute();
      const res = await GET(authedRequest(null), { params: params() });

      expect(res.status).toBe(401);
      expect(mockDb.from).not.toHaveBeenCalled();
    });

    it('fails closed (401) for an incorrect secret of the same length as the real one', async () => {
      const sameLengthWrong =
        PROVISIONING_SECRET.slice(0, -1) + (PROVISIONING_SECRET.at(-1) === 'x' ? 'y' : 'x');
      const GET = await loadRoute();
      const res = await GET(authedRequest(sameLengthWrong), { params: params() });

      expect(res.status).toBe(401);
      expect(mockDb.from).not.toHaveBeenCalled();
    });

    it('fails closed (401) for an incorrect secret of a different length than the real one', async () => {
      const GET = await loadRoute();
      const res = await GET(authedRequest(PROVISIONING_SECRET + '-extra'), { params: params() });

      expect(res.status).toBe(401);
      expect(mockDb.from).not.toHaveBeenCalled();
    });

    it('fails closed (401) on a malformed Authorization header (wrong scheme)', async () => {
      const headers = new Headers({ authorization: `Basic ${PROVISIONING_SECRET}` });
      const req = new Request(`http://test.local/internal/media/assignments/${EVENT_ID}/status`, {
        method: 'GET',
        headers,
      });

      const GET = await loadRoute();
      const res = await GET(req, { params: params() });

      expect(res.status).toBe(401);
      expect(mockDb.from).not.toHaveBeenCalled();
    });

    it('succeeds with the correct secret', async () => {
      mockDb.from = makeFakeDb({ select: [activatedRow()] }).from;

      const GET = await loadRoute();
      const res = await GET(authedRequest(), { params: params() });

      expect(res.status).not.toBe(401);
    });
  });
});

describe('Middleware — assignment-status studio-JWT bypass', () => {
  async function loadMiddleware() {
    const mod = await import('@/middleware');
    return mod.middleware;
  }

  it('bypasses studio-JWT auth for the exact status path', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local/internal/media/assignments/${EVENT_ID}/status`);
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it('bypasses with an optional trailing slash', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local/internal/media/assignments/${EVENT_ID}/status/`);
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it.each([
    `/internal/media/assignments/${EVENT_ID}/status/extra`,
    `/internal/media/assignments/${EVENT_ID}status`,
  ])('does NOT bypass near-miss path %s — falls through to normal studio-JWT auth', async (p) => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local${p}`);
    const res = await middleware(req);

    expect(res.status).toBe(401);
  });

  it('does not bypass the sibling activate path (unaffected by this change)', async () => {
    const middleware = await loadMiddleware();
    const req = new NextRequest(`http://test.local/internal/media/assignments/${EVENT_ID}/activate`);
    expect((await middleware(req)).status).toBe(200);
  });
});
