import { describe, expect, it, vi } from 'vitest';

// eventRecording.ts also exports impure functions that import '@/lib/supabase'
// at module scope, which eagerly constructs a real Supabase client requiring
// env vars this test suite doesn't set. Mocked here (unused by the pure
// functions this file actually exercises) purely so the module can load —
// same convention every other test file in this repo already follows.
vi.mock('@/lib/supabase', () => ({ supabase: {}, supabaseAdmin: {} }));

import { computeRetentionExpiry, computeRetentionFreezeTimestamp, toProviderSafeRecordingView } from '@/lib/eventRecording';
import type { EventRecordingRow } from '@/lib/eventRecording';

describe('computeRetentionExpiry', () => {
  it('adds the given number of days to the frozen timestamp', () => {
    const frozenAt = new Date('2026-08-01T00:00:00Z');
    const expiry = computeRetentionExpiry(frozenAt, 90);
    expect(expiry.toISOString()).toBe('2026-10-30T00:00:00.000Z');
  });
});

describe('computeRetentionFreezeTimestamp', () => {
  it('returns the later of the two evidence timestamps regardless of call time, not "now"', () => {
    const b2 = new Date('2026-08-01T10:00:00Z');
    const integrity = new Date('2026-08-01T12:00:00Z');
    expect(computeRetentionFreezeTimestamp(b2, integrity)).toEqual(integrity);
    expect(computeRetentionFreezeTimestamp(integrity, b2)).toEqual(integrity);
  });

  it('returns null when either evidence timestamp is missing', () => {
    expect(computeRetentionFreezeTimestamp(null, new Date())).toBeNull();
    expect(computeRetentionFreezeTimestamp(new Date(), null)).toBeNull();
    expect(computeRetentionFreezeTimestamp(null, null)).toBeNull();
  });
});

function baseRow(overrides: Partial<EventRecordingRow> = {}): EventRecordingRow {
  return {
    id: 'rec-1',
    event_id: 'event-1',
    recording_state: 'not_started',
    local_finalized_at: null,
    b2_object_key: null,
    b2_bucket: null,
    b2_finalized_at: null,
    integrity_verified_at: null,
    finalization_failure_reason: null,
    finalization_generation: null,
    gap_count: 0,
    gap_status: 'none',
    youtube_fallback_url: null,
    youtube_fallback_verified: false,
    retention_effective_days: null,
    retention_frozen_at: null,
    retention_expires_at: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('toProviderSafeRecordingView', () => {
  it('never exposes b2_object_key, b2_bucket, or integrity_verified_at', () => {
    const row = baseRow({
      recording_state: 'b2_finalized',
      b2_object_key: 'events/event-1/final.mp4',
      b2_bucket: 'eventcast-vod',
      b2_finalized_at: '2026-08-02T00:00:00Z',
      integrity_verified_at: '2026-08-02T00:05:00Z',
      retention_expires_at: '2026-10-31T00:05:00Z',
    });
    const view = toProviderSafeRecordingView(row) as unknown as Record<string, unknown>;
    expect(view).not.toHaveProperty('b2_object_key');
    expect(view).not.toHaveProperty('b2_bucket');
    expect(view).not.toHaveProperty('integrity_verified_at');
    expect(view).not.toHaveProperty('local_finalized_at');
    expect(view).not.toHaveProperty('finalization_failure_reason');
  });

  // Supersedes an earlier assertion that b2_finalized meant "available".
  // Two things must both hold before a provider is told a replay is ready,
  // and neither does yet: the archive must be byte-verified
  // (integrity_verified_at, which stays null until a real verification
  // mechanism is proven against the live endpoint), and the recording must
  // actually be playable (the B2 bucket is private and no read path is
  // approved). Claiming "available" on archival alone would be telling a
  // provider their replay is ready when nothing can play it.
  it('does not claim "available" for b2_finalized without verified integrity', () => {
    const view = toProviderSafeRecordingView(baseRow({ recording_state: 'b2_finalized' }));
    expect(view.replayStatus).toBe('processing');
  });

  it('still does not claim "available" for b2_finalized even once integrity is verified, while no B2 playback path exists', () => {
    const view = toProviderSafeRecordingView(
      baseRow({ recording_state: 'b2_finalized', integrity_verified_at: '2026-08-01T10:00:00Z' })
    );
    expect(view.replayStatus).toBe('processing');
  });

  it('maps in-progress states to "processing"', () => {
    for (const state of ['recording', 'local_finalized', 'b2_finalizing'] as const) {
      expect(toProviderSafeRecordingView(baseRow({ recording_state: state })).replayStatus).toBe('processing');
    }
  });

  it('maps failed to "failed" and not_started to "not_available"', () => {
    expect(toProviderSafeRecordingView(baseRow({ recording_state: 'failed' })).replayStatus).toBe('failed');
    expect(toProviderSafeRecordingView(baseRow({ recording_state: 'not_started' })).replayStatus).toBe('not_available');
  });

  it('returns not_available with no recording row at all', () => {
    const view = toProviderSafeRecordingView(null);
    expect(view.replayStatus).toBe('not_available');
    expect(view.retentionExpiresAt).toBeNull();
    expect(view.youtubeFallbackAvailable).toBe(false);
  });

  it('reports "available" only once the archive is verified, retention has not expired, AND B2 playback is configured', () => {
    const fullyEligible = baseRow({
      recording_state: 'b2_finalized',
      integrity_verified_at: '2026-08-14T12:37:12Z',
      retention_expires_at: '2099-01-01T00:00:00Z',
    });

    expect(toProviderSafeRecordingView(fullyEligible, false).replayStatus).toBe('processing');
    expect(toProviderSafeRecordingView(fullyEligible, true).replayStatus).toBe('available');
  });

  it('does not report "available" once retention has expired, even with B2 configured', () => {
    const expired = baseRow({
      recording_state: 'b2_finalized',
      integrity_verified_at: '2026-08-14T12:37:12Z',
      retention_expires_at: '2020-01-01T00:00:00Z',
    });
    expect(toProviderSafeRecordingView(expired, true).replayStatus).toBe('processing');
  });

  it('only reports a YouTube fallback as available when genuinely verified', () => {
    const unverified = toProviderSafeRecordingView(
      baseRow({ youtube_fallback_url: 'https://youtube.com/watch?v=abc', youtube_fallback_verified: false })
    );
    expect(unverified.youtubeFallbackAvailable).toBe(false);

    const verified = toProviderSafeRecordingView(
      baseRow({ youtube_fallback_url: 'https://youtube.com/watch?v=abc', youtube_fallback_verified: true })
    );
    expect(verified.youtubeFallbackAvailable).toBe(true);
  });
});
