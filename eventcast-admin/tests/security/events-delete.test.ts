import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFromMock,
  authSuccess,
  type MockQueryBuilder,
  type MockRestreamerInstance,
} from './support/mocks';

const { mockDb, mockRestreamer, mockRestreamerClient, mockRequireAdmin } = vi.hoisted(() => {
  const restreamerInstance: MockRestreamerInstance = {
    setupChannel: vi.fn(),
    restartChannel: vi.fn(),
    toggleOutput: vi.fn(),
    deleteChannel: vi.fn(),
    deleteChannelFiles: vi.fn(),
  };
  return {
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
    },
    mockRestreamer: restreamerInstance,
    mockRestreamerClient: vi.fn(function () { return restreamerInstance; }),
    mockRequireAdmin: vi.fn(async () => authSuccess()),
  };
});

vi.mock('@/lib/auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/restreamer', () => ({ RestreamerClient: mockRestreamerClient }));
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
  it('rejects a cross-tenant or nonexistent event before soft delete, permanent delete, Restreamer, Cloudinary, or GitHub calls', async () => {
    mockDb.from = createFromMock({
      events: [{ data: null, error: null }],
    });

    const POST = await loadRoute();
    const res = await POST(makeRequest({ id: 'someone-elses-event', permanent: false }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Event not found' });
    expect(mockDb.from).toHaveBeenCalledTimes(1);
    expect(mockDb.from).toHaveBeenCalledWith('events');
    expect(mockRestreamerClient).not.toHaveBeenCalled();
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
    expect(mockRestreamerClient).not.toHaveBeenCalled();
  });

  it('scopes a same-studio permanent delete by both verified event id and studio id, and cleans up Restreamer with the verified slug', async () => {
    delete process.env.GITHUB_TOKEN; // Cloudinary is skipped via null fields below; GitHub is skipped via no token.
    mockRestreamer.deleteChannelFiles.mockResolvedValue({ deleted: 0, errors: 0 });

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

    expect(mockRestreamer.deleteChannel).toHaveBeenCalledWith('evt-1-slug');
    expect(mockRestreamer.deleteChannelFiles).toHaveBeenCalledWith('evt-1-slug');

    const deleteCall = mockDb.from.mock.results[1].value;
    expect(deleteCall.delete).toHaveBeenCalledTimes(1);
    expect(deleteCall.eq.mock.calls).toEqual([
      ['id', 'evt-1'],
      ['studio_id', 'studio-a'],
    ]);
  });
});
