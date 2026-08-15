import { describe, expect, it } from 'vitest';
import {
  buildR2CleanupPlan,
  reconcileTemplateUsage,
  toPlatformMediaNodeView,
  toPlatformRecordingView,
  toStorageVisibilityView,
  R2_CLEANUP_EXECUTION_BLOCKERS,
} from '@/lib/platformOperations';
import { isR2CleanupEligible } from '@/lib/r2CleanupEligibility';
import type { EventRecordingRow } from '@/lib/eventRecording';

function makeRecording(overrides: Partial<EventRecordingRow> = {}): EventRecordingRow {
  return {
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
    ...overrides,
  };
}

const ACTIVATIONS = [
  { playback_id: 'pb-a', media_node_id: 'node-1', activated_at: '2026-06-01T00:00:00.000Z' },
  { playback_id: 'pb-b', media_node_id: 'node-1', activated_at: '2026-06-01T00:30:00.000Z' },
];

describe('buildR2CleanupPlan', () => {
  it('delegates the eligibility decision to isR2CleanupEligible rather than re-deriving it', () => {
    const cases: EventRecordingRow[] = [
      makeRecording(),
      makeRecording({ recording_state: 'b2_finalizing' }),
      makeRecording({ integrity_verified_at: null }),
      makeRecording({ retention_frozen_at: null }),
      makeRecording({ b2_object_key: '' }),
      makeRecording({ retention_effective_days: 0 }),
    ];

    for (const recording of cases) {
      const plan = buildR2CleanupPlan(recording.event_id, recording, ACTIVATIONS);
      expect(plan.eligible).toBe(isR2CleanupEligible(recording));
    }
  });

  it('produces candidate prefixes only for an eligible recording, derived from its own activation history', () => {
    const plan = buildR2CleanupPlan('event-1', makeRecording(), ACTIVATIONS);

    expect(plan.eligible).toBe(true);
    expect(plan.candidateR2Prefixes).toEqual(['events/pb-a/', 'events/pb-b/']);
  });

  it('fails closed with no candidate prefix whenever the recording is not eligible', () => {
    const notEligible: Partial<EventRecordingRow>[] = [
      { recording_state: 'recording' },
      { recording_state: 'b2_finalizing' },
      { b2_finalized_at: null },
      { integrity_verified_at: null },
      { retention_frozen_at: null },
      { retention_expires_at: null },
      { b2_bucket: null },
    ];

    for (const overrides of notEligible) {
      const plan = buildR2CleanupPlan('event-1', makeRecording(overrides), ACTIVATIONS);
      expect(plan.eligible).toBe(false);
      expect(plan.candidateR2Prefixes).toEqual([]);
      expect(plan.ineligibilityReasons.length).toBeGreaterThan(0);
    }
  });

  it('fails closed for a missing recording row', () => {
    const plan = buildR2CleanupPlan('event-1', null, ACTIVATIONS);
    expect(plan.eligible).toBe(false);
    expect(plan.candidateR2Prefixes).toEqual([]);
  });

  it('fails closed when an eligible recording has no usable activation history to prove ownership of any prefix', () => {
    const plan = buildR2CleanupPlan('event-1', makeRecording(), []);
    expect(plan.candidateR2Prefixes).toEqual([]);
    expect(plan.ineligibilityReasons.join(' ')).toContain('no R2 prefix can be proven');
  });

  it('ignores blank/duplicate playback ids rather than emitting a prefix that targets the whole bucket', () => {
    const plan = buildR2CleanupPlan('event-1', makeRecording(), [
      { playback_id: '  ', media_node_id: 'node-1' },
      { playback_id: 'pb-a', media_node_id: 'node-1' },
      { playback_id: 'pb-a', media_node_id: 'node-2' },
    ]);

    expect(plan.candidateR2Prefixes).toEqual(['events/pb-a/']);
    expect(plan.candidateR2Prefixes).not.toContain('events/');
  });

  it('never targets the authoritative B2 archive, even for a fully eligible recording', () => {
    const recording = makeRecording();
    const plan = buildR2CleanupPlan('event-1', recording, ACTIVATIONS);

    expect(plan.b2ObjectsExcluded).toBe(true);
    for (const prefix of plan.candidateR2Prefixes) {
      expect(prefix).not.toContain(recording.b2_object_key as string);
      expect(prefix).not.toContain(recording.b2_bucket as string);
    }
    expect(JSON.stringify(plan)).not.toContain(recording.b2_object_key as string);
  });

  it('always reports execution as unavailable, with the precise unresolved decisions attached', () => {
    const plan = buildR2CleanupPlan('event-1', makeRecording(), ACTIVATIONS);
    expect(plan.executionAvailable).toBe(false);
    expect(plan.executionBlockers).toBe(R2_CLEANUP_EXECUTION_BLOCKERS);
    expect(plan.executionBlockers.length).toBeGreaterThan(0);
  });
});

