// Executes the shared finalized-R2 eligibility gate
// (eventcast-admin/src/lib/recordingReplay.ts) directly: Node 24 strips the
// TypeScript types, and the module is deliberately dependency-free. The
// Admin provider availability view and this Worker both import it, so one
// matrix covers both consumers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isR2FinalReplayEligible,
  isValidPlaybackIdentifier,
} from '../../../eventcast-admin/src/lib/recordingReplay.ts';

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);
const P = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

function recording(overrides = {}) {
  return {
    recording_state: 'local_finalized',
    r2_playback_id: P,
    gap_count: 0,
    gap_status: 'none',
    retention_expires_at: null,
    ...overrides,
  };
}
const disabled = { playback_id: P, enabled: false };

test('eligible: disabled assignment + proven pointer equal to its playback id, gap-free', () => {
  for (const state of ['local_finalized', 'b2_finalizing', 'b2_finalized']) {
    assert.equal(isR2FinalReplayEligible(recording({ recording_state: state }), disabled, NOW), true, state);
  }
});

test('never while live: an enabled assignment is not replay', () => {
  assert.equal(isR2FinalReplayEligible(recording(), { playback_id: P, enabled: true }, NOW), false);
});

test('reactivation fails closed: pointer must equal the CURRENT preserved playback id', () => {
  assert.equal(isR2FinalReplayEligible(recording(), { playback_id: 'b'.repeat(32), enabled: false }, NOW), false);
});

test('no pointer (unproven / multi-activation / split) is never eligible, even if objects exist', () => {
  assert.equal(isR2FinalReplayEligible(recording({ r2_playback_id: null }), disabled, NOW), false);
  assert.equal(isR2FinalReplayEligible(recording({ r2_playback_id: undefined }), disabled, NOW), false);
});

test('ineligible states: not_started, recording, failed', () => {
  for (const state of ['not_started', 'recording', 'failed', 'bogus']) {
    assert.equal(isR2FinalReplayEligible(recording({ recording_state: state }), disabled, NOW), false, state);
  }
});

test('gap policy: pending_review and rejected never serve; acknowledged does', () => {
  assert.equal(isR2FinalReplayEligible(recording({ gap_count: 2, gap_status: 'pending_review' }), disabled, NOW), false);
  assert.equal(isR2FinalReplayEligible(recording({ gap_count: 2, gap_status: 'rejected' }), disabled, NOW), false);
  assert.equal(isR2FinalReplayEligible(recording({ gap_count: 2, gap_status: 'acknowledged' }), disabled, NOW), true);
  assert.equal(isR2FinalReplayEligible(recording({ gap_count: null, gap_status: 'none' }), disabled, NOW), false);
});

test('retention: unfrozen (null) is fine; frozen must not be expired or invalid', () => {
  assert.equal(isR2FinalReplayEligible(recording({ retention_expires_at: new Date(NOW + 60_000).toISOString() }), disabled, NOW), true);
  assert.equal(isR2FinalReplayEligible(recording({ retention_expires_at: new Date(NOW).toISOString() }), disabled, NOW), false);
  assert.equal(isR2FinalReplayEligible(recording({ retention_expires_at: 'garbage' }), disabled, NOW), false);
});

test('fails closed on missing inputs and malformed ids', () => {
  assert.equal(isR2FinalReplayEligible(null, disabled, NOW), false);
  assert.equal(isR2FinalReplayEligible(recording(), null, NOW), false);
  assert.equal(isR2FinalReplayEligible(recording({ r2_playback_id: '../x' }), { playback_id: '../x', enabled: false }, NOW), false);
  assert.equal(isR2FinalReplayEligible(recording(), { playback_id: P, enabled: null }, NOW), false);
});

test('playback id validation mirrors the Worker component rule', () => {
  assert.equal(isValidPlaybackIdentifier(P), true);
  for (const bad of ['', '.hidden', '-x', 'a/b', 'a b', 'x'.repeat(129), null, 7]) {
    assert.equal(isValidPlaybackIdentifier(bad), false, String(bad));
  }
});
