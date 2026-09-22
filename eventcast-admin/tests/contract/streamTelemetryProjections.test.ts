import { describe, expect, it } from 'vitest';
import {
  deriveStreamSourceHealth,
  toPlatformStreamTechnicalView,
  toProviderStreamTechnicalView,
  STREAM_TELEMETRY_STALE_AFTER_SECONDS,
  type MediaStreamTelemetryRow,
} from '@/lib/platformOperations';

const NOW = new Date('2026-09-22T12:00:00.000Z');

function freshTimestamp(secondsAgo: number): string {
  return new Date(NOW.getTime() - secondsAgo * 1000).toISOString();
}

function makeRow(overrides: Partial<MediaStreamTelemetryRow> = {}): MediaStreamTelemetryRow {
  return {
    event_id: 'event-1',
    reporting_media_node_id: 'node-1',
    sampled_at: freshTimestamp(5),
    connected: true,
    srs_publish_active: true,
    video_width: 1280,
    video_height: 720,
    video_codec: 'H264',
    audio_codec: 'AAC',
    audio_present: true,
    ingest_kbps_recv_30s: 2500,
    recv_bytes: 123456789,
    captured_segment_bitrate_kbps: 2480.5,
    publish_duration_seconds: 305,
    session_count: 2,
    reconnect_count: 1,
    segment_freshness_seconds: 3,
    updated_at: freshTimestamp(5),
    ...overrides,
  };
}

describe('deriveStreamSourceHealth', () => {
  it('is no_signal for a missing row', () => {
    expect(deriveStreamSourceHealth(null, false)).toBe('no_signal');
  });

  it('is no_signal for a stale row even if every field looks healthy', () => {
    expect(deriveStreamSourceHealth(makeRow(), false)).toBe('no_signal');
  });

  it('is no_signal when connected is explicitly false', () => {
    expect(deriveStreamSourceHealth(makeRow({ connected: false }), true)).toBe('no_signal');
  });

  it('is no_signal when srs_publish_active is explicitly false', () => {
    expect(deriveStreamSourceHealth(makeRow({ srs_publish_active: false }), true)).toBe('no_signal');
  });

  it('is no_signal when segment freshness has crossed the canonical three-segment threshold (12s)', () => {
    expect(deriveStreamSourceHealth(makeRow({ segment_freshness_seconds: 12 }), true)).toBe('no_signal');
    expect(deriveStreamSourceHealth(makeRow({ segment_freshness_seconds: 20 }), true)).toBe('no_signal');
  });

  it('is good just under the segment freshness threshold', () => {
    expect(deriveStreamSourceHealth(makeRow({ segment_freshness_seconds: 11.9 }), true)).toBe('good');
  });

  it('does not fabricate a verdict from a null optional signal — unavailable signals are skipped, not treated as failing', () => {
    const row = makeRow({ srs_publish_active: null, segment_freshness_seconds: null });
    expect(deriveStreamSourceHealth(row, true)).toBe('good');
  });

  it('is good when every available signal is healthy', () => {
    expect(deriveStreamSourceHealth(makeRow(), true)).toBe('good');
  });
});

