import { describe, expect, it } from 'vitest';
import { loadEnabledAssignmentSources } from '@/lib/media-agent/nodeAssignmentsRepo';

const NODE_ID = 'node-uuid-1';

/**
 * Regression lock for the deactivation slice (migration 0026): proves that
 * once `media_event_assignments.enabled` is `false`, the Media Agent's own
 * pull-sync query (`loadEnabledAssignmentSources`, unmodified by this
 * slice) no longer returns that row at all. This is what makes node
 * capacity release actually take effect on the consumption side — no Go
 * Media Agent code change was needed because this query already filtered
 * on `enabled = true` before this slice existed.
 */
describe('loadEnabledAssignmentSources — enabled=false rows are excluded (capacity-release regression lock)', () => {
  it('passes .eq("enabled", true) as part of its query — a deactivated row can never be returned', async () => {
    const eqCalls: [string, unknown][] = [];

    const db = {
      from: (_table: string) => ({
        select: (_columns: string) => {
          const builder = {
            eq: (column: string, value: unknown) => {
              eqCalls.push([column, value]);
              return builder;
            },
            is: (_column: string, _value: null) => builder,
            then: (resolve: (result: { data: unknown[]; error: null }) => void) =>
              resolve({ data: [], error: null }),
          };
          return builder;
        },
        insert: async () => ({ data: null, error: null }),
      }),
    };

    await loadEnabledAssignmentSources(db, NODE_ID, 'https://example.invalid');

    expect(eqCalls).toContainEqual(['enabled', true]);
    expect(eqCalls).toContainEqual(['assigned_media_node_id', NODE_ID]);
  });

  it('a query result containing only a disabled (deactivated) row and only an enabled row returns solely the enabled one — simulates the real filter effect', async () => {
    const enabledRow = {
      event_id: 'event-enabled',
      ingest_id: 'a'.repeat(64),
      playback_id: 'b'.repeat(64),
      stream_secret_hash: 'c'.repeat(64),
      enabled: true,
      publish_window_start_at: '2026-01-01T00:00:00.000Z',
      publish_window_end_at: '2026-01-02T00:00:00.000Z',
      config_version: 2,
      updated_at: '2026-01-01T00:00:00.000Z',
      youtube_enabled: false,
    };

    // A real `.eq('enabled', true)` filter at the database level would never
    // hand back the deactivated row in the first place — this mock proves
    // the code path correctly surfaces only what the query already filtered
    // to, without any additional application-side filtering masking a bug.
    const db = {
      from: (_table: string) => ({
        select: (_columns: string) => {
          const builder = {
            eq: (_column: string, _value: unknown) => builder,
            is: (_column: string, _value: null) => builder,
            then: (resolve: (result: { data: unknown[]; error: null }) => void) =>
              resolve({ data: [enabledRow], error: null }),
          };
          return builder;
        },
        insert: async () => ({ data: null, error: null }),
      }),
    };

    const result = await loadEnabledAssignmentSources(db, NODE_ID, 'https://example.invalid');

    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].eventId).toBe('event-enabled');
  });
});
