import { describe, expect, it, vi } from 'vitest';
import { loadStudioLiveStatus } from '@/lib/media-agent/studioLiveStatus';

function makeDb(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(() => Promise.resolve(result));
  const eq = vi.fn((_column: string, _value: unknown) => ({ maybeSingle }));
  const select = vi.fn((_columns: string) => ({ eq }));
  const from = vi.fn((_table: string) => ({ select }));
  return { from, select, eq, maybeSingle };
}

const BASE_ROW = {
  event_id: 'evt-1',
  ingest_id: 'ingest-1',
  playback_id: 'playback-1',
  enabled: true,
  publish_window_start_at: '2026-01-01T00:00:00Z',
  publish_window_end_at: '2026-01-02T00:00:00Z',
  config_version: 5,
  updated_at: '2026-01-01T00:00:00Z',
  youtube_enabled: false,
};

describe('loadStudioLiveStatus', () => {
  it('returns not_found when no assignment row exists', async () => {
    const db = makeDb({ data: null, error: null });
    const result = await loadStudioLiveStatus(db, 'evt-1');
    expect(result).toEqual({ outcome: 'not_found' });
  });

  it('returns error on a database failure', async () => {
    const db = makeDb({ data: null, error: { message: 'boom' } });
    const result = await loadStudioLiveStatus(db, 'evt-1');
    expect(result).toEqual({ outcome: 'error' });
  });

  it('constructs streamUrl only when enabled and the node hostname is present (object embed shape)', async () => {
    const db = makeDb({ data: { ...BASE_ROW, media_nodes: { ingest_hostname: 'node1.eventcast.pro' } }, error: null });
    const result = await loadStudioLiveStatus(db, 'evt-1');
    expect(result.outcome).toBe('found');
    if (result.outcome === 'found') {
      expect(result.status.streamUrl).toBe('rtmp://node1.eventcast.pro/live');
    }
  });

  it('handles the array embed shape PostgREST may return', async () => {
    const db = makeDb({ data: { ...BASE_ROW, media_nodes: [{ ingest_hostname: 'node2.eventcast.pro' }] }, error: null });
    const result = await loadStudioLiveStatus(db, 'evt-1');
    expect(result.outcome).toBe('found');
    if (result.outcome === 'found') {
      expect(result.status.streamUrl).toBe('rtmp://node2.eventcast.pro/live');
    }
  });

  it('returns a null streamUrl when the assignment is disabled, even with a node assigned', async () => {
    const db = makeDb({
      data: { ...BASE_ROW, enabled: false, media_nodes: { ingest_hostname: 'node1.eventcast.pro' } },
      error: null,
    });
    const result = await loadStudioLiveStatus(db, 'evt-1');
    expect(result.outcome).toBe('found');
    if (result.outcome === 'found') {
      expect(result.status.enabled).toBe(false);
      expect(result.status.streamUrl).toBeNull();
    }
  });

  it('returns a null streamUrl when no node is assigned yet', async () => {
    const db = makeDb({ data: { ...BASE_ROW, media_nodes: null }, error: null });
    const result = await loadStudioLiveStatus(db, 'evt-1');
    expect(result.outcome).toBe('found');
    if (result.outcome === 'found') {
      expect(result.status.streamUrl).toBeNull();
    }
  });

  it('never includes a secret-bearing or node-id field in the returned shape', async () => {
    const db = makeDb({ data: { ...BASE_ROW, media_nodes: { ingest_hostname: 'node1.eventcast.pro' } }, error: null });
    const result = await loadStudioLiveStatus(db, 'evt-1');
    const serialized = JSON.stringify(result);
    for (const forbidden of ['stream_secret_hash', 'streamSecretHash', 'assigned_media_node_id', 'assignedMediaNodeId', 'youtube_secret_reference']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('selects the expected non-secret column set only', async () => {
    const db = makeDb({ data: { ...BASE_ROW, media_nodes: null }, error: null });
    await loadStudioLiveStatus(db, 'evt-1');
    const selectedColumns = db.select.mock.calls[0][0] as string;
    expect(selectedColumns).not.toMatch(/stream_secret_hash|youtube_secret_reference|youtube_destination_base_url/);
    expect(selectedColumns).toContain('media_nodes(ingest_hostname)');
  });
});
