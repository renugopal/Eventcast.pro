import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFromMock,
  authSuccess,
  type MockQueryBuilder,
} from './support/mocks';

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
  const mod = await import('@/app/api/events/delete/route');
  return mod.POST;
}

function makeRequest(body: unknown): Request {
  return new Request('http://test.local/api/events/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const originalGithubToken = process.env.GITHUB_TOKEN;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess());
});

afterEach(() => {
  if (originalGithubToken === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = originalGithubToken;
  }
});

describe('POST /api/events/delete — ownership', () => {
  it('rejects a cross-tenant or nonexistent event before soft delete, permanent delete, Cloudinary, or GitHub calls', async () => {
    mockDb.from = createFromMock({
      events: [{ data: null, error: null }],
    });

    const POST = await loadRoute();
    const res = await POST(makeRequest({ id: 'someone-elses-event', permanent: false }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
    expect(mockDb.from).toHaveBeenCalledWith('events');
    // The suite-wide fail-fast global.fetch would throw on any outbound call;
    // asserting zero calls proves no external cleanup was attempted at all.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('scopes a same-studio soft delete by both verified event id and studio id', async () => {
    mockDb.from = createFromMock({
      events: [
        {
          data: {
            id: 'evt-1',
            slug: 'evt-1-slug',
            thumbnail_url: null,
            invitation_video_url: null,
            gallery_urls: null,
          },
          error: null,
        },
        { data: null, error: null }, // soft-delete update
      ],
    });

    const POST = await loadRoute();
    const res = await POST(makeRequest({ id: 'evt-1', permanent: false }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Event archived successfully' });

    const updateCall = mockDb.from.mock.results[1].value;
    expect(updateCall.eq.mock.calls).toEqual([
      ['id', 'evt-1'],
      ['studio_id', 'studio-a'],
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('scopes a same-studio permanent delete by both verified event id and studio id, and contacts no external service when Cloudinary and GitHub are both skipped', async () => {
    delete process.env.GITHUB_TOKEN; // Cloudinary is skipped via null fields below; GitHub is skipped via no token.

    mockDb.from = createFromMock({
      events: [
        {
          data: {
            id: 'evt-1',
            slug: 'evt-1-slug',
            thumbnail_url: null,
            invitation_video_url: null,
            gallery_urls: null,
          },
          error: null,
        },
        { data: null, error: null }, // final permanent delete
      ],
    });

    const POST = await loadRoute();
    const res = await POST(makeRequest({ id: 'evt-1', permanent: true }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Deleted permanently' });

    // Milestone O: Restreamer cleanup is retired. A permanent delete must now
    // reach no external host at all on this path — in particular, never the
    // retired Restreamer media server.
    expect(fetch).not.toHaveBeenCalled();

    const deleteCall = mockDb.from.mock.results[1].value;
    expect(deleteCall.delete).toHaveBeenCalledTimes(1);
    expect(deleteCall.eq.mock.calls).toEqual([
      ['id', 'evt-1'],
      ['studio_id', 'studio-a'],
    ]);
  });

  it('uses the verified database slug — never the client-supplied id — for GitHub cleanup, and contacts no Restreamer host', async () => {
    process.env.GITHUB_TOKEN = 'gh-test-token';

    const requestedUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.includes('/git/refs/heads/main')) {
          return { ok: true, json: async () => ({ object: { sha: 'commit-sha' } }) } as unknown as Response;
        }
        if (url.includes('/git/commits/')) {
          return { ok: true, json: async () => ({ tree: { sha: 'tree-sha' } }) } as unknown as Response;
        }
        if (url.includes('/contents/')) {
          // No files to delete — the route stops before any write call.
          return { ok: true, json: async () => [] } as unknown as Response;
        }
        throw new Error(`Unexpected outbound call to ${url}`);
      })
    );

    mockDb.from = createFromMock({
      events: [
        {
          data: {
            id: 'evt-1',
            slug: 'evt-1-slug',
            thumbnail_url: null,
            invitation_video_url: null,
            gallery_urls: null,
          },
          error: null,
        },
        { data: null, error: null }, // final permanent delete
      ],
    });

    const POST = await loadRoute();
    // The client supplies only the event id; the slug must come from the row.
    const res = await POST(makeRequest({ id: 'evt-1', permanent: true }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Deleted permanently' });

    // Verified-slug coverage, re-anchored from the retired Restreamer step
    // onto the surviving GitHub cleanup step.
    const contentsUrl = requestedUrls.find((u) => u.includes('/contents/'));
    expect(contentsUrl).toBeDefined();
    expect(contentsUrl).toContain('events/evt-1-slug');
    expect(contentsUrl).not.toContain('client-guessed-slug');

    // Every outbound call stays on the GitHub API; nothing reaches the
    // retired Restreamer media host.
    for (const url of requestedUrls) {
      expect(url.startsWith('https://api.github.com/')).toBe(true);
      expect(url).not.toContain('media.eventcast.pro');
      expect(url).not.toContain('/memfs/');
    }

    const deleteCall = mockDb.from.mock.results[1].value;
    expect(deleteCall.delete).toHaveBeenCalledTimes(1);
    expect(deleteCall.eq.mock.calls).toEqual([
      ['id', 'evt-1'],
      ['studio_id', 'studio-a'],
    ]);
  });
});
