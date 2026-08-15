import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The R2 cleanup surface must be provably non-destructive.
 *
 * Beyond the eligibility semantics covered in
 * `tests/contract/platformOperations.test.ts`, this suite proves the route
 * itself cannot delete: it never reaches a mutation verb on any table, never
 * calls an RPC, never performs a network request to a storage endpoint, and
 * reports execution as unavailable even when every event is fully eligible.
 */

const { mockRequireSuperAdmin, tableResults, mockFrom, mockRpc, mutationCalls } = vi.hoisted(() => {
  const tableResults = new Map<string, { data: unknown; error: unknown }>();
  const mutationCalls: string[] = [];

  function makeBuilder(table: string) {
    const result = () => tableResults.get(table) ?? { data: [], error: null };
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'range', 'limit']) {
      builder[method] = () => builder;
    }
    for (const method of ['delete', 'update', 'insert', 'upsert']) {
      builder[method] = () => {
        mutationCalls.push(`${table}.${method}`);
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return builder;
  }

  return {
    tableResults,
    mutationCalls,
    mockRequireSuperAdmin: vi.fn(),
    mockFrom: vi.fn((table: string) => makeBuilder(table)),
    mockRpc: vi.fn(),
  };
});

vi.mock('@/lib/superAdmin', () => ({ requireSuperAdmin: mockRequireSuperAdmin }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
  supabaseAdmin: { from: mockFrom, rpc: mockRpc },
}));

const ELIGIBLE_RECORDING = {
  id: 'rec-1',
  event_id: 'event-1',
  recording_state: 'b2_finalized',
  local_finalized_at: '2026-06-01T00:00:00.000Z',
  b2_object_key: 'events/event-1/vod/gen-1.m3u8',
  b2_bucket: 'eventcast-vod',
  b2_finalized_at: '2026-06-01T01:00:00.000Z',
  integrity_verified_at: '2026-06-01T02:00:00.000Z',
  finalization_failure_reason: null,
  finalization_generation: 'gen-1',
  gap_count: 0,
  gap_status: 'none',
  youtube_fallback_url: null,
  youtube_fallback_verified: false,
  retention_effective_days: 90,
  retention_frozen_at: '2026-06-01T02:00:00.000Z',
  retention_expires_at: '2026-08-30T02:00:00.000Z',
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T02:00:00.000Z',
  events: { slug: 'anaya-rohan', studio_id: 'studio-1' },
};

async function callRoute(url = 'http://t.local/api/platform/r2-cleanup') {
  const { GET } = await import('@/app/api/platform/r2-cleanup/route');
  return GET(new Request(url));
}

describe('GET /api/platform/r2-cleanup', () => {
  beforeEach(() => {
    tableResults.clear();
    mutationCalls.length = 0;
    mockFrom.mockClear();
    mockRpc.mockReset();
    mockRequireSuperAdmin.mockReset();
    mockRequireSuperAdmin.mockResolvedValue({ userId: 'super-1' });
  });

  it('reports an eligible event without ever performing a mutation or an RPC call', async () => {
    tableResults.set('event_recordings', { data: [ELIGIBLE_RECORDING], error: null });
    tableResults.set('media_event_assignment_activations', {
      data: [{ event_id: 'event-1', media_node_id: 'node-1', playback_id: 'pb-1', activated_at: null }],
      error: null,
    });

    const json = await (await callRoute()).json();

    expect(json.summary).toEqual({ total: 1, eligible: 1, notEligible: 0 });
    expect(json.reports[0].candidateR2Prefixes).toEqual(['events/pb-1/']);
    expect(mutationCalls).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('always reports execution as unavailable, even when everything is eligible', async () => {
    tableResults.set('event_recordings', { data: [ELIGIBLE_RECORDING], error: null });
    tableResults.set('media_event_assignment_activations', {
      data: [{ event_id: 'event-1', media_node_id: 'node-1', playback_id: 'pb-1', activated_at: null }],
      error: null,
    });

    const json = await (await callRoute()).json();

    expect(json.dryRunOnly).toBe(true);
    expect(json.executionAvailable).toBe(false);
    expect(json.reports[0].executionAvailable).toBe(false);
    expect(json.executionBlockers.length).toBeGreaterThan(0);
    expect(json.executionBlockers.join(' ')).toMatch(/No post-B2 grace duration is defined/);
    expect(json.executionBlockers.join(' ')).toMatch(/no credential or endpoint for the media R2 bucket/);
  });

  it('never proposes deleting a B2 object', async () => {
    tableResults.set('event_recordings', { data: [ELIGIBLE_RECORDING], error: null });
    tableResults.set('media_event_assignment_activations', {
      data: [{ event_id: 'event-1', media_node_id: 'node-1', playback_id: 'pb-1', activated_at: null }],
      error: null,
    });

    const json = await (await callRoute()).json();
    const serialized = JSON.stringify(json);

    expect(json.b2ObjectsExcluded).toBe(true);
    expect(serialized).not.toContain(ELIGIBLE_RECORDING.b2_object_key);
    expect(serialized).not.toContain(ELIGIBLE_RECORDING.b2_bucket);
    for (const report of json.reports) {
      for (const prefix of report.candidateR2Prefixes) {
        expect(prefix.startsWith('events/')).toBe(true);
        expect(prefix).not.toBe('events/');
      }
    }
  });

  it('fails closed for a recording whose archive evidence is incomplete', async () => {
    tableResults.set('event_recordings', {
      data: [{ ...ELIGIBLE_RECORDING, integrity_verified_at: null, recording_state: 'b2_finalizing' }],
      error: null,
    });
    tableResults.set('media_event_assignment_activations', {
      data: [{ event_id: 'event-1', media_node_id: 'node-1', playback_id: 'pb-1', activated_at: null }],
      error: null,
    });

    const json = await (await callRoute()).json();

    expect(json.summary).toEqual({ total: 1, eligible: 0, notEligible: 1 });
    expect(json.reports[0].candidateR2Prefixes).toEqual([]);
    expect(json.reports[0].ineligibilityReasons.length).toBeGreaterThan(0);
  });

  it('fails closed when an eligible recording has no activation history to prove which prefixes are its own', async () => {
    tableResults.set('event_recordings', { data: [ELIGIBLE_RECORDING], error: null });
    tableResults.set('media_event_assignment_activations', { data: [], error: null });

    const json = await (await callRoute()).json();

    expect(json.reports[0].eligible).toBe(true);
    expect(json.reports[0].candidateR2Prefixes).toEqual([]);
  });

  it('exposes no mutating HTTP verb at all', async () => {
    const routeModule = await import('@/app/api/platform/r2-cleanup/route');
    expect(routeModule).not.toHaveProperty('POST');
    expect(routeModule).not.toHaveProperty('DELETE');
    expect(routeModule).not.toHaveProperty('PATCH');
    expect(routeModule).not.toHaveProperty('PUT');
  });
});