describe('toPlatformRecordingView', () => {
  it('projects an explicit allowlist and no unexpected raw columns', () => {
    const view = toPlatformRecordingView(makeRecording(), new Date('2026-07-01T00:00:00.000Z'));

    expect(Object.keys(view).sort()).toEqual(
      [
        'b2Bucket',
        'b2FinalizedAt',
        'b2ObjectKey',
        'finalizationFailureReason',
        'finalizationGeneration',
        'gapCount',
        'gapStatus',
        'integrityVerifiedAt',
        'localFinalizedAt',
        'recordingState',
        'retentionEffectiveDays',
        'retentionExpiresAt',
        'retentionExpired',
        'retentionFrozenAt',
        'updatedAt',
        'youtubeChannelState',
        'youtubeFallbackUrl',
        'youtubeFallbackVerified',
      ].sort()
    );
    expect(view.retentionExpired).toBe(false);
  });

  it('marks retention expired only once the persisted expiry has actually passed', () => {
    const view = toPlatformRecordingView(makeRecording(), new Date('2026-12-01T00:00:00.000Z'));
    expect(view.retentionExpired).toBe(true);
  });

  it('never invents YouTube channel state', () => {
    const view = toPlatformRecordingView(makeRecording());
    expect(view.youtubeChannelState.available).toBe(false);
    expect(view.youtubeChannelState.reason).toContain('manual Super Admin attestation');
  });
});

describe('toPlatformMediaNodeView', () => {
  const nodeRow = {
    id: 'node-1',
    name: 'gcp-asia-south1-01',
    region: 'asia-south1',
    ingest_hostname: 'ingest-1.eventcast.pro',
    status: 'healthy',
    maintenance_mode: false,
    hard_stream_limit: 10,
    active_stream_count: 3,
    disk_free_bytes: 1024,
    r2_queue_bytes: 2048,
    last_heartbeat_at: '2026-07-01T00:00:00.000Z',
    software_version: 'v1.0.9',
    config_version: 'cfg-3',
    updated_at: '2026-07-01T00:00:00.000Z',
  };

  it('reports capacity from persisted counters and never fabricates resource telemetry', () => {
    const view = toPlatformMediaNodeView(nodeRow, new Date('2026-07-01T00:30:00.000Z'));

    expect(view.capacityRemaining).toBe(7);
    expect(view.heartbeatAgeMinutes).toBe(30);
    expect(view.resourceTelemetry.available).toBe(false);
    expect(JSON.stringify(view).toLowerCase()).not.toContain('cpu_percent');
  });

  it('leaves heartbeat age null for a node that has never reported', () => {
    const view = toPlatformMediaNodeView({ ...nodeRow, last_heartbeat_at: null });
    expect(view.heartbeatAgeMinutes).toBeNull();
  });
});

describe('toStorageVisibilityView', () => {
  it('reports object byte totals as unmeasured rather than as zero', () => {
    const view = toStorageVisibilityView({
      guestPhotoCount: 2,
      guestPhotoBytes: 500,
      guestPhotoRowsWithoutSize: 1,
      recordingsWithB2Archive: 1,
      recordingsRetentionFrozen: 1,
      recordingsRetentionExpired: 0,
      r2CleanupEligibleCount: 1,
      nodeDiskFreeBytes: null,
      nodeR2QueueBytes: 10,
    });

    expect(view.r2MediaObjectBytes.available).toBe(false);
    expect(view.b2ArchiveObjectBytes.available).toBe(false);
    expect(view.nodeDiskFreeBytes).toBeNull();
    expect(view.guestPhotoBytes).toBe(500);
  });
});

describe('reconcileTemplateUsage', () => {
  const registry = {
    'wedding-template-01': {
      templateId: 'wedding-template-01',
      templateVersion: '1.0.0',
      eventTypes: ['wedding'] as const,
    },
  };

  it('reports real usage counts for registered templates', () => {
    const views = reconcileTemplateUsage(registry, ['wedding-template-01', 'wedding-template-01']);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ templateId: 'wedding-template-01', registered: true, eventCount: 2 });
  });

  it('surfaces an unregistered template id that is actually in use instead of hiding or remapping it', () => {
    const views = reconcileTemplateUsage(registry, ['wedding-template-01', 'mystery-template', null, '  ']);
    const mystery = views.find((view) => view.templateId === 'mystery-template');

    expect(mystery).toBeDefined();
    expect(mystery?.registered).toBe(false);
    expect(mystery?.eventCount).toBe(1);
    // The blank/null ids must never become a template row of their own.
    expect(views).toHaveLength(2);
  });
});