describe('toProviderStreamTechnicalView — no infrastructure-sensitive field ever leaks', () => {
  it('never includes a node id, hostname, disk/queue, or version field, at any freshness state', () => {
    for (const row of [null, makeRow(), makeRow({ sampled_at: freshTimestamp(9999) })]) {
      const view = toProviderStreamTechnicalView(row, false, NOW);
      const serialized = JSON.stringify(view).toLowerCase();
      expect(serialized).not.toMatch(/node_?id|hostname|disk|queue|software_?version|config_?version|reporting_media_node_id/);
    }
  });

  it('FPS is always an explicit UnavailableFact, even when every other field is healthy and fresh', () => {
    const view = toProviderStreamTechnicalView(makeRow(), false, NOW);
    expect(view.fps).toEqual({ available: false, reason: expect.any(String) });
  });

  it('a missing row renders every field unavailable and sourceHealth no_signal', () => {
    const view = toProviderStreamTechnicalView(null, false, NOW);
    expect(view.sourceHealth).toBe('no_signal');
    expect(view.connected).toEqual({ available: false, reason: expect.any(String) });
    expect(view.videoCodec).toEqual({ available: false, reason: expect.any(String) });
    expect(view.sampledAt).toBeNull();
  });

  it('a stale row (older than STREAM_TELEMETRY_STALE_AFTER_SECONDS) renders as unavailable, never as a frozen last-known-good snapshot', () => {
    const staleRow = makeRow({
      sampled_at: freshTimestamp(STREAM_TELEMETRY_STALE_AFTER_SECONDS + 1),
      video_codec: 'H264',
      connected: true,
    });
    const view = toProviderStreamTechnicalView(staleRow, false, NOW);
    expect(view.sourceHealth).toBe('no_signal');
    expect(view.connected).toEqual({ available: false, reason: expect.any(String) });
    expect(view.videoCodec).toEqual({ available: false, reason: expect.any(String) });
    expect(view.sampledAt).toBeNull();
  });

  it('a fresh, healthy row renders real values and sourceHealth good', () => {
    const view = toProviderStreamTechnicalView(makeRow(), true, NOW);
    expect(view.sourceHealth).toBe('good');
    expect(view.connected).toBe(true);
    expect(view.videoWidth).toBe(1280);
    expect(view.videoHeight).toBe(720);
    expect(view.videoCodec).toBe('H264');
    expect(view.audioCodec).toBe('AAC');
    expect(view.audioPresent).toBe(true);
    expect(view.ingestKbpsRecv30s).toBe(2500);
    expect(view.capturedSegmentBitrateKbps).toBe(2480.5);
    expect(view.reconnectCount).toBe(1);
    expect(view.relayStateWord).toBe('youtube_enabled');
  });

  it('a per-field null (that specific signal genuinely unmeasured) renders that field unavailable without affecting other fields', () => {
    const view = toProviderStreamTechnicalView(makeRow({ video_codec: null, audio_present: null }), false, NOW);
    expect(view.videoCodec).toEqual({ available: false, reason: expect.any(String) });
    expect(view.audioPresent).toEqual({ available: false, reason: expect.any(String) });
    // Unrelated fields are unaffected.
    expect(view.audioCodec).toBe('AAC');
  });
});

describe('toPlatformStreamTechnicalView — richer, but never a secret', () => {
  it('never includes a stream secret, publish token, or YouTube secret reference', () => {
    for (const row of [null, makeRow()]) {
      const view = toPlatformStreamTechnicalView(row, NOW);
      const serialized = JSON.stringify(view).toLowerCase();
      expect(serialized).not.toMatch(/stream_secret_hash|secret|token|youtube_secret_reference/);
    }
  });

  it('never includes audio sample rate under any key name', () => {
    const view = toPlatformStreamTechnicalView(makeRow(), NOW);
    const serialized = JSON.stringify(view).toLowerCase();
    expect(serialized).not.toMatch(/sample_?rate/);
  });

  it('includes node identity (appropriate for the Super Admin role, unlike the provider view)', () => {
    const view = toPlatformStreamTechnicalView(makeRow(), NOW);
    expect(view.reportingMediaNodeId).toBe('node-1');
  });

  it('a stale row is unavailable with a null reportingMediaNodeId-independent reason, and every measured field is null', () => {
    const staleRow = makeRow({ sampled_at: freshTimestamp(STREAM_TELEMETRY_STALE_AFTER_SECONDS + 1) });
    const view = toPlatformStreamTechnicalView(staleRow, NOW);
    expect(view.available).toBe(false);
    expect(view.sourceHealth).toBe('no_signal');
    expect(view.reason).toEqual(expect.any(String));
    expect(view.connected).toBeNull();
    expect(view.videoCodec).toBeNull();
  });

  it('a missing row is unavailable with every field null and no ageSeconds', () => {
    const view = toPlatformStreamTechnicalView(null, NOW);
    expect(view.available).toBe(false);
    expect(view.ageSeconds).toBeNull();
    expect(view.reportingMediaNodeId).toBeNull();
  });

  it('a fresh row reports a real ageSeconds and every measured field', () => {
    const view = toPlatformStreamTechnicalView(makeRow({ sampled_at: freshTimestamp(5) }), NOW);
    expect(view.available).toBe(true);
    expect(view.ageSeconds).toBeCloseTo(5, 0);
    expect(view.videoCodec).toBe('H264');
    expect(view.segmentFreshnessSeconds).toBe(3);
  });

  it('FPS is always an explicit UnavailableFact regardless of freshness', () => {
    expect(toPlatformStreamTechnicalView(makeRow(), NOW).fps).toEqual({ available: false, reason: expect.any(String) });
    expect(toPlatformStreamTechnicalView(null, NOW).fps).toEqual({ available: false, reason: expect.any(String) });
  });
});
