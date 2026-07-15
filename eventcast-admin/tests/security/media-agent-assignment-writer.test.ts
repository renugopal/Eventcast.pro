import { describe, expect, it } from 'vitest';
import * as assignmentWriterModule from '@/lib/media-agent/assignmentWriter';
import { ensureDraftAssignment } from '@/lib/media-agent/assignmentWriter';

const EVENT_ID = 'event-uuid-1';

interface FakeResult {
  error?: { message: string; code?: string } | null;
}

function makeFakeDb(result: FakeResult) {
  const insertCalls: { table: string; values: unknown }[] = [];
  const from = (table: string) => ({
    insert: (values: unknown) => {
      insertCalls.push({ table, values });
      return Promise.resolve(result);
    },
  });
  return { from, insertCalls };
}

describe('ensureDraftAssignment', () => {
  it('inserts exactly { event_id } and returns "created" on success', async () => {
    const { from, insertCalls } = makeFakeDb({ error: null });

    const result = await ensureDraftAssignment({ from }, EVENT_ID);

    expect(result).toBe('created');
    expect(insertCalls).toEqual([
      { table: 'media_event_assignments', values: { event_id: EVENT_ID } },
    ]);
  });

  it('returns "exists" on a unique_violation (23505) — idempotent, no other side effect', async () => {
    const { from, insertCalls } = makeFakeDb({
      error: { message: 'duplicate key value violates unique constraint', code: '23505' },
    });

    const result = await ensureDraftAssignment({ from }, EVENT_ID);

    expect(result).toBe('exists');
    expect(insertCalls).toEqual([
      { table: 'media_event_assignments', values: { event_id: EVENT_ID } },
    ]);
  });

  it('returns "error" for any other database failure, without leaking the message', async () => {
    const { from } = makeFakeDb({ error: { message: 'connection reset to 10.0.0.5' } });

    const result = await ensureDraftAssignment({ from }, EVENT_ID);

    expect(result).toBe('error');
    // The result is a plain string enum — structurally incapable of
    // carrying the original error message. Assert it explicitly anyway
    // so this test fails loudly if the return type is ever widened.
    expect(typeof result).toBe('string');
    expect(result).not.toContain('connection reset to 10.0.0.5');
  });

  it('inserts nothing beyond event_id, even when called with a different event id', async () => {
    const { from, insertCalls } = makeFakeDb({ error: null });

    await ensureDraftAssignment({ from }, 'a-different-event-id');

    expect(insertCalls[0].values).toEqual({ event_id: 'a-different-event-id' });
    expect(Object.keys(insertCalls[0].values as object)).toEqual(['event_id']);
  });

  it('never sets assigned_media_node_id, ingest_id, playback_id, stream_secret_hash, publish window bounds, enabled, youtube_enabled, config_version, or updated_at', async () => {
    const { from, insertCalls } = makeFakeDb({ error: null });

    await ensureDraftAssignment({ from }, EVENT_ID);

    const values = insertCalls[0].values as Record<string, unknown>;
    for (const forbiddenKey of [
      'assigned_media_node_id',
      'ingest_id',
      'playback_id',
      'stream_secret_hash',
      'publish_window_start_at',
      'publish_window_end_at',
      'enabled',
      'youtube_enabled',
      'config_version',
      'updated_at',
    ]) {
      expect(values).not.toHaveProperty(forbiddenKey);
    }
  });
});

describe('assignmentWriter module surface', () => {
  it('exposes exactly one export: ensureDraftAssignment — no update/upsert/delete/activation function exists', () => {
    expect(Object.keys(assignmentWriterModule).sort()).toEqual(['ensureDraftAssignment']);
  });
});
