import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BRIDGE_MAX_AGE_SECONDS,
  MAX_BRIDGE_MAX_AGE_SECONDS,
  disabledHlsAssetRequirement,
  isBridgeManifestFresh,
  parseBridgeMaxAgeSeconds,
} from './playback-continuity.mjs';

test('bridge bound defaults to 3 hours (10800 s)', () => {
  assert.equal(DEFAULT_BRIDGE_MAX_AGE_SECONDS, 10800);
  assert.equal(parseBridgeMaxAgeSeconds(undefined), 10800);
  assert.equal(parseBridgeMaxAgeSeconds(''), 10800);
});

test('bridge bound accepts only a plain integer within [1, 86400]', () => {
  assert.equal(parseBridgeMaxAgeSeconds('60'), 60);
  assert.equal(parseBridgeMaxAgeSeconds(' 900 '), 900);
  assert.equal(parseBridgeMaxAgeSeconds(String(MAX_BRIDGE_MAX_AGE_SECONDS)), MAX_BRIDGE_MAX_AGE_SECONDS);
  for (const bad of ['0', '-5', '1.5', '1e3', 'abc', '86401', '9999999', null, 42, {}]) {
    assert.equal(parseBridgeMaxAgeSeconds(bad), 10800, `must fall back for ${String(bad)}`);
  }
});

test('bridge freshness: within bound, at bound, beyond bound, and clock skew', () => {
  const now = Date.UTC(2026, 8, 27, 12, 0, 0);
  assert.equal(isBridgeManifestFresh(new Date(now - 10_000), now, 60), true);
  assert.equal(isBridgeManifestFresh(new Date(now - 60_000), now, 60), true);
  assert.equal(isBridgeManifestFresh(new Date(now - 60_001), now, 60), false);
  assert.equal(isBridgeManifestFresh(new Date(now + 5_000), now, 60), true, 'future timestamp counts as age 0');
  assert.equal(isBridgeManifestFresh(new Date(now - 3 * 3600_000), now, 10800), true);
  assert.equal(isBridgeManifestFresh(new Date(now - 3 * 3600_000 - 1), now, 10800), false);
});

test('bridge freshness fails closed on missing/invalid inputs', () => {
  const now = Date.now();
  assert.equal(isBridgeManifestFresh(null, now, 60), false);
  assert.equal(isBridgeManifestFresh(undefined, now, 60), false);
  assert.equal(isBridgeManifestFresh('not a date', now, 60), false);
  assert.equal(isBridgeManifestFresh(new Date(now), now, 0), false);
  assert.equal(isBridgeManifestFresh(new Date(now), now, Number.NaN), false);
});

test('disabled-assignment asset requirements are scoped per asset kind', () => {
  assert.equal(disabledHlsAssetRequirement({ kind: 'manifest', variant: 'live' }), 'bridge');
  assert.equal(disabledHlsAssetRequirement({ kind: 'manifest', variant: 'vod' }), 'r2_final');
  assert.equal(disabledHlsAssetRequirement({ kind: 'segment' }), 'bridge_or_r2_final');
});
