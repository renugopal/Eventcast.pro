import { describe, expect, it } from 'vitest';
import { isR2CleanupEligible } from '@/lib/r2CleanupEligibility';
import type { EventRecordingRow } from '@/lib/eventRecording';

function fullyEligibleRow(overrides: Partial<EventRecordingRow> = {}): EventRecordingRow {
  return {
    id: 'rec-1',
    event_id: 'event-1',
    recording_state: 'b2_finalized',
    local_finalized_at: '2026-08-01T00:00:00Z',
    // The authoritative archive is the generation-specific HLS playlist,
    // not a single media file — the pipeline produces a confirmed .ts
    // segment set plus a rebuilt playlist, with no remux step.
    b2_object_key: 'events/event-1/vod/gen-aaa.m3u8',
    b2_bucket: 'eventcast-vod',
    b2_finalized_at: '2026-08-02T00:00:00Z',
    integrity_verified_at: '2026-08-02T00:05:00Z',
    finalization_failure_reason: null,
    finalization_generation: 'gen-aaa',
    gap_count: 0,
    gap_status: 'none',
    youtube_fallback_url: null,
    youtube_fallback_verified: false,
    retention_effective_days: 90,
    retention_frozen_at: '2026-08-02T00:05:00Z',
    retention_expires_at: '2026-10-31T00:05:00Z',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-02T00:05:00Z',
    ...overrides,
  };
}

describe('isR2CleanupEligible', () => {
  it('is eligible when every required evidence field is present', () => {
    expect(isR2CleanupEligible(fullyEligibleRow())).toBe(true);
  });

  it('fails closed when recording is null/undefined', () => {
    expect(isR2CleanupEligible(null)).toBe(false);
    expect(isR2CleanupEligible(undefined)).toBe(false);
  });

  it('fails closed when recording_state is not exactly b2_finalized', () => {
    expect(isR2CleanupEligible(fullyEligibleRow({ recording_state: 'local_finalized' }))).toBe(false);
    expect(isR2CleanupEligible(fullyEligibleRow({ recording_state: 'b2_finalizing' }))).toBe(false);
  });

  it('fails closed when b2_object_key is missing or empty', () => {
    expect(isR2CleanupEligible(fullyEligibleRow({ b2_object_key: null }))).toBe(false);
    expect(isR2CleanupEligible(fullyEligibleRow({ b2_object_key: '' }))).toBe(false);
  });

  it('fails closed when b2_bucket is missing or empty', () => {
    expect(isR2CleanupEligible(fullyEligibleRow({ b2_bucket: null }))).toBe(false);
    expect(isR2CleanupEligible(fullyEligibleRow({ b2_bucket: '' }))).toBe(false);
  });

  it('fails closed when b2_finalized_at is missing (a b2_object_key alone is never sufficient)', () => {
    expect(isR2CleanupEligible(fullyEligibleRow({ b2_finalized_at: null }))).toBe(false);
  });

  it('fails closed when integrity_verified_at is missing', () => {
    expect(isR2CleanupEligible(fullyEligibleRow({ integrity_verified_at: null }))).toBe(false);
  });

  it('fails closed when retention_effective_days is missing or not positive', () => {
    expect(isR2CleanupEligible(fullyEligibleRow({ retention_effective_days: null }))).toBe(false);
    expect(isR2CleanupEligible(fullyEligibleRow({ retention_effective_days: 0 }))).toBe(false);
  });

  it('fails closed when retention_frozen_at is missing', () => {
    expect(isR2CleanupEligible(fullyEligibleRow({ retention_frozen_at: null }))).toBe(false);
  });

  it('fails closed when retention_expires_at is missing', () => {
    expect(isR2CleanupEligible(fullyEligibleRow({ retention_expires_at: null }))).toBe(false);
  });
});
