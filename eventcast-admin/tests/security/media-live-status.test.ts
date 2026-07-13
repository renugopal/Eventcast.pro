import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import {
  authSuccess,
  createFromMock,
  type MockQueryBuilder,
} from './support/mocks';

const {
  mockDb,
  mockGetAllProcesses,
  mockGetProcessHealth,
  mockRestreamerClient,
  mockRequireAdmin,
} = vi.hoisted(() => {
  const getAllProcesses = vi.fn();
  const getProcessHealth = vi.fn();
  const restreamer = {
    getAllProcesses,
    getProcessHealth,
  };

  return {
    mockDb: {
      from: vi.fn((table: string): MockQueryBuilder => {
        throw new Error(`mockDb.from not configured for table '${table}' in this test`);
      }),
    },
    mockGetAllProcesses: getAllProcesses,
    mockGetProcessHealth: getProcessHealth,
    mockRestreamerClient: vi.fn(function () { return restreamer; }),
    mockRequireAdmin: vi.fn(async (): Promise<unknown> => authSuccess()),
  };
});

vi.mock('@/lib/auth', () => ({ requireAdmin: mockRequireAdmin }));
vi.mock('@/lib/restreamer', () => ({ RestreamerClient: mockRestreamerClient }));
vi.mock('@/lib/supabase', () => ({ supabase: mockDb, supabaseAdmin: mockDb }));

async function loadRoute() {
  const mod = await import('@/app/api/media/live-status/route');
  return mod.GET;
}

function makeRequest(): Request {
  return new Request('http://test.local/api/media/live-status');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRequireAdmin.mockResolvedValue(authSuccess());
});

describe('GET /api/media/live-status — tenant scope and redaction', () => {
  it('rejects an unauthenticated request before database or Restreamer access', async () => {
    mockRequireAdmin.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );

    const GET = await loadRoute();
    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    expect(mockDb.from).not.toHaveBeenCalled();
    expect(mockRestreamerClient).not.toHaveBeenCalled();
  });

  it('returns only owned processes and strips process config, output URLs, and secrets', async () => {
    mockDb.from = createFromMock({
      events: [{ data: [{ id: 'event-owned', slug: 'owned-slug' }], error: null }],
    });
    mockGetAllProcesses.mockResolvedValue([
      {
        id: 'owned-slug',
        state: { exec: 'running' },
        config: {
          output: [
            { id: 'hls', address: '{memfs}/owned-slug.m3u8' },
            { id: 'youtube', address: 'rtmp://youtube.example/live/owned-youtube-secret' },
          ],
        },
        internalToken: 'restreamer-internal-secret',
      },
      {
        id: 'other-studio-slug',
        state: 'running',
        config: {
          output: [
            { id: 'youtube', address: 'rtmp://youtube.example/live/cross-tenant-secret' },
          ],
        },
      },
    ]);
    mockGetProcessHealth.mockResolvedValue({
      slug: 'owned-slug',
      state: 'running',
      bitrateKbps: 4200,
      runtimeSeconds: 91,
      fps: 30,
    });

    const GET = await loadRoute();
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      activeProcesses: [{
        id: 'owned-slug',
        eventId: 'event-owned',
        state: 'running',
        bitrateKbps: 4200,
        fps: 30,
        runtime_seconds: 91,
        youtubeEnabled: true,
      }],
    });
    expect(mockGetProcessHealth).toHaveBeenCalledTimes(1);
    expect(mockGetProcessHealth).toHaveBeenCalledWith('owned-slug');

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('config');
    expect(serialized).not.toContain('output');
    expect(serialized).not.toContain('owned-youtube-secret');
    expect(serialized).not.toContain('cross-tenant-secret');
    expect(serialized).not.toContain('restreamer-internal-secret');
    expect(serialized).not.toContain('other-studio-slug');
  });

  it('returns an empty result without contacting Restreamer when the studio owns no events', async () => {
    mockDb.from = createFromMock({
      events: [{ data: [], error: null }],
    });

    const GET = await loadRoute();
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, activeProcesses: [] });
    expect(mockRestreamerClient).not.toHaveBeenCalled();
    expect(mockGetAllProcesses).not.toHaveBeenCalled();
  });

  it('fails closed with a generic response when Restreamer access throws', async () => {
    mockDb.from = createFromMock({
      events: [{ data: [{ id: 'event-owned', slug: 'owned-slug' }], error: null }],
    });
    mockGetAllProcesses.mockRejectedValue(new Error('upstream credential detail'));

    const GET = await loadRoute();
    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to fetch live status' });
    expect(JSON.stringify(body)).not.toContain('upstream credential detail');
  });
});
